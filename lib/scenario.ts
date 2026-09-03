import type { Role } from "./types";

export interface ScenarioStep {
  /** Shown while the step runs. Written for someone who has never seen this. */
  caption: string;
  action: string;
  role: Role;
  payload?: Record<string, unknown>;
  /** Steps that are supposed to be turned down. The refusal is the point. */
  expectRefusal?: boolean;
  /** How long to hold on the result before moving on. */
  holdMs?: number;
}

/**
 * The full arc of a loan between friends: agreed, paid, chased, stretched, and
 * held open. It deliberately includes two actions that get refused, because a
 * capability that is genuinely absent is the thing worth seeing.
 */
export const SCENARIO: ScenarioStep[] = [
  {
    caption: "Starting from a blank slate.",
    action: "reset",
    role: "lender",
    holdMs: 1600,
  },
  {
    caption: "Priya proposes the terms: $2,400 over six payments, two reminders a month, a 21-day cure period.",
    action: "propose-terms",
    role: "lender",
    payload: { principal: 2400, installmentCount: 6, reminderBudget: 2, cureDays: 21 },
    holdMs: 3400,
  },
  {
    caption: "Proposing registered an answer on Marcus. He accepts.",
    action: "accept-terms",
    role: "borrower",
    holdMs: 2600,
  },
  {
    caption: "Priya signs her half. Nobody can sign for the other party.",
    action: "sign-agreement",
    role: "lender",
    holdMs: 2400,
  },
  {
    caption: "Marcus signs his. Both halves signed, so the schedule starts and the payment tools register.",
    action: "sign-agreement",
    role: "borrower",
    holdMs: 3200,
  },
  {
    caption: "A month passes.",
    action: "advance-clock",
    role: "lender",
    payload: { days: 30 },
    holdMs: 2200,
  },
  {
    caption: "Marcus logs his first payment. Logging it registers a confirmation duty on Priya.",
    action: "log-payment",
    role: "borrower",
    payload: { amount: 400, note: "bank transfer" },
    holdMs: 3200,
  },
  {
    caption: "Priya confirms it landed. Until she does, it does not touch the balance.",
    action: "confirm-payment",
    role: "lender",
    holdMs: 3000,
  },
  {
    caption: "Another month passes, and this one goes unpaid. send-reminder registers itself.",
    action: "advance-clock",
    role: "lender",
    payload: { days: 34 },
    holdMs: 3200,
  },
  {
    caption: "Priya sends a reminder. One left this month.",
    action: "send-reminder",
    role: "lender",
    payload: { message: "No rush, just flagging this one." },
    holdMs: 3000,
  },
  {
    caption: "She sends the second. That spends the budget — watch send-reminder come off the page.",
    action: "send-reminder",
    role: "lender",
    holdMs: 4000,
  },
  {
    caption: "A third attempt is refused. The tool is not registered any more, so there is nothing to call.",
    action: "send-reminder",
    role: "lender",
    expectRefusal: true,
    holdMs: 4000,
  },
  {
    caption: "Marcus asks for fourteen more days. The ask registers grant and decline on Priya — it cannot be ignored into silence.",
    action: "request-extension",
    role: "borrower",
    payload: { extraDays: 14, reason: "Short this month — paid what I could." },
    holdMs: 4200,
  },
  {
    caption: "Priya tries to declare default. Refused: the cure period has not run and there is an unanswered request.",
    action: "declare-default",
    role: "lender",
    expectRefusal: true,
    holdMs: 4200,
  },
  {
    caption: "She grants the time instead. Every due date shifts and both answer tools unregister.",
    action: "grant-extension",
    role: "lender",
    holdMs: 3600,
  },
  {
    caption: "Weeks later Marcus is behind again, and takes the hardship pause that is his once a year.",
    action: "advance-clock",
    role: "lender",
    payload: { days: 40 },
    holdMs: 2400,
  },
  {
    caption: "The pause runs without asking permission, and it takes Priya's reminder and default tools off the board while it lasts.",
    action: "request-hardship-pause",
    role: "borrower",
    payload: { reason: "Lost a contract; need to reset." },
    holdMs: 4600,
  },
];
