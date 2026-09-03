"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { money, pendingPayments } from "@/lib/engine";
import type { CapabilityView, LoanState, Role } from "@/lib/types";
import type { ModelContextLike, RegisteredTool } from "@/lib/webmcp";

interface Props {
  caps: CapabilityView[];
  tools: RegisteredTool[];
  mc: ModelContextLike | null;
  state: LoanState;
  role: Role;
  myName: string;
  theirName: string;
  /** Name of a tool whose call was just refused; the row pulses once. */
  refused: { name: string; at: number } | null;
}

/** Which half each capability belongs to. Shared ones belong to whoever holds them. */
const OWNER: Record<string, Role | "both"> = {
  "get-loan-summary": "both",
  "explain-locked-capability": "both",
  "propose-terms": "both",
  "accept-terms": "both",
  "sign-agreement": "both",
  "log-payment": "borrower",
  "request-extension": "borrower",
  "request-hardship-pause": "borrower",
  "confirm-payment": "lender",
  "send-reminder": "lender",
  "grant-extension": "lender",
  "decline-extension": "lender",
  "declare-default": "lender",
  "forgive-remaining": "lender",
};

type SchemaProp = { type?: string; description?: string; enum?: string[] };

/**
 * The agreement as a list of things you can do, in plain words. Each open row
 * is a real tool on this page's model context and runs through executeTool();
 * each rubbed-out row is a tool that is not registered at all, with the clause
 * that closed it. The tool name sits in a small tag for anyone reading the
 * page as an agent would.
 */
export default function Actions({ caps, tools, mc, state, role, myName, theirName, refused }: Props) {
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [output, setOutput] = useState<{ name: string; text: string; refused: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTheirs, setShowTheirs] = useState(false);
  const [pulse, setPulse] = useState<string | null>(null);
  const prev = useRef<Map<string, boolean> | null>(null);

  useEffect(() => {
    const now = new Map(caps.map((c) => [c.name, c.available]));
    if (prev.current) {
      const changed = new Set<string>();
      for (const [name, avail] of now) {
        if (prev.current.get(name) !== undefined && prev.current.get(name) !== avail) changed.add(name);
      }
      if (changed.size) {
        setFlash(changed);
        const timer = setTimeout(() => setFlash(new Set()), 2600);
        prev.current = now;
        return () => clearTimeout(timer);
      }
    }
    prev.current = now;
  }, [caps]);

  useEffect(() => {
    if (!refused) return;
    setPulse(refused.name);
    const timer = setTimeout(() => setPulse(null), 1400);
    return () => clearTimeout(timer);
  }, [refused]);

  const byRecency = (a: CapabilityView, b: CapabilityView) => Number(flash.has(b.name)) - Number(flash.has(a.name));
  const mine = caps.filter((c) => OWNER[c.name] === role || OWNER[c.name] === "both");
  const open = mine.filter((c) => c.available).sort(byRecency);
  const closed = mine.filter((c) => !c.available).sort(byRecency);
  const theirs = caps.filter((c) => OWNER[c.name] !== role && OWNER[c.name] !== "both");

  const toolFor = (name: string) => tools.find((t) => t.name === name && (!t.origin || typeof location === "undefined" || t.origin === location.origin));

  const label = useMemo(() => labelFor(state, theirName), [state, theirName]);

  async function run(name: string, payload: Record<string, unknown>) {
    const tool = toolFor(name);
    if (!tool || !mc) {
      setOutput({ name, text: `${name} is not registered on this page right now.`, refused: true });
      return;
    }
    setBusy(true);
    try {
      const result = (await mc.executeTool(tool, payload)) as { content?: Array<{ text?: string }> };
      const text = result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
      setOutput({ name, text, refused: /^(Refused|Not done)/.test(text) });
    } catch (err) {
      setOutput({ name, text: err instanceof Error ? err.message : String(err), refused: true });
    } finally {
      setBusy(false);
    }
  }

  function press(c: CapabilityView) {
    const tool = toolFor(c.name);
    const schema = tool?.inputSchema as { properties?: Record<string, SchemaProp>; required?: string[] } | undefined;
    const needsArgs = Object.keys(schema?.properties ?? {}).length > 0;
    setOutput(null);
    if (!needsArgs) {
      void run(c.name, {});
      setOpenRow(c.readOnly ? c.name : null);
      return;
    }
    setArgs({});
    setOpenRow(openRow === c.name ? null : c.name);
  }

  function submit(c: CapabilityView) {
    const tool = toolFor(c.name);
    const schema = tool?.inputSchema as { properties?: Record<string, SchemaProp> } | undefined;
    const payload: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(schema?.properties ?? {})) {
      const raw = args[key];
      if (raw === undefined || raw === "") continue;
      payload[key] = spec.type === "number" ? Number(raw) : raw;
    }
    void run(c.name, payload).then(() => setOpenRow(c.readOnly ? c.name : null));
  }

  const renderRow = (c: CapabilityView) => {
    const tool = toolFor(c.name);
    const schema = tool?.inputSchema as { properties?: Record<string, SchemaProp>; required?: string[] } | undefined;
    const entries = Object.entries(schema?.properties ?? {});
    const expanded = openRow === c.name;
    const classes = [
      "action",
      c.available ? "action--open" : "action--closed",
      flash.has(c.name) ? (c.available ? "action--just-opened" : "action--just-closed") : "",
      pulse === c.name ? "action--refused" : "",
      c.destructive ? "action--consequential" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <li key={c.name} className={classes} data-available={c.available}>
        <div className="action__row">
          {c.available ? (
            <button
              type="button"
              className="action__button"
              onClick={() => press(c)}
              aria-expanded={entries.length ? expanded : undefined}
              disabled={busy && openRow !== c.name}
            >
              <span className="action__name">{label(c)}</span>
              {c.budget && c.name === "send-reminder" && (
                <span className="tag" data-kind="budget">
                  {c.budget.total - c.budget.used} left this month
                </span>
              )}
              {c.destructive && (
                <span className="tag" data-kind="destructive">
                  can&rsquo;t be undone
                </span>
              )}
            </button>
          ) : (
            <span className="action__button action__button--closed" aria-disabled="true">
              <span className="action__name">{label(c)}</span>
            </span>
          )}
          <span className="action__tool mono" title="WebMCP tool name">
            {c.name}
            {c.readOnly ? " · read" : ""}
            {c.available && !tool ? " · not registered" : ""}
          </span>
        </div>

        {!c.available && <p className="action__why">{c.reason}</p>}
        {c.available && !expanded && flash.has(c.name) && <p className="action__why action__why--opened">Just opened. {c.clause}</p>}

        {c.available && expanded && entries.length > 0 && (
          <div className="action__form">
            {entries.map(([key, spec]) => {
              const id = `act-${c.name}-${key}`;
              const required = schema?.required?.includes(key);
              return (
                <div className="field" key={key}>
                  <label className="field__label" htmlFor={id}>
                    {spec.description ?? key}
                    {required ? " *" : ""}
                  </label>
                  {spec.enum ? (
                    <select id={id} className="select" value={args[key] ?? ""} onChange={(e) => setArgs((a) => ({ ...a, [key]: e.target.value }))}>
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
                      aria-required={required}
                      onChange={(e) => setArgs((a) => ({ ...a, [key]: e.target.value }))}
                    />
                  )}
                </div>
              );
            })}
            <div className="console__row">
              <button type="button" className={c.destructive ? "btn btn--sm btn--danger" : "btn btn--sm btn--primary"} onClick={() => submit(c)} disabled={busy}>
                {busy ? "Working" : label(c)}
              </button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setOpenRow(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {output && output.name === c.name && (
          <pre className="action__out" data-refused={output.refused || undefined}>
            {output.text}
          </pre>
        )}
      </li>
    );
  };

  return (
    <section className="panel" aria-labelledby="actions-title">
      <div className="panel__head">
        <h2 className="panel__title" id="actions-title">
          What {myName} can do right now
        </h2>
      </div>

      <ul className="actions">{open.map(renderRow)}</ul>

      {closed.length > 0 && (
        <>
          <p className="actions__divider">Closed by a clause</p>
          <ul className="actions actions--closed">{closed.map(renderRow)}</ul>
        </>
      )}

      {theirs.length > 0 && (
        <div className="actions__theirs">
          <button type="button" className="actions__toggle" onClick={() => setShowTheirs((v) => !v)} aria-expanded={showTheirs}>
            {showTheirs ? "Hide" : "Show"} {theirName}&rsquo;s side ({theirs.length})
          </button>
          {showTheirs && <ul className="actions actions--closed">{theirs.map(renderRow)}</ul>}
        </div>
      )}

      <p className="caps__foot">
        {open.length} of these are registered as WebMCP tools on this page right now. The rubbed-out ones are not registered at all
        — an agent reading this page cannot see them, so the clause holds even against a forged call.
      </p>
    </section>
  );
}

/* ----------------------------------------------------------------- copy */

function labelFor(state: LoanState, them: string): (c: CapabilityView) => string {
  const t = state.terms;
  const pend = pendingPayments(state)[0];
  return (c) => {
    switch (c.name) {
      case "get-loan-summary":
        return "Read the slate";
      case "explain-locked-capability":
        return "Ask why something's closed";
      case "propose-terms":
        return state.proposal ? "Counter with different terms" : "Propose terms";
      case "accept-terms":
        return `Accept ${them}'s terms`;
      case "sign-agreement":
        return "Sign your half";
      case "log-payment":
        return "Say you paid";
      case "confirm-payment":
        return pend ? `Confirm ${money(pend.amount, t.currency)} landed` : "Confirm a payment landed";
      case "send-reminder":
        return `Nudge ${them}`;
      case "request-extension":
        return "Ask for more time";
      case "grant-extension":
        return `Give ${them} the time`;
      case "decline-extension":
        return "Say no to more time";
      case "request-hardship-pause":
        return `Take the ${t.pauseDays}-day pause`;
      case "declare-default":
        return "Declare default";
      case "forgive-remaining":
        return "Wipe the slate";
      default:
        return c.title;
    }
  };
}
