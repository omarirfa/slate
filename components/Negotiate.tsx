"use client";

import { useEffect, useRef, useState } from "react";
import { StandInAgent, type AgentMode, type TraceEntry } from "@/lib/agent";
import { negotiationBrief, negotiationSettled, negotiationWants, POSITIONS, proposalCount } from "@/lib/negotiate";
import type { LoanState, Role } from "@/lib/types";
import type { OwnKey } from "@/lib/keys";
import type { ModelContextLike } from "@/lib/webmcp";

interface Props {
  state: LoanState;
  /** Model contexts for both halves. Absent when this device holds one key. */
  contexts: Record<Role, ModelContextLike> | null;
  myRole: Role;
  modelAvailable: boolean;
  modelName: string | null;
  own?: OwnKey | null;
  /** Called with the step to preselect in the console, e.g. sign-agreement. */
  onSign: () => void;
}

type Line = TraceEntry & { who: Role };

const TICK_RULES_MS = 2400;
const TICK_MODEL_MS = 7000;
const MAX_ROUNDS = 8;

/**
 * Two agents, two contexts, one table. The lender's agent opens; whoever's
 * proposal is not on the table answers. Both are built from the same
 * StandInAgent as the stand-in — discover with getTools(), act with
 * executeTool() — with sign-agreement excluded from what they may see. When
 * accept-terms lands, the agents stop and the two people sign.
 */
export default function Negotiate({ state, contexts, myRole, modelAvailable, modelName, own, onSign }: Props) {
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<AgentMode>("rules");
  const [lines, setLines] = useState<Line[]>([]);
  const [outcome, setOutcome] = useState<"idle" | "agreed" | "stalled">("idle");
  const stateRef = useRef(state);
  stateRef.current = state;

  const settled = negotiationSettled(state);
  const rounds = proposalCount(state);

  useEffect(() => {
    if (!running || !contexts) return;
    let cancelled = false;

    const make = (role: Role) =>
      new StandInAgent({
        mc: contexts[role],
        role,
        mood: "reliable",
        mode,
        getState: () => stateRef.current,
        onTrace: (e) => setLines((l) => [...l.slice(-23), { ...e, who: role }]),
        wants: negotiationWants,
        brief: negotiationBrief,
        exclude: ["sign-agreement"],
        apiKey: own?.key ?? null,
        provider: own?.provider ?? null,
        modelName: own?.model ?? null,
      });
    const agents: Record<Role, StandInAgent> = { lender: make("lender"), borrower: make("borrower") };

    const whoseMove = (s: LoanState): Role => (!s.proposal ? "lender" : s.proposal.by === "lender" ? "borrower" : "lender");

    const loop = async () => {
      while (!cancelled) {
        const s = stateRef.current;
        if (negotiationSettled(s)) {
          setOutcome("agreed");
          setRunning(false);
          return;
        }
        if (proposalCount(s) >= MAX_ROUNDS) {
          setOutcome("stalled");
          setRunning(false);
          return;
        }
        const role = whoseMove(s);
        await agents[role].tick();
        // Let the new state arrive over the event stream before the other side reads it.
        await new Promise((r) => setTimeout(r, mode === "model" ? TICK_MODEL_MS : TICK_RULES_MS));
      }
    };
    void loop();

    return () => {
      cancelled = true;
      agents.lender.stop();
      agents.borrower.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, contexts, mode]);

  const canRun = Boolean(contexts) && !settled && !state.signatures.lender && !state.signatures.borrower;

  return (
    <section className="panel" aria-labelledby="negotiate-title">
      <div className="panel__head">
        <span className="label">Two agents, two contexts, one table</span>
        <h2 className="panel__title" id="negotiate-title">
          Negotiate the terms
        </h2>
      </div>

      <div className="standin">
        <div className="standin__row">
          {running ? (
            <button type="button" className="btn btn--sm" onClick={() => setRunning(false)}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--sm btn--primary"
              disabled={!canRun}
              onClick={() => {
                setLines([]);
                setOutcome("idle");
                setRunning(true);
              }}
            >
              {rounds > 0 ? "Let the agents continue" : "Let the agents negotiate"}
            </button>
          )}
          <select
            className="select"
            style={{ width: "auto", minHeight: 34, fontSize: "var(--text-xs)" }}
            value={mode}
            onChange={(e) => setMode(e.target.value as AgentMode)}
            disabled={running || !modelAvailable}
            aria-label="Negotiators' brain"
          >
            <option value="rules">rules</option>
            <option value="model">{modelAvailable ? modelName ?? "model" : "model (no API key)"}</option>
          </select>
          {rounds > 0 && <span className="sim__count mono">{rounds} proposal{rounds === 1 ? "" : "s"}</span>}
        </div>

        {settled ? (
          <p className="standin__note">
            Terms agreed{rounds ? ` after ${rounds} proposal${rounds === 1 ? "" : "s"}` : ""}. The agents are done: signing was never
            on their list.{" "}
            {!state.signatures[myRole] && (
              <button type="button" className="btn btn--sm btn--primary" onClick={onSign} style={{ marginLeft: "var(--space-xs)" }}>
                Sign your half
              </button>
            )}
          </p>
        ) : !contexts ? (
          <p className="standin__note">Running both negotiators needs both half-keys, which only the device that opened the slate holds.</p>
        ) : outcome === "stalled" ? (
          <p className="standin__note">No agreement in {MAX_ROUNDS} proposals. Propose terms yourself, or let them continue.</p>
        ) : (
          <p className="standin__note">
            Each side gets its own model context and a position. The lender&rsquo;s agent opens; the other answers with{" "}
            <span className="mono">accept-terms</span> or a counter through <span className="mono">propose-terms</span>.{" "}
            <span className="mono">sign-agreement</span> is excluded from both, so the people sign.
          </p>
        )}

        <dl className="positions">
          {(["lender", "borrower"] as Role[]).map((r) => (
            <div key={r} className="positions__item">
              <dt>{r === "lender" ? state.terms.lenderName : state.terms.borrowerName}</dt>
              <dd>{POSITIONS[r].stance}</dd>
            </div>
          ))}
        </dl>

        {lines.length > 0 && (
          <div className="trace" aria-live="polite" aria-label="Negotiation trace">
            <ol className="trace__list">
              {lines.map((e) => (
                <li key={`${e.who}-${e.id}`} className="trace__item trace__item--who" data-kind={e.kind}>
                  <span className="trace__who">{e.who === "lender" ? state.terms.lenderName : state.terms.borrowerName}</span>
                  <span className="trace__kind">{kindLabel(e.kind)}</span>
                  <span className="trace__text">{e.text}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

function kindLabel(kind: TraceEntry["kind"]): string {
  switch (kind) {
    case "discover":
      return "sees";
    case "thought":
      return "thinks";
    case "call":
      return "calls";
    case "result":
      return "gets";
    case "refused":
      return "cannot";
    case "error":
      return "error";
    default:
      return "waits";
  }
}
