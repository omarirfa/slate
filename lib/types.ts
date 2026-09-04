export type Role = "lender" | "borrower";

export const EPOCH = Date.UTC(2026, 8, 1); // 1 Sep 2026, day 0
export const DAY_MS = 86_400_000;

export interface Terms {
  principal: number; // minor units
  currency: string;
  lenderName: string;
  borrowerName: string;
  installmentCount: number;
  cadenceDays: number;
  /** Reminders the lender may send per 30-day window. The relationship clause. */
  reminderBudget: number;
  /** Days an overdue installment must sit before default can be declared. */
  cureDays: number;
  /** Days a hardship pause runs for. */
  pauseDays: number;
}

export interface Payment {
  id: string;
  day: number;
  amount: number;
  note?: string;
  confirmed: boolean;
  confirmedDay?: number;
}

export interface ExtensionRequest {
  status: "none" | "pending" | "granted" | "declined";
  requestedDay?: number;
  extraDays?: number;
  reason?: string;
  resolvedDay?: number;
}

export interface LedgerEvent {
  id: string;
  day: number;
  actor: Role | "system";
  /** How the action arrived: through a WebMCP tool call, or the plain UI. */
  via: "tool" | "ui" | "clock";
  tool?: string;
  text: string;
}

export interface TermsProposal {
  by: Role;
  day: number;
  terms: Terms;
  accepted: boolean;
}

export interface LoanState {
  room: string;
  day: number;
  terms: Terms;
  proposal: TermsProposal | null;
  signatures: { lender: boolean; borrower: boolean };
  payments: Payment[];
  reminderDays: number[];
  extension: ExtensionRequest;
  pause: { lastUsedDay: number | null; activeUntil: number | null };
  forgiven: boolean;
  forgivenDay: number | null;
  /** Each party's Bramble Bank account number, once they have one. Public; the secret stays on their device. */
  bankAccounts?: Partial<Record<Role, string>>;
  defaulted: boolean;
  defaultedDay: number | null;
  events: LedgerEvent[];
  /** Which role, if any, is played by the built-in stand-in rather than a person. */
  simulatedRole: Role | null;
  createdAt: number;
}

export type Phase = "drafting" | "active" | "paused" | "settled" | "forgiven" | "defaulted";

export interface CapabilityView {
  name: string;
  title: string;
  /** Which clause of the agreement puts this capability on or off the table. */
  clause: string;
  available: boolean;
  /** Present only when unavailable — the reason the tool is not registered. */
  reason?: string;
  destructive?: boolean;
  readOnly?: boolean;
  /** For counter-gated capabilities: how much budget is left. */
  budget?: { used: number; total: number; resetsInDays: number };
  /** Capability this one hands to the other party when invoked. */
  registersForCounterparty?: string;
}

export const DEFAULT_TERMS: Terms = {
  principal: 240000,
  currency: "USD",
  lenderName: "Amicia",
  borrowerName: "Hugo",
  installmentCount: 6,
  cadenceDays: 30,
  reminderBudget: 2,
  cureDays: 21,
  pauseDays: 30,
};
