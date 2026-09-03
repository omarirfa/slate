"use client";

import { useEffect, useState } from "react";

/**
 * A twelve-second loop that shows the mechanic before a word of explanation:
 * a nudge is used, used again, and the nudge tool rubs out with the clause
 * that closed it. Reduced motion shows the final frame.
 */
export default function HeroLoop() {
  const [phase, setPhase] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase(3);
      return;
    }
    const steps = [2200, 2200, 2200, 4400];
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      i = (i + 1) % 4;
      if (i === 0) {
        // Crossfade back to the start rather than snapping.
        setFading(true);
        setTimeout(() => {
          setPhase(0);
          setFading(false);
        }, 300);
      } else {
        setPhase(i);
      }
      timer = setTimeout(tick, steps[i]);
    };
    timer = setTimeout(tick, steps[0]);
    return () => clearTimeout(timer);
  }, []);

  const left = phase === 0 ? 2 : phase === 1 ? 1 : 0;
  const closed = phase === 3;

  return (
    <div className={`loop${fading ? " loop--fading" : ""}`} aria-hidden="true">
      <div className="loop__head">What Priya can do right now</div>
      <ul className="loop__list">
        <li className={`loop__row${closed ? " loop__row--closed" : ""}${phase === 1 || phase === 2 ? " loop__row--pressed" : ""}`}>
          <span className="loop__name">Nudge Marcus</span>
          {!closed && (
            <span className="tag" data-kind="budget">
              {left} left this month
            </span>
          )}
          <span className="loop__tool mono">send-reminder</span>
          {closed && <span className="loop__why">You&rsquo;ve used both nudges this month. Slate holds the next for 28 days.</span>}
        </li>
        <li className="loop__row">
          <span className="loop__name">Confirm $400 landed</span>
          <span className="loop__tool mono">confirm-payment</span>
        </li>
        <li className="loop__row">
          <span className="loop__name">Wipe the slate</span>
          <span className="tag" data-kind="destructive">
            can&rsquo;t be undone
          </span>
          <span className="loop__tool mono">forgive-remaining</span>
        </li>
      </ul>
      <ol className="loop__ledger">
        {phase >= 2 && <li>Priya nudged Marcus. 0 of 2 left this month.</li>}
        {phase >= 1 && <li>Priya nudged Marcus. 1 of 2 left this month.</li>}
        <li>Payment was due 1 Oct. 4 days ago.</li>
      </ol>
    </div>
  );
}
