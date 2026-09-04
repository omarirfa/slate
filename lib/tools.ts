import {
  arrears,
  capabilities,
  capability,
  confirmedTotal,
  daysOverdue,
  formatDay,
  installmentAmount,
  money,
  nameFor,
  nextDueDay,
  other,
  outstanding,
  pendingPayments,
  phase,
  reminderUsage,
} from "./engine";
import { LoanState, Role } from "./types";
import type { ToolSpec } from "./webmcp";

export type Dispatch = (
  type: string,
  payload?: Record<string, unknown>
) => Promise<{ ok: boolean; message: string }>;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const text = (content: string) => ({ content: [{ type: "text", text: content }] });

/** A human-readable digest of the slate. The read tool an agent should call first. */
export function summarise(s: LoanState, role: Role): string {
  const t = s.terms;
  const p = phase(s);
  const out = outstanding(s);
  const late = arrears(s);
  const overdue = daysOverdue(s);
  const next = nextDueDay(s);
  const budget = reminderUsage(s);
  const lines: string[] = [];

  lines.push(`Slate between ${t.lenderName} (lender) and ${t.borrowerName} (borrower).`);
  lines.push(`You are the ${role}. Today is ${formatDay(s.day)}.`);
  lines.push(`Status: ${p}.`);
  lines.push(
    `Principal ${money(t.principal, t.currency)}; confirmed repaid ${money(
      confirmedTotal(s),
      t.currency
    )}; outstanding ${money(out, t.currency)}.`
  );
  lines.push(
    `Schedule: ${t.installmentCount} payments of ${money(
      installmentAmount(t),
      t.currency
    )} every ${t.cadenceDays} days.`
  );
  if (next !== null) {
    const delta = next - s.day;
    lines.push(
      delta >= 0
        ? `Next payment due ${formatDay(next)} (in ${delta} days).`
        : `Payment was due ${formatDay(next)}, ${-delta} days ago.`
    );
  }
  if (late > 0) lines.push(`Arrears ${money(late, t.currency)}, ${overdue} days overdue.`);
  const pend = pendingPayments(s);
  if (pend.length) {
    lines.push(
      `${pend.length} payment(s) logged but not yet confirmed: ${pend
        .map((x) => money(x.amount, t.currency))
        .join(", ")}.`
    );
  }
  if (s.extension.status === "pending") {
    lines.push(
      `${t.borrowerName} has asked for ${s.extension.extraDays} more days${
        s.extension.reason ? ` (${s.extension.reason})` : ""
      }. The lender owes an answer.`
    );
  }
  lines.push(
    `Reminder budget: ${budget.used} of ${budget.total} used this month${
      budget.resetsInDays ? `, resets in ${budget.resetsInDays} days` : ""
    }.`
  );

  const caps = capabilities(s, role);
  const open = caps.filter((c) => c.available).map((c) => c.name);
  const shut = caps.filter((c) => !c.available).map((c) => c.name);
  lines.push(`Capabilities open to you right now: ${open.join(", ") || "none"}.`);
  lines.push(
    `Not currently available: ${shut.join(", ") || "none"}. Call explain-locked-capability for the clause behind any of them.`
  );
  return lines.join("\n");
}

/**
 * Builds the tool surface for one party. Only capabilities that are actually
 * available become tools — a locked clause is an absent tool, not a tool that
 * returns an error.
 */
export function buildTools(s: LoanState, role: Role, dispatch: Dispatch): ToolSpec[] {
  const t = s.terms;
  const caps = capabilities(s, role);
  const has = (name: string) => Boolean(capability(s, role, name)?.available);
  const specs: ToolSpec[] = [];

  // A refused call still returns content — the agent should read why — but it
  // is marked so a caller can tell a refusal from a result.
  const run = (type: string) => async (args: Record<string, unknown> = {}) => {
    const res = await dispatch(type, args);
    return text(res.ok || /^Refused/.test(res.message) ? res.message : `Refused: ${res.message}`);
  };

  /* ------------------------------------------------------------ read tools */

  if (has("get-loan-summary")) {
    specs.push({
      name: "get-loan-summary",
      description:
        "Read the current state of this loan: balances, schedule, arrears, pending requests, reminder budget, and which capabilities are open to you right now. Call this before anything else.",
      inputSchema: obj({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
      execute: async () => text(summarise(s, role)),
    });
  }

  if (has("explain-locked-capability")) {
    specs.push({
      name: "explain-locked-capability",
      description:
        "Explain why a particular capability is not currently available, naming the clause of the agreement responsible. Use this instead of guessing why an action cannot be taken.",
      inputSchema: obj(
        {
          capability: {
            type: "string",
            description:
              "Name of the capability to explain, e.g. 'declare-default' or 'send-reminder'.",
            enum: caps.map((c) => c.name),
          },
        },
        ["capability"]
      ),
      annotations: { readOnlyHint: true, idempotentHint: true },
      execute: async (args: { capability?: string }) => {
        const c = caps.find((x) => x.name === args?.capability);
        if (!c) return text(`No capability named "${args?.capability}" exists on this slate.`);
        if (c.available) {
          return text(`${c.name} is available to you. Clause: ${c.clause}`);
        }
        return text(
          `${c.name} is not available to you.\nReason: ${c.reason}\nClause: ${c.clause}`
        );
      },
    });
  }

  /* --------------------------------------------------------------- terms */

  if (has("propose-terms")) {
    specs.push({
      name: "propose-terms",
      description:
        "Propose or revise the terms of the loan before it is signed. Proposing resets both signatures and registers an accept-terms capability on the other party.",
      inputSchema: obj({
        principal: { type: "number", description: `Amount lent, in ${t.currency} major units, e.g. 2400.` },
        installmentCount: { type: "number", description: "How many repayments, 1 to 36." },
        cadenceDays: { type: "number", description: "Days between repayments, 7 to 90." },
        reminderBudget: {
          type: "number",
          description:
            "How many reminders the lender may send in any 30-day window. This is the clause that protects the friendship; 2 is the default.",
        },
        cureDays: {
          type: "number",
          description:
            "Days an overdue payment must sit before the lender may declare default.",
        },
        lenderName: { type: "string", description: "Display name of the lender." },
        borrowerName: { type: "string", description: "Display name of the borrower." },
      }),
      execute: run("propose-terms"),
    });
  }

  if (has("accept-terms")) {
    specs.push({
      name: "accept-terms",
      description:
        "Accept the terms the other party proposed. This capability exists only because a proposal is outstanding.",
      inputSchema: obj({}),
      execute: run("accept-terms"),
    });
  }

  if (has("sign-agreement")) {
    specs.push({
      name: "sign-agreement",
      description:
        "Sign your half of the slate. You can only sign for yourself; the schedule starts when both halves are signed.",
      inputSchema: obj({}),
      execute: run("sign-agreement"),
    });
  }

  /* ------------------------------------------------------------ payments */

  if (has("log-payment")) {
    specs.push({
      name: "log-payment",
      description:
        "Record a repayment you have made. It counts against the balance only once the lender confirms it, and logging one registers a confirm-payment capability on them.",
      inputSchema: obj(
        {
          amount: { type: "number", description: `Amount paid in ${t.currency} major units, e.g. 400.` },
          note: { type: "string", description: "Optional note, e.g. 'bank transfer, ref 8841'." },
        },
        ["amount"]
      ),
      execute: run("log-payment"),
    });
  }

  if (has("confirm-payment")) {
    const pend = pendingPayments(s);
    specs.push({
      name: "confirm-payment",
      description:
        "Confirm that a payment the borrower logged actually arrived. Until you confirm, it does not reduce the balance.",
      inputSchema: obj({
        paymentId: {
          type: "string",
          description: "Which logged payment to confirm. Defaults to the oldest unconfirmed one.",
          enum: pend.map((p) => p.id),
        },
        evidence: {
          type: "string",
          description:
            "Optional. What you checked to confirm it, e.g. a bank transaction reference. Recorded on the ledger.",
        },
      }),
      execute: run("confirm-payment"),
    });
  }

  /* ------------------------------------- the counter-gated reminder clause */

  if (has("send-reminder")) {
    const b = reminderUsage(s);
    specs.push({
      name: "send-reminder",
      description: `Send the borrower a reminder that a payment is due. You have ${
        b.total - b.used
      } of ${b.total} remaining in this 30-day window; when the budget is spent this tool disappears until it resets.`,
      inputSchema: obj({
        message: { type: "string", description: "Optional short message to include." },
      }),
      execute: run("send-reminder"),
    });
  }

  /* --------------------------------------------- the obligation-paired ask */

  if (has("request-extension")) {
    specs.push({
      name: "request-extension",
      description:
        "Ask the lender for more time on the current payment. Making the request registers grant-extension and decline-extension on the lender, so the ask cannot be quietly ignored.",
      inputSchema: obj(
        {
          extraDays: { type: "number", description: "How many extra days you need, 1 to 90." },
          reason: { type: "string", description: "Short reason, shown to the lender." },
        },
        ["extraDays"]
      ),
      execute: run("request-extension"),
    });
  }

  if (has("grant-extension")) {
    specs.push({
      name: "grant-extension",
      description:
        "Grant the borrower the extra days they asked for. Every future due date shifts. This capability exists only while their request is unanswered.",
      inputSchema: obj({}),
      execute: run("grant-extension"),
    });
  }

  if (has("decline-extension")) {
    specs.push({
      name: "decline-extension",
      description:
        "Decline the borrower's request for more time. The refusal is recorded on the slate.",
      inputSchema: obj({
        reason: { type: "string", description: "Optional short reason." },
      }),
      execute: run("decline-extension"),
    });
  }

  /* ------------------------------------------------------ hardship pause */

  if (has("request-hardship-pause")) {
    specs.push({
      name: "request-hardship-pause",
      description: `Take the ${t.pauseDays}-day hardship pause. It is the borrower's to take once a year without asking permission, and it removes the lender's reminder and default capabilities while it runs.`,
      inputSchema: obj({
        reason: { type: "string", description: "Optional short reason for the record." },
      }),
      execute: run("request-hardship-pause"),
    });
  }

  /* ---------------------------------------------------- consequential end */

  if (has("declare-default")) {
    specs.push({
      name: "declare-default",
      description: `Declare the loan in default. Available only after ${t.cureDays} days overdue, with at least one reminder already sent and no unanswered request for time. This ends the arrangement.`,
      inputSchema: obj({
        acknowledgement: {
          type: "string",
          description: "Type the borrower's name to confirm you intend to do this.",
        },
      }),
      annotations: { destructiveHint: true },
      execute: async (args: { acknowledgement?: string }) => {
        // Forwarded, not checked and discarded — see forgive-remaining above.
        const res = await dispatch("declare-default", { acknowledgement: args?.acknowledgement });
        return text(res.message);
      },
    });
  }

  if (has("forgive-remaining")) {
    specs.push({
      name: "forgive-remaining",
      description:
        "Forgive the entire outstanding balance. Irreversible: it permanently removes every collection capability from this slate, including reminders and default.",
      inputSchema: obj({
        acknowledgement: {
          type: "string",
          description: `Type the outstanding amount in ${t.currency} major units to confirm, e.g. ${Math.round(
            outstanding(s) / 100
          )}.`,
        },
      }),
      annotations: { destructiveHint: true },
      execute: async (args: { acknowledgement?: string }) => {
        // Forwarded, not checked and discarded: the engine enforces this now,
        // so every path is held to it and this wrapper cannot drift from it.
        const res = await dispatch("forgive-remaining", { acknowledgement: args?.acknowledgement });
        return text(res.message);
      },
    });
  }

  return specs;
}

/** Short description of the counterparty, used by the stand-in. */
export function counterpartyLabel(s: LoanState, role: Role): string {
  return nameFor(s, other(role));
}
