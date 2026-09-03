"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { confirmedTotal, dueDay, formatDay, installmentAmount, money, outstanding, pendingPayments, phase } from "@/lib/engine";
import type { LoanState, Role } from "@/lib/types";

interface Props {
  state: LoanState;
  /** Whose screen this is. The sentence is written from their side. */
  viewer: Role;
}

type Mark = "paid" | "said" | "late" | "next" | "upcoming" | "wiped";

/**
 * The object in the middle of the page. It says the one sentence a person
 * would say — who owes whom, how much — and under it the schedule, one dated
 * instalment per mark. Forgiveness rewrites the sentence and strikes the
 * marks left to right.
 */
export default function SlateBoard({ state, viewer }: Props) {
  const t = state.terms;
  const p = phase(state);
  const per = installmentAmount(t);
  const confirmed = confirmedTotal(state);
  const pending = pendingPayments(state).reduce((a, x) => a + x.amount, 0);
  const out = outstanding(state);
  const shown = useTicking(out);
  const lender = t.lenderName;
  const borrower = t.borrowerName;
  const you = viewer === "lender" ? lender : borrower;

  /* ---------------------------------------------------------- schedule */

  const marks: Array<{ amount: number; day: number; state: Mark; lateBy?: number }> = [];
  let nextTaken = false;
  for (let i = 0; i < t.installmentCount; i++) {
    const last = i === t.installmentCount - 1;
    const hi = last ? t.principal : (i + 1) * per;
    const amount = last ? t.principal - per * (t.installmentCount - 1) : per;
    const day = dueDay(state, i);
    let mark: Mark;
    let lateBy: number | undefined;
    if (state.forgiven) mark = "wiped";
    else if (confirmed >= hi) mark = "paid";
    else if (confirmed + pending >= hi) mark = "said";
    else if (p === "active" && state.day >= day) {
      mark = "late";
      lateBy = state.day - day;
    } else if (!nextTaken) {
      mark = "next";
      nextTaken = true;
    } else mark = "upcoming";
    marks.push({ amount, day, state: mark, lateBy });
  }
  const paidCount = marks.filter((m) => m.state === "paid").length;
  const late = marks.find((m) => m.state === "late");
  const next = marks.find((m) => m.state === "next");
  const said = marks.find((m) => m.state === "said");

  /* ---------------------------------------------------------- sentence */

  const me = (name: string, cap: boolean) => (name === you ? (cap ? "You" : "you") : name);
  let line: ReactNode;
  if (state.forgiven) {
    line = <>{me(lender, true)} wiped the slate.</>;
  } else if (p === "settled") {
    line = (
      <>
        {me(borrower, true)} paid {me(lender, false)} back.
      </>
    );
  } else if (p === "drafting") {
    line = (
      <>
        {lender === you ? "You're" : `${lender} is`} lending {me(borrower, false)} <b>{money(t.principal, t.currency)}</b>
      </>
    );
  } else {
    line = (
      <>
        {borrower === you ? "You owe" : `${borrower} owes`} {me(lender, false)} <b>{money(shown, t.currency)}</b>
      </>
    );
  }

  const bits: string[] = [];
  if (p === "drafting") {
    bits.push(`${t.installmentCount} payments of ${money(per, t.currency)} every ${t.cadenceDays} days`);
    bits.push(`${t.reminderBudget} nudge${t.reminderBudget === 1 ? "" : "s"} a month`);
    bits.push(`${t.cureDays}-day cure period`);
    bits.push(state.signatures.lender && state.signatures.borrower ? "signed" : "not signed yet");
  } else if (state.forgiven) {
    bits.push(`${money(t.principal - confirmed, t.currency)} forgiven on ${formatDay(state.forgivenDay ?? state.day)}`);
  } else if (p === "settled") {
    bits.push(`${money(t.principal, t.currency)} over ${paidCount} payment${paidCount === 1 ? "" : "s"}`);
    bits.push("slate clean");
  } else {
    bits.push(`of ${money(t.principal, t.currency)} lent`);
    bits.push(`${paidCount} of ${t.installmentCount} payment${t.installmentCount === 1 ? "" : "s"} made`);
    if (p === "paused" && state.pause.activeUntil !== null) bits.push(`paused until ${formatDay(state.pause.activeUntil)}`);
    else if (p === "defaulted") bits.push(`in default since ${formatDay(state.defaultedDay ?? state.day)}`);
    else if (late) bits.push(`${money(late.amount, t.currency)} is ${late.lateBy} day${late.lateBy === 1 ? "" : "s"} late`);
    else if (said) bits.push(`${money(said.amount, t.currency)} said paid, not yet confirmed`);
    else if (next) bits.push(`next ${money(next.amount, t.currency)} due ${formatDay(next.day)}`);
  }

  const label = (m: (typeof marks)[number]) => {
    switch (m.state) {
      case "paid":
        return "paid";
      case "said":
        return "said paid";
      case "late":
        return `${m.lateBy} day${m.lateBy === 1 ? "" : "s"} late`;
      case "next":
        return "next";
      case "wiped":
        return "wiped";
      default:
        return "";
    }
  };

  return (
    <div className="board" data-phase={p} data-wiped={state.forgiven || undefined}>
      <p className="board__line">{line}</p>
      <p className="board__sub">{bits.join(" · ")}</p>

      {p !== "drafting" && (
        <ol className="board__sched" aria-label="Payment schedule">
          {marks.map((m, i) => (
            <li key={i} className="board__mark" data-state={m.state} style={{ ["--i" as string]: i }}>
              <span className="board__amt">{money(m.amount, t.currency)}</span>
              <span className="board__st">
                {formatDay(m.day).replace(/ \d{4}$/, "")}
                {label(m) ? ` · ${label(m)}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Eases a number toward its target so the amount ticks rather than jumps. */
function useTicking(target: number): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    if (reduce || start === target) {
      from.current = target;
      setValue(target);
      return;
    }
    const t0 = performance.now();
    const dur = 700;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setValue(Math.round(start + (target - start) * e));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value;
}
