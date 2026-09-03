import {
  arrears,
  daysOverdue,
  installmentAmount,
  nextDueDay,
  outstanding,
  pendingPayments,
  phase,
} from "./engine";
import { LoanState, Role } from "./types";

export interface StandInMove {
  tool: string;
  args: Record<string, unknown>;
  /** Shown in the trace so it is never mistaken for a person. */
  rationale: string;
}

export type StandInMood = "reliable" | "stretched" | "avoidant";

export const MOOD_LABEL: Record<StandInMood, string> = {
  reliable: "pays on time",
  stretched: "short this month",
  avoidant: "goes quiet",
};

/**
 * What the stand-in would like to do next, in order of preference, judged
 * only from the figures on the slate. It does NOT consult the capability
 * gates. The agent that runs it discovers the tools actually registered on
 * its own model context and takes the first wish that is on the surface;
 * every wish that is not gets recorded as a refusal. That is deliberate: a
 * wish for `declare-default` that meets no such tool is the point of the
 * whole design, and hiding it behind an `if` would hide the demonstration.
 *
 * Deterministic and readable on purpose: no model call, no API key.
 */
export function desires(s: LoanState, role: Role, mood: StandInMood): StandInMove[] {
  const t = s.terms;
  const per = installmentAmount(t);
  const p = phase(s);
  const overdue = daysOverdue(s);
  const next = nextDueDay(s);
  const dueIn = next === null ? Infinity : next - s.day;
  const late = arrears(s);
  const wants: StandInMove[] = [];

  /* ---------------------------------------------------------- getting set up */

  if (p === "drafting") {
    if (s.proposal && s.proposal.by !== role && !s.proposal.accepted) {
      wants.push({ tool: "accept-terms", args: {}, rationale: "Terms look reasonable; accept and move on." });
    }
    if (!s.signatures[role] && (s.proposal?.accepted || s.events.some((e) => e.text.includes("accepted the terms")))) {
      wants.push({ tool: "sign-agreement", args: {}, rationale: "Terms are settled; sign my half." });
    }
    if (!s.proposal) {
      wants.push({
        tool: "propose-terms",
        args: { principal: t.principal / 100, installmentCount: t.installmentCount },
        rationale: "Nothing on the table yet; put up the terms we discussed.",
      });
    }
    return wants;
  }

  if (p !== "active" && p !== "paused") return wants;

  /* --------------------------------------------------------------- borrower */

  if (role === "borrower") {
    if (outstanding(s) <= 0) return wants;
    // An unanswered ask stays unanswered; do not pile on.
    if (s.extension.status === "pending") return wants;

    const owes = late > 0 ? late : dueIn <= 2 ? per : 0;
    if (owes <= 0) return wants;

    if (mood === "reliable") {
      wants.push({
        tool: "log-payment",
        args: { amount: Math.min(owes, outstanding(s)) / 100, note: "standing transfer" },
        rationale: "Payment is due and the money is there; pay it.",
      });
    }

    if (mood === "stretched") {
      if (overdue > 3) {
        wants.push({
          tool: "request-extension",
          args: { extraDays: 14, reason: "Short this month — paid what I could." },
          rationale: "Cannot cover it in full; ask rather than disappear.",
        });
      }
      const partial = Math.max(Math.round(per * 0.4), 1000);
      wants.push({
        tool: "log-payment",
        args: { amount: Math.min(partial, outstanding(s)) / 100, note: "part payment" },
        rationale: "Cannot cover the full instalment; send what I can.",
      });
    }

    if (mood === "avoidant") {
      if (overdue > 10) {
        wants.push({
          tool: "request-hardship-pause",
          args: { reason: "Lost a contract; need to reset." },
          rationale: "Far enough behind that the pause is the honest move.",
        });
      }
      if (overdue > 20) {
        wants.push({
          tool: "log-payment",
          args: { amount: Math.min(per, outstanding(s)) / 100, note: "catching up" },
          rationale: "Been quiet too long; get something on the record.",
        });
      }
    }
    return wants;
  }

  /* ----------------------------------------------------------------- lender */

  const pend = pendingPayments(s)[0];
  if (pend) {
    wants.push({
      tool: "confirm-payment",
      args: { paymentId: pend.id },
      rationale: "A payment is waiting on me; confirm it so the balance is honest.",
    });
  }

  if (s.extension.status === "pending") {
    if (mood === "avoidant") {
      wants.push({
        tool: "decline-extension",
        args: { reason: "I need the schedule to hold." },
        rationale: "Cannot carry the delay this time.",
      });
    } else {
      wants.push({
        tool: "grant-extension",
        args: {},
        rationale: "They asked instead of vanishing; give them the time.",
      });
    }
  }

  // The avoidant lender reaches for default the moment the cure period is
  // up, whether or not the other conditions hold. Usually it is not there.
  if (mood === "avoidant" && overdue >= t.cureDays) {
    wants.push({
      tool: "declare-default",
      args: { acknowledgement: t.borrowerName },
      rationale: "Cure period has run; end it.",
    });
  }

  // Every lender wants to chase once something is late. The reminder budget
  // decides whether the tool is there to be used.
  if (overdue > 5) {
    wants.push({
      tool: "send-reminder",
      args: { message: mood === "avoidant" ? "This is overdue." : "No rush, just flagging this one." },
      rationale: "Overdue; use a reminder if I have one.",
    });
  }

  return wants;
}
