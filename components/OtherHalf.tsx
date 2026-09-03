"use client";

import { useState } from "react";
import type { AgentMode, TraceEntry } from "@/lib/agent";
import { MOOD_LABEL, type StandInMood } from "@/lib/standin";

interface Props {
  theirName: string;
  theirRole: "lender" | "borrower";
  /** Present only when this device opened the slate and so holds both keys. */
  inviteUrl: string | null;
  /** Whether the other half's key is on this device at all. */
  canStandIn: boolean;
  standIn: boolean;
  setStandIn: (v: boolean) => void;
  mood: StandInMood;
  setMood: (m: StandInMood) => void;
  mode: AgentMode;
  setMode: (m: AgentMode) => void;
  modelAvailable: boolean;
  modelName: string | null;
  trace: TraceEntry[];
  onClearTrace: () => void;
}

export default function OtherHalf({
  theirName,
  theirRole,
  inviteUrl,
  canStandIn,
  standIn,
  setStandIn,
  mood,
  setMood,
  mode,
  setMode,
  modelAvailable,
  modelName,
  trace,
  onClearTrace,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked; the link is visible to select */
    }
  }

  return (
    <section className="panel" aria-labelledby="standin-title">
      <div className="panel__head">
        <span className="label">The other half</span>
        <h2 className="panel__title" id="standin-title">
          {theirName}
        </h2>
      </div>

      {inviteUrl && !standIn && (
        <div className="invite">
          <p className="standin__note">
            Send {theirName} this link. It carries their half-key, so only they can act as the{" "}
            {theirRole}.
          </p>
          <div className="invite__row">
            <input className="input invite__url" readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
            <button type="button" className="btn btn--sm" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      )}

      <div className="standin">
        <div className="standin__row">
          <button
            type="button"
            className={standIn ? "btn btn--sm btn--primary" : "btn btn--sm"}
            onClick={() => setStandIn(!standIn)}
            aria-pressed={standIn}
            disabled={!canStandIn}
          >
            {standIn ? "Stand-in is playing" : "Let a stand-in play them"}
          </button>
          {standIn && (
            <>
              <select
                className="select"
                style={{ width: "auto", minHeight: 34, fontSize: "var(--text-xs)" }}
                value={mood}
                onChange={(e) => setMood(e.target.value as StandInMood)}
                aria-label="Stand-in disposition"
              >
                {(Object.keys(MOOD_LABEL) as StandInMood[]).map((m) => (
                  <option key={m} value={m}>
                    {MOOD_LABEL[m]}
                  </option>
                ))}
              </select>
              <select
                className="select"
                style={{ width: "auto", minHeight: 34, fontSize: "var(--text-xs)" }}
                value={mode}
                onChange={(e) => setMode(e.target.value as AgentMode)}
                aria-label="Stand-in brain"
                disabled={!modelAvailable}
              >
                <option value="rules">rules</option>
                <option value="model">{modelAvailable ? modelName ?? "model" : "model (no API key)"}</option>
              </select>
            </>
          )}
        </div>

        <p className="standin__note">
          {!canStandIn
            ? `Only the device that opened this slate holds ${theirName}'s half-key, so only it can run a stand-in.`
            : standIn
              ? `${theirName} is being stood in for. The stand-in holds its own model context: it discovers what it may do with getTools() on that context and acts through executeTool(). What it wants and cannot get shows up below as a refusal.`
              : `Or hand ${theirName}'s half to a stand-in and play alone.`}
        </p>

        {standIn && (
          <div className="trace" aria-live="polite" aria-label="Stand-in agent trace">
            <div className="trace__head">
              <span className="label">What the stand-in sees</span>
              {trace.length > 0 && (
                <button type="button" className="btn btn--sm btn--ghost" onClick={onClearTrace}>
                  Clear
                </button>
              )}
            </div>
            {trace.length === 0 ? (
              <p className="trace__empty">Waiting for its first turn.</p>
            ) : (
              <ol className="trace__list">
                {trace.slice(-10).map((e) => (
                  <li key={e.id} className="trace__item" data-kind={e.kind}>
                    <span className="trace__kind">{kindLabel(e.kind)}</span>
                    <span className="trace__text">{e.text}</span>
                  </li>
                ))}
              </ol>
            )}
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
