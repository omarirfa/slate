"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publishShim, ToolRegistry, providerStatus, type RegisteredTool } from "@/lib/webmcp";
import { buildTools } from "@/lib/tools";
import { capabilities, newLoan, phase } from "@/lib/engine";
import { apply } from "@/lib/engine";
import type { LoanState, Role } from "@/lib/types";
import { detectProvider, DEFAULT_MODELS, type Provider } from "@/lib/providers";

/**
 * A place to drive this page's WebMCP surface directly.
 *
 * Two ways in. **By hand** — pick a registered tool, edit its arguments, call
 * it, read the result. **By model** — bring a key, write a prompt, and watch a
 * model choose from the same list. Both go through the real registry, so a
 * clause that has closed a tool closes it here too.
 *
 * The slate is local to this page and starts fresh on reload: nothing here
 * touches a real room, so anything can be tried without consequence.
 *
 * A brought key is held in React state and sent as a header on each call. It is
 * never written to storage and never reaches this app's server as anything but
 * a pass-through to the provider.
 */

type Row = { kind: "sent" | "ok" | "refused" | "note"; text: string };

export default function Playground() {
  const [role, setRole] = useState<Role>("lender");
  const [state, setState] = useState<LoanState>(() => newLoan("PLAY"));
  const stateRef = useRef(state);
  stateRef.current = state;

  const [registry, setRegistry] = useState<ToolRegistry | null>(null);
  const [tools, setTools] = useState<RegisteredTool[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [argText, setArgText] = useState("{}");
  const [log, setLog] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const [key, setKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const provider: Provider | null = useMemo(() => (key ? detectProvider(key) : null), [key]);

  const say = useCallback((kind: Row["kind"], text: string) => {
    setLog((l) => [...l.slice(-40), { kind, text }]);
  }, []);

  /* One registry for this page, rebuilt whenever the slate or role changes. */
  useEffect(() => {
    /*
      The playground always publishes. Inspecting the surface from outside is
      the entire point of this page, and an external inspector cannot reach a
      module-scoped singleton. The shim identifies itself, so detection still
      reports `shim` rather than claiming the browser is native.
    */
    publishShim();
    const r = new ToolRegistry();
    setRegistry(r);
    return () => void r.teardown();
  }, []);

  useEffect(() => {
    if (!registry) return;
    let cancelled = false;
    const specs = buildTools(state, role, async (type, payload) => {
      const res = apply(stateRef.current, { role, type, via: "tool", payload: payload ?? {} });
      if (res.state) setState(res.state);
      return { ok: res.ok, message: res.message };
    });
    void registry.sync(specs).then(async () => {
      if (cancelled) return;
      setTools(await registry.context.getTools());
    });
    return () => {
      cancelled = true;
    };
  }, [registry, state, role]);

  useEffect(() => {
    if (tools.length && !tools.some((t) => t.name === selected)) setSelected(tools[0].name);
  }, [tools, selected]);

  const schemaFor = (name: string) =>
    (tools.find((t) => t.name === name)?.inputSchema as Record<string, unknown>) ?? {};

  /* ------------------------------------------------------------- by hand */

  async function runByHand() {
    if (!registry || !selected) return;
    let args: unknown = {};
    try {
      args = argText.trim() ? JSON.parse(argText) : {};
    } catch {
      say("refused", "Arguments are not valid JSON.");
      return;
    }
    const tool = tools.find((t) => t.name === selected);
    if (!tool) {
      say("refused", `${selected} is not registered right now.`);
      return;
    }
    setBusy(true);
    say("sent", `executeTool(${selected}) ${JSON.stringify(args)}`);
    try {
      // executeTool takes the discovered tool, not its name: a name alone
      // could not carry the origin a cross-origin tool came from.
      const out = await registry.context.executeTool(tool, args);
      say("ok", typeof out === "string" ? out : JSON.stringify(out));
    } catch (e) {
      say("refused", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------ by model */

  async function runByModel() {
    if (!registry || !prompt.trim()) return;
    if (key && !provider) {
      say("refused", "That key does not look like an Anthropic, OpenAI or Gemini key.");
      return;
    }
    setBusy(true);
    const discovered = await registry.context.getTools();
    say("note", `getTools() → ${discovered.map((t) => t.name).join(", ") || "(none)"}`);
    const messages: unknown[] = [{ role: "user", content: prompt.trim() }];

    try {
      for (let round = 0; round < 4; round++) {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(key ? { "x-model-key": key } : {}),
            ...(key && provider ? { "x-model-provider": provider } : {}),
          },
          body: JSON.stringify({
            system:
              "You are acting for one party on a loan between friends. Use only the tools listed. " +
              "If you want to do something and there is no tool for it, say so in one line and stop.",
            messages,
            tools: discovered.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          }),
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          say("refused", data?.message ?? `Model call failed (${res.status}).`);
          break;
        }
        const content = (data.content ?? []) as Array<
          { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown }
        >;
        for (const b of content) if (b.type === "text" && b.text.trim()) say("note", b.text.trim());
        const calls = content.filter((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use");
        if (!calls.length) break;

        messages.push({ role: "assistant", content });
        const results: unknown[] = [];
        for (const c of calls) {
          say("sent", `executeTool(${c.name}) ${JSON.stringify(c.input ?? {})}`);
          const tool = discovered.find((t) => t.name === c.name);
          if (!tool) {
            say("refused", `${c.name} is not registered on this page.`);
            results.push({ type: "tool_result", tool_use_id: c.id, content: "No such tool.", is_error: true });
            continue;
          }
          try {
            const out = await registry.context.executeTool(tool, c.input ?? {});
            const text = typeof out === "string" ? out : JSON.stringify(out);
            say("ok", text);
            results.push({ type: "tool_result", tool_use_id: c.id, content: text });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            say("refused", msg);
            results.push({ type: "tool_result", tool_use_id: c.id, content: msg, is_error: true });
          }
        }
        messages.push({ role: "user", content: results });
      }
    } finally {
      setBusy(false);
    }
  }

  const status = providerStatus(registry?.provider ?? "shim");
  const closed = capabilities(state, role).filter((c) => !c.available);

  return (
    <div className="play">
      <section className="play__panel">
        <h2 className="play__title">This page&rsquo;s surface</h2>
        <p className="play__note">
          <span className="mono">{status.label}</span> · {tools.length} tool{tools.length === 1 ? "" : "s"} registered
          for the <strong>{role}</strong>, phase <span className="mono">{phase(state)}</span>.
        </p>

        <div className="play__row">
          <label className="play__field">
            <span className="label">Acting as</span>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="lender">lender</option>
              <option value="borrower">borrower</option>
            </select>
          </label>
          <button type="button" className="btn btn--sm" onClick={() => { setState(newLoan("PLAY")); setLog([]); }}>
            Reset the slate
          </button>
        </div>

        <ul className="play__tools">
          {tools.map((t) => (
            <li key={t.name}>
              <span className="mono">{t.name}</span>
              <span className="play__desc">{t.description}</span>
            </li>
          ))}
          {!tools.length && <li className="play__desc">No tools registered right now.</li>}
        </ul>

        {closed.length > 0 && (
          <p className="play__note">
            {closed.length} more {closed.length === 1 ? "is" : "are"} closed by a clause and therefore not registered:{" "}
            <span className="mono">{closed.map((c) => c.name).join(", ")}</span>
          </p>
        )}
      </section>

      <section className="play__panel">
        <h2 className="play__title">By hand</h2>
        <div className="play__row">
          <label className="play__field play__field--grow">
            <span className="label">Tool</span>
            <select className="select" value={selected} onChange={(e) => { setSelected(e.target.value); setArgText("{}"); }}>
              {tools.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </label>
        </div>
        <label className="play__field">
          <span className="label">Arguments (JSON)</span>
          <textarea className="input play__args" rows={4} value={argText} onChange={(e) => setArgText(e.target.value)} spellCheck={false} />
        </label>
        <details className="play__schema">
          <summary>Input schema</summary>
          <pre className="mono">{JSON.stringify(schemaFor(selected), null, 2)}</pre>
        </details>
        <button type="button" className="btn btn--primary" onClick={() => void runByHand()} disabled={busy || !selected}>
          Execute tool
        </button>
      </section>

      <section className="play__panel">
        <h2 className="play__title">By model</h2>
        <p className="play__note">
          Bring a key and a model picks from the same list. Held in memory for this tab only — never stored, and passed
          straight to {provider ? <span className="mono">{provider}</span> : "your provider"}.
        </p>
        <label className="play__field">
          <span className="label">API key — Anthropic, OpenAI or Gemini</span>
          <input className="input" type="password" value={key} placeholder="sk-ant-… · sk-… · AIza…"
            onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <p className="play__note">
          {key
            ? provider
              ? `Detected ${provider} · default model ${DEFAULT_MODELS[provider]}`
              : "Unrecognised key format."
            : "Leave blank to use a key set on the server, if there is one."}
        </p>
        <label className="play__field">
          <span className="label">Prompt</span>
          <textarea className="input" rows={3} value={prompt} placeholder="Nudge them about the late payment."
            onChange={(e) => setPrompt(e.target.value)} />
        </label>
        <button type="button" className="btn btn--primary" onClick={() => void runByModel()} disabled={busy || !prompt.trim()}>
          {busy ? "Running" : "Send"}
        </button>
      </section>

      <section className="play__panel play__panel--wide">
        <h2 className="play__title">Trace</h2>
        <ol className="play__log">
          {log.map((r, i) => (
            <li key={i} className="play__line" data-kind={r.kind}>
              <span className="play__kind mono">{r.kind}</span>
              <span className="play__text">{r.text}</span>
            </li>
          ))}
          {!log.length && <li className="play__desc">Nothing yet.</li>}
        </ol>
      </section>
    </div>
  );
}
