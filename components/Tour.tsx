"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A guided tour for the demo.
 *
 * Rather than an overlay that dims the page, each step rings one real element
 * and scrolls it into view. Nothing is covered and nothing is disabled, so the
 * slate stays usable while the tour is open — the point is to say where to
 * look, not to take the page away.
 *
 * Steps whose target is not on the page right now are skipped, because what is
 * on screen changes as the loan moves from drafting to active.
 */

export type TourStep = {
  /** CSS selector for the element to ring. */
  target: string;
  title: string;
  body: string;
};

export const TOUR: TourStep[] = [
  {
    target: ".sec--board",
    title: "The slate",
    body: "The agreement as it stands: the amount, the schedule, and whether both halves have signed. Everything else on this page is downstream of it.",
  },
  {
    target: ".clock",
    title: "A simulated clock",
    body: "Real clauses depend on time. Push the date forward and watch which capabilities appear and disappear as due dates pass and cure periods run.",
  },
  {
    target: ".panel--actions, .actions",
    title: "What you can do right now",
    body: "Not a menu of everything, filtered by a permission check. These are the tools registered on your model context at this moment — an agent reading the page sees exactly this list and nothing more.",
  },
  {
    target: ".actions__toggle",
    title: "What you cannot do",
    body: "Closed capabilities are collapsed here. When a clause shuts one, the tool is removed rather than guarded, so there is nothing left to call — even by a forged request.",
  },
  {
    target: ".pair",
    title: "The bank and the ledger",
    body: "The bank is a separate origin with its own tools, exposed only to this page. Money moves on the left; the slate records it on the right. Watch a payment cross from one to the other.",
  },
  {
    target: ".col--demo",
    title: "Play it through",
    body: "Seventeen steps from a blank slate to a hardship pause, both halves, each one a real tool call. Two are refused on purpose — those are the ones worth watching.",
  },
];

export default function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const present = useCallback(
    (n: number) => (TOUR[n] ? document.querySelector<HTMLElement>(TOUR[n].target) : null),
    []
  );

  /** Walk in `dir` until a step whose target actually exists on this page. */
  const step = useCallback(
    (from: number, dir: 1 | -1) => {
      for (let n = from; n >= 0 && n < TOUR.length; n += dir) {
        if (present(n)) return n;
      }
      return -1;
    },
    [present]
  );

  useEffect(() => {
    const n = step(0, 1);
    if (n < 0) onClose();
    else setI(n);
  }, [step, onClose]);

  useEffect(() => {
    const el = present(i);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const measure = () => setRect(el.getBoundingClientRect());
    const t = setTimeout(measure, 420);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [i, present]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const next = () => {
    const n = step(i + 1, 1);
    if (n < 0) onClose();
    else setI(n);
  };
  const prev = () => {
    const n = step(i - 1, -1);
    if (n >= 0) setI(n);
  };

  const s = TOUR[i];
  if (!s) return null;

  return (
    <>
      {rect && (
        <div
          className="tour__ring"
          aria-hidden="true"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}
      <div className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title">
        <p className="tour__count mono">
          {i + 1} of {TOUR.length}
        </p>
        <h2 className="tour__title" id="tour-title">
          {s.title}
        </h2>
        <p className="tour__body">{s.body}</p>
        <div className="tour__row">
          <button type="button" className="btn btn--sm btn--ghost" onClick={onClose}>
            Close
          </button>
          <div className="tour__spacer" />
          <button type="button" className="btn btn--sm" onClick={prev} disabled={step(i - 1, -1) < 0}>
            Back
          </button>
          <button type="button" className="btn btn--sm btn--primary" onClick={next}>
            {step(i + 1, 1) < 0 ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}
