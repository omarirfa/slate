"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelContextLike, RegisteredTool } from "@/lib/webmcp";

interface Props {
  mc: ModelContextLike;
  /** Bumped by the parent whenever the surface changes, to force re-discovery. */
  revision: number;
  preselect?: string | null;
  onConsumedPreselect?: () => void;
  /** Additional origins to discover tools from, when the halves are split. */
  fromOrigins?: string[] | null;
}

type SchemaProp = {
  type?: string;
  description?: string;
  enum?: string[];
};

/**
 * An author-provided agent, in the spec's terms: it discovers whatever this
 * page has registered through getTools() and calls it through executeTool(),
 * with an AbortSignal so a call in flight can be cancelled. It works whether
 * the underlying context is the browser's native one or the shim, which is
 * what makes the page demonstrable without a browser agent attached.
 */
export default function ToolConsole({
  mc,
  revision,
  preselect,
  onConsumedPreselect,
  fromOrigins,
}: Props) {
  const [tools, setTools] = useState<RegisteredTool[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [args, setArgs] = useState<Record<string, string>>({});
  const [output, setOutput] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const discover = useCallback(async () => {
    try {
      const found = await mc.getTools(
        fromOrigins && fromOrigins.length ? { fromOrigins } : undefined
      );
      setTools(found);
      setSelected((cur) => (found.some((t) => t.name === cur) ? cur : (found[0]?.name ?? "")));
    } catch (err) {
      setOutput(`Discovery failed: ${String(err)}`);
    }
  }, [mc, fromOrigins]);

  useEffect(() => {
    void discover();
  }, [discover, revision]);

  // Re-discover on toolchange, exactly as an external agent would need to.
  useEffect(() => {
    const handler = () => void discover();
    mc.addEventListener("toolchange", handler);
    return () => mc.removeEventListener("toolchange", handler);
  }, [mc, discover]);

  useEffect(() => {
    if (preselect && tools.some((t) => t.name === preselect)) {
      setSelected(preselect);
      setArgs({});
      setOutput("");
      onConsumedPreselect?.();
    }
  }, [preselect, tools, onConsumedPreselect]);

  const tool = useMemo(() => tools.find((t) => t.name === selected), [tools, selected]);

  const props = useMemo(() => {
    const schema = tool?.inputSchema as
      | { properties?: Record<string, SchemaProp>; required?: string[] }
      | undefined;
    return {
      entries: Object.entries(schema?.properties ?? {}),
      required: schema?.required ?? [],
    };
  }, [tool]);

  async function run() {
    if (!tool) return;
    setBusy(true);
    setOutput("");
    const controller = new AbortController();
    abortRef.current = controller;

    const payload: Record<string, unknown> = {};
    for (const [key, spec] of props.entries) {
      const raw = args[key];
      if (raw === undefined || raw === "") continue;
      payload[key] = spec.type === "number" ? Number(raw) : raw;
    }

    try {
      const result = await mc.executeTool(tool, payload, { signal: controller.signal });
      setOutput(renderResult(result));
    } catch (err) {
      setOutput(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <section className="panel" aria-labelledby="console-title">
      <div className="panel__head">
        <span className="label">In-page agent</span>
        <h2 className="panel__title" id="console-title">
          Tool console
        </h2>
      </div>

      <div className="console">
        <div className="field">
          <label className="field__label" htmlFor="tool-select">
            Discovered tools ({tools.length})
          </label>
          <select
            id="tool-select"
            className="select"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setArgs({});
              setOutput("");
            }}
          >
            {tools.length === 0 && <option value="">No tools registered</option>}
            {tools.map((t) => (
              <option key={`${t.origin ?? ""}/${t.name}`} value={t.name}>
                {t.name}
                {t.annotations?.destructiveHint ? "  · consequential" : ""}
                {t.annotations?.readOnlyHint ? "  · read" : ""}
                {t.origin && typeof location !== "undefined" && t.origin !== location.origin
                  ? `  · from ${hostOf(t.origin)}`
                  : ""}
              </option>
            ))}
          </select>
          <p className="field__help">{tool?.description ?? "Pick a tool to see its schema."}</p>
        </div>

        {props.entries.length > 0 && (
          <div className="console__args">
            {props.entries.map(([key, spec]) => {
              const id = `arg-${key}`;
              const isRequired = props.required.includes(key);
              return (
                <div className="field" key={key}>
                  <label className="field__label" htmlFor={id}>
                    {key}
                    {isRequired ? " *" : ""}
                  </label>
                  {spec.enum ? (
                    <select
                      id={id}
                      className="select"
                      value={args[key] ?? ""}
                      onChange={(e) => setArgs((a) => ({ ...a, [key]: e.target.value }))}
                    >
                      <option value="">—</option>
                      {spec.enum.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={id}
                      className="input"
                      type={spec.type === "number" ? "number" : "text"}
                      inputMode={spec.type === "number" ? "decimal" : undefined}
                      value={args[key] ?? ""}
                      aria-required={isRequired}
                      onChange={(e) => setArgs((a) => ({ ...a, [key]: e.target.value }))}
                    />
                  )}
                  <p className="field__help">{spec.description ?? ""}</p>
                </div>
              );
            })}
          </div>
        )}

        <div className="console__row">
          <button
            type="button"
            className="btn btn--primary"
            onClick={run}
            disabled={!tool || busy}
          >
            {busy && <span className="btn__spinner" aria-hidden="true" />}
            {busy ? "Calling" : "executeTool()"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => abortRef.current?.abort()}
            disabled={!busy}
          >
            Abort
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void discover()}>
            getTools()
          </button>
        </div>

        {output && (
          <pre className="console__out" role="status" aria-live="polite">
            {output}
          </pre>
        )}
      </div>
    </section>
  );
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function renderResult(result: unknown): string {
  if (result && typeof result === "object" && "content" in (result as any)) {
    const content = (result as any).content;
    if (Array.isArray(content)) {
      return content.map((c: any) => (c?.type === "text" ? c.text : JSON.stringify(c))).join("\n");
    }
  }
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}
