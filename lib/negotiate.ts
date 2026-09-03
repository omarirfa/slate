import type { StandInMove } from "./standin";
import type { LoanState, Role, Terms } from "./types";

/**
 * Two agents negotiate the terms; two people sign them.
 *
 * Each party has an opening position and a range it will accept. The agents
 * act only through `propose-terms` and `accept-terms` — `sign-agreement` is
 * never on their list, so the irreversible step stays with the humans. The
 * rules mover below converges in a few rounds: open with your ideal, then
 * meet the other side at the midpoint, and accept as soon as the offer on
 * the table is inside your range.
 */

export interface Position {
  /** What this party opens with. */
  ideal: Pick<Terms, "installmentCount" | "reminderBudget" | "cureDays">;
  /** What this party will put its name to. */
  accepts: {
    installmentCount: [number, number];
    reminderBudget: [number, number];
    cureDays: [number, number];
  };
  /** One sentence, in character, for the model brief and the panel. */
  stance: string;
}

export const POSITIONS: Record<Role, Position> = {
  lender: {
    ideal: { installmentCount: 6, reminderBudget: 3, cureDays: 14 },
    accepts: { installmentCount: [4, 8], reminderBudget: [2, 4], cureDays: [7, 21] },
    stance:
      "You would like the money back over six months, room to nudge three times a month, and a short cure period so a missed payment does not drift.",
  },
  borrower: {
    ideal: { installmentCount: 8, reminderBudget: 1, cureDays: 28 },
    accepts: { installmentCount: [6, 12], reminderBudget: [1, 2], cureDays: [21, 60] },
    stance:
      "You would like eight smaller payments, as few reminders as possible so this stays a friendship, and a long cure period because your income is irregular.",
  },
};

const KEYS = ["installmentCount", "reminderBudget", "cureDays"] as const;
type Key = (typeof KEYS)[number];

export function withinRange(role: Role, t: Pick<Terms, Key>): boolean {
  const a = POSITIONS[role].accepts;
  return KEYS.every((k) => t[k] >= a[k][0] && t[k] <= a[k][1]);
}

function clamp(role: Role, k: Key, v: number): number {
  const [lo, hi] = POSITIONS[role].accepts[k];
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/** Proposals so far, read back from the ledger. */
export function proposalCount(s: LoanState): number {
  return s.events.filter((e) => / proposed terms: /.test(e.text)).length;
}

/** This party's most recent proposal, read back from the ledger. */
export function lastOfferBy(s: LoanState, role: Role): Pick<Terms, Key> | null {
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i];
    if (e.actor !== role) continue;
    const m = /over (\d+) payments, (\d+) reminders per month, (\d+)-day cure period/.exec(e.text);
    if (m) return { installmentCount: Number(m[1]), reminderBudget: Number(m[2]), cureDays: Number(m[3]) };
  }
  return null;
}

export function negotiationSettled(s: LoanState): boolean {
  return Boolean(s.proposal?.accepted);
}

/**
 * What this party wants to do about the terms on the table. Returns at most
 * one move, and never a signature.
 */
export function negotiationWants(s: LoanState, role: Role): StandInMove[] {
  if (negotiationSettled(s)) return [];
  const table = s.proposal;
  const mine = POSITIONS[role];
  const myLast = lastOfferBy(s, role);

  // Nothing proposed yet: the lender opens; the borrower waits.
  if (!table) {
    if (role !== "lender") return [];
    return [
      {
        tool: "propose-terms",
        args: { ...mine.ideal, principal: s.terms.principal / 100 },
        rationale: "Open with what I would like.",
      },
    ];
  }

  // My own proposal is on the table: wait for the answer.
  if (table.by === role) return [];

  const offer = {
    installmentCount: table.terms.installmentCount,
    reminderBudget: table.terms.reminderBudget,
    cureDays: table.terms.cureDays,
  };

  if (withinRange(role, offer)) {
    return [{ tool: "accept-terms", args: {}, rationale: "That is inside what I can live with. Accept." }];
  }

  // Counter. First time: my ideal. After that: meet them halfway from my last
  // offer, clamped to my range, so we converge rather than repeat.
  const base = myLast ?? mine.ideal;
  const counter: Record<Key, number> = { installmentCount: 0, reminderBudget: 0, cureDays: 0 };
  for (const k of KEYS) {
    counter[k] = myLast ? clamp(role, k, (base[k] + offer[k]) / 2) : mine.ideal[k];
  }
  return [
    {
      tool: "propose-terms",
      args: { ...counter, principal: s.terms.principal / 100 },
      rationale: myLast
        ? "Their offer is outside my range; meet them halfway from my last."
        : "Their offer is outside my range; put my own position up.",
    },
  ];
}

export function negotiationBrief(s: LoanState, role: Role): string {
  const p = POSITIONS[role];
  const name = role === "lender" ? s.terms.lenderName : s.terms.borrowerName;
  const r = p.accepts;
  return [
    `You are ${name}, the ${role}, negotiating the terms of a ${s.terms.currency} ${s.terms.principal / 100} loan between friends. ${p.stance}`,
    `You will accept any proposal where installmentCount is ${r.installmentCount[0]}–${r.installmentCount[1]}, reminderBudget is ${r.reminderBudget[0]}–${r.reminderBudget[1]} and cureDays is ${r.cureDays[0]}–${r.cureDays[1]}. Outside that, counter-propose, conceding a little each round so you converge within three or four exchanges.`,
    `Use only the tools you are given. You cannot sign; the two people sign once terms are accepted. Take exactly one action per turn: call get-loan-summary first, then either accept-terms or propose-terms. If it is not your move (your own proposal is on the table), take no action.`,
    `Say what you are doing in one short sentence, in character.`,
  ].join("\n");
}
