"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SCENARIO } from "@/lib/scenario";
import type { Role } from "@/lib/types";

interface Props {
  /**
   * Runs a tool as one party through that party's model context: discover with
   * getTools(), then executeTool(). If the tool is not registered the call is
   * refused by the context itself, which is exactly what the two "expected
   * refusal" steps are there to show.
   */
  runTool: (
    role: Role,
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ ok: boolean; message: string }>;
  /** Clock and reset are not capabilities; they go straight to the room. */
  roomAction: (type: string, payload?: Record<string, unknown>) => Promise<{ ok: boolean; message: string }>;
  /** Called when a step runs, so the parent can suppress its own toasts. */
  onBusyChange?: (busy: boolean) => void;
  /** Without both half-keys this device cannot drive the other party. */
  enabled: boolean;
  /** Start playing as soon as the simulator is able to. */
  autoplay?: boolean;
}

type Mode = "idle" | "playing" | "paused" | "done";

/**
 * Plays the whole agreement end to end so someone who has never seen this can
 * just press play. Every step is a real WebMCP call on the acting party's model
 * context — including two steps that are supposed to be refused, because the
 * tool is not registered at that moment.
 */
export default function Simulate({ runTool, roomAction, onBusyChange, enabled, autoplay }: Props) {
  const [mode, setMode] = useState<Mode>("idle");
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const runningRef = useRef(false);
  const cancelRef = useRef(false);

  const step = SCENARIO[Math.min(index, SCENARIO.length - 1)];

  const runOne = useCallback(
    async (i: number) => {
      const s = SCENARIO[i];
      if (!s) return null;
      const res =
        s.action === "advance-clock" || s.action === "reset"
          ? await roomAction(s.action, s.payload ?? {})
          : await runTool(s.role, s.action, s.payload ?? {});
      setResult(res);
      return res;
    },
    [runTool, roomAction]
  );

  // The play loop. Held in a ref so pausing does not restart it.
  useEffect(() => {
    if (mode !== "playing" || runningRef.current) return;
    runningRef.current = true;
    cancelRef.current = false;
    onBusyChange?.(true);

    (async () => {
      let i = index;
      while (i < SCENARIO.length && !cancelRef.current) {
        setIndex(i);
        await runOne(i);
        const hold = SCENARIO[i].holdMs ?? 2600;
        const start = Date.now();
        while (Date.now() - start < hold) {
          if (cancelRef.current) break;
          await new Promise((r) => setTimeout(r, 120));
        }
        i++;
      }
      runningRef.current = false;
      onBusyChange?.(false);
      if (!cancelRef.current) {
        setIndex(SCENARIO.length - 1);
        setMode("done");
      }
    })();

    return () => {
      cancelRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // The walkthrough page hands off with ?autoplay=1: press Play once, on arrival.
  const autoplayed = useRef(false);
  useEffect(() => {
    if (!autoplay || !enabled || autoplayed.current || mode !== "idle") return;
    autoplayed.current = true;
    setMode("playing");
  }, [autoplay, enabled, mode]);

  function play() {
    if (mode === "done") {
      setIndex(0);
      setResult(null);
    }
    setMode("playing");
  }

  function pause() {
    cancelRef.current = true;
    runningRef.current = false;
    onBusyChange?.(false);
    setMode("paused");
  }

  async function stepOnce() {
    if (mode === "playing") return;
    const next = mode === "idle" ? 0 : Math.min(index + (result ? 1 : 0), SCENARIO.length - 1);
    setIndex(next);
    setMode("paused");
    await runOne(next);
  }

  function stop() {
    cancelRef.current = true;
    runningRef.current = false;
    onBusyChange?.(false);
    setMode("idle");
    setIndex(0);
    setResult(null);
  }

  const pct = mode === "idle" ? 0 : ((index + 1) / SCENARIO.length) * 100;

  return (
    <section className="panel" aria-labelledby="sim-title">
      <div className="panel__head">
        <span className="label">Simulate</span>
        <h2 className="panel__title" id="sim-title">
          Play the whole slate
        </h2>
      </div>

      <div className="sim">
        <div className="sim__row">
          {mode === "playing" ? (
            <button type="button" className="btn btn--sm" onClick={pause}>
              Pause
            </button>
          ) : (
            <button type="button" className="btn btn--sm btn--primary" onClick={play} disabled={!enabled}>
              {mode === "done" ? "Play again" : mode === "paused" ? "Resume" : "Play"}
            </button>
          )}
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void stepOnce()}
            disabled={mode === "playing" || !enabled}
          >
            Step
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={stop}
            disabled={mode === "idle"}
          >
            Stop
          </button>
          <span className="sim__count mono">
            {mode === "idle" ? `0 / ${SCENARIO.length}` : `${index + 1} / ${SCENARIO.length}`}
          </span>
        </div>

        <div className="sim__track" role="img" aria-label={`Step ${index + 1} of ${SCENARIO.length}`}>
          <div className="sim__bar" style={{ width: `${pct}%` }} />
        </div>

        {mode !== "idle" && (
          <div className="sim__now" aria-live="polite">
            <p className="sim__caption">{step.caption}</p>
            {result && (
              <p
                className="sim__result"
                data-refused={!result.ok}
                data-expected={step.expectRefusal ? "true" : undefined}
              >
                {result.ok ? "→ " : "refused · "}
                {result.message}
                {!result.ok && step.expectRefusal && " — which is the point."}
              </p>
            )}
          </div>
        )}

        {mode === "idle" && (
          <p className="sim__hint">
            {enabled
              ? "Seventeen steps from a blank slate to a hardship pause. Each one is a real executeTool() call on the acting party's model context. Two of them are meant to be refused, because the tool is not registered at that moment."
              : "Playing both halves needs both half-keys, which only the device that opened the slate holds."}
          </p>
        )}
      </div>
    </section>
  );
}
