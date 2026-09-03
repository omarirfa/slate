import {
  CapabilityView,
  DAY_MS,
  DEFAULT_TERMS,
  EPOCH,
  LedgerEvent,
  LoanState,
  Payment,
  Phase,
  Role,
  Terms,
} from "./types";

/* ---------------------------------------------------------------- helpers */

let seq = 0;
export function uid(prefix = "id"): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export function dayToDate(day: number): Date {
  return new Date(EPOCH + day * DAY_MS);
}

export function formatDay(day: number): string {
  return dayToDate(day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

export function other(role: Role): Role {
  return role === "lender" ? "borrower" : "lender";
}

export function nameFor(state: LoanState, role: Role): string {
  return role === "lender" ? state.terms.lenderName : state.terms.borrowerName;
}

/* ------------------------------------------------------------ new session */

export function newLoan(room: string, terms: Terms = DEFAULT_TERMS): LoanState {
  return {
    room,
    day: 0,
    terms: { ...terms },
    proposal: null,
    signatures: { lender: false, borrower: false },
    payments: [],
    reminderDays: [],
    extension: { status: "none" },
    pause: { lastUsedDay: null, activeUntil: null },
    forgiven: false,
    forgivenDay: null,
    bankAccounts: {},
    defaulted: false,
    defaultedDay: null,
    simulatedRole: null,
    createdAt: Date.now(),
    events: [
      {
        id: uid("ev"),
        day: 0,
        actor: "system",
        via: "clock",
        text: "Slate opened. Neither half is signed yet.",
      },
    ],
  };
}

/* --------------------------------------------------------- derived values */

export function phase(s: LoanState): Phase {
  if (s.forgiven) return "forgiven";
  if (s.defaulted) return "defaulted";
  if (!s.signatures.lender || !s.signatures.borrower) return "drafting";
  if (outstanding(s) <= 0) return "settled";
  if (s.pause.activeUntil !== null && s.day < s.pause.activeUntil) return "paused";
  return "active";
}

export function installmentAmount(t: Terms): number {
  return Math.round(t.principal / t.installmentCount);
}

/** Total days the schedule has slipped, from granted extensions and hardship pauses. */
export function scheduleShift(s: LoanState): number {
  let shift = 0;
  if (s.extension.status === "granted" && s.extension.extraDays) {
    shift += s.extension.extraDays;
  }
  if (s.pause.lastUsedDay !== null) shift += s.terms.pauseDays;
  return shift;
}

export function signedDay(s: LoanState): number {
  const ev = s.events.find((e) => e.text.startsWith("Agreement signed by both"));
  return ev ? ev.day : 0;
}

/** Due date of installment i (0-indexed), in sim days. */
export function dueDay(s: LoanState, i: number): number {
  return signedDay(s) + (i + 1) * s.terms.cadenceDays + scheduleShift(s);
}

export function confirmedTotal(s: LoanState): number {
  return s.payments.filter((p) => p.confirmed).reduce((a, p) => a + p.amount, 0);
}

export function pendingPayments(s: LoanState): Payment[] {
  return s.payments.filter((p) => !p.confirmed);
}

export function outstanding(s: LoanState): number {
  if (s.forgiven) return 0;
  return Math.max(0, s.terms.principal - confirmedTotal(s));
}

/** How much the schedule says should have been paid by today. */
export function expectedByNow(s: LoanState): number {
  const per = installmentAmount(s.terms);
  let due = 0;
  for (let i = 0; i < s.terms.installmentCount; i++) {
    if (s.day >= dueDay(s, i)) due += per;
  }
  return Math.min(due, s.terms.principal);
}

export function arrears(s: LoanState): number {
  if (phase(s) === "paused") return 0;
  return Math.max(0, expectedByNow(s) - confirmedTotal(s));
}

/** Days since the earliest installment that still is not covered. */
export function daysOverdue(s: LoanState): number {
  if (arrears(s) <= 0) return 0;
  const per = installmentAmount(s.terms);
  const paid = confirmedTotal(s);
  for (let i = 0; i < s.terms.installmentCount; i++) {
    const coveredThrough = (i + 1) * per;
    if (paid < coveredThrough && s.day >= dueDay(s, i)) {
      return s.day - dueDay(s, i);
    }
  }
  return 0;
}

export function nextDueDay(s: LoanState): number | null {
  const per = installmentAmount(s.terms);
  const paid = confirmedTotal(s);
  for (let i = 0; i < s.terms.installmentCount; i++) {
    if (paid < (i + 1) * per) return dueDay(s, i);
  }
  return null;
}

/* ------------------------------------------ the relationship clause: budget */

const REMINDER_WINDOW = 30;

export function reminderUsage(s: LoanState) {
  const windowStart = s.day - REMINDER_WINDOW;
  const used = s.reminderDays.filter((d) => d > windowStart).length;
  const oldestInWindow = s.reminderDays.filter((d) => d > windowStart).sort((a, b) => a - b)[0];
  const resetsInDays =
    used >= s.terms.reminderBudget && oldestInWindow !== undefined
      ? Math.max(0, oldestInWindow + REMINDER_WINDOW - s.day)
      : 0;
  return { used, total: s.terms.reminderBudget, resetsInDays };
}

export function pauseAvailableIn(s: LoanState): number {
  if (s.pause.lastUsedDay === null) return 0;
  return Math.max(0, s.pause.lastUsedDay + 365 - s.day);
}

/* ------------------------------------------------------ CAPABILITY SURFACE */
/* This function is the product. Everything the UI shows and every tool the   */
/* page registers with the browser is derived from it — one source of truth.  */

export function capabilities(s: LoanState, role: Role): CapabilityView[] {
  const p = phase(s);
  const isLender = role === "lender";
  const isBorrower = role === "borrower";
  const live = p === "active" || p === "paused";
  const budget = reminderUsage(s);
  const pauseWait = pauseAvailableIn(s);
  const overdue = daysOverdue(s);
  const near = nextDueDay(s);
  const dueSoon = near !== null && near - s.day <= 7;

  const them = nameFor(s, other(role));
  const caps: CapabilityView[] = [];

  /* ---- read tools, always on ---- */
  caps.push({
    name: "get-loan-summary",
    title: "Read the slate",
    clause: "Both halves show the same figures at all times.",
    available: true,
    readOnly: true,
  });
  caps.push({
    name: "explain-locked-capability",
    title: "Ask why something is locked",
    clause: "Either party may ask which clause is holding a capability shut.",
    available: true,
    readOnly: true,
  });

  /* ---- drafting ---- */
  const bothSigned = s.signatures.lender && s.signatures.borrower;
  caps.push({
    name: "propose-terms",
    title: "Propose terms",
    clause: "Terms may be revised freely until both halves are signed.",
    available: p === "drafting" && !s.signatures[role],
    reason: s.signatures[role]
      ? "You have already signed. Terms are fixed once your half is signed."
      : p !== "drafting"
        ? "The agreement is signed. Terms are closed."
        : undefined,
    registersForCounterparty: "accept-terms",
  });

  const proposalForMe = s.proposal && s.proposal.by !== role && !s.proposal.accepted;
  caps.push({
    name: "accept-terms",
    title: "Accept proposed terms",
    clause: "A proposal registers an answer on the other half. It cannot be ignored quietly.",
    available: Boolean(proposalForMe) && p === "drafting",
    reason: !s.proposal
      ? "No terms have been proposed to you."
      : s.proposal.by === role
        ? "These are your own terms. The other half answers."
        : s.proposal.accepted
          ? "Already accepted."
          : p !== "drafting"
            ? "The agreement is signed."
            : undefined,
  });

  const termsSettled = Boolean(s.proposal?.accepted) || s.events.some((e) => e.text.includes("accepted the terms"));
  caps.push({
    name: "sign-agreement",
    title: "Sign your half",
    clause: "Nothing starts until both halves are signed. No party may sign for the other.",
    available: p === "drafting" && !s.signatures[role] && termsSettled,
    reason: s.signatures[role]
      ? "Your half is already signed."
      : !termsSettled
        ? "Terms have not been agreed by both parties yet."
        : p !== "drafting"
          ? "Already signed."
          : undefined,
  });

  /* ---- borrower, live ---- */
  caps.push({
    name: "log-payment",
    title: "Log a payment",
    clause: "The borrower records payments. Only the lender can confirm receipt.",
    available: isBorrower && live && outstanding(s) > 0,
    reason: !isBorrower
      ? "Only the borrower logs payments."
      : !live
        ? `The slate is ${p}.`
        : "Nothing outstanding.",
    registersForCounterparty: "confirm-payment",
  });

  caps.push({
    name: "confirm-payment",
    title: "Confirm a payment landed",
    clause: "A logged payment registers a confirmation duty on the lender.",
    available: isLender && pendingPayments(s).length > 0 && live,
    reason: !isLender
      ? "Only the lender confirms receipt."
      : pendingPayments(s).length === 0
        ? "No payment is waiting for confirmation."
        : `The slate is ${p}.`,
  });

  /* ---- the reminder budget: the counter-gated clause ---- */
  const reminderRoom = budget.used < budget.total;
  caps.push({
    name: "send-reminder",
    title: "Send a reminder",
    clause: `Two reminders per 30 days. The capability is spent when the budget is spent.`,
    available: isLender && p === "active" && reminderRoom && (overdue > 0 || dueSoon),
    reason: !isLender
      ? "Only the lender sends reminders."
      : p === "paused"
        ? "The hardship pause is running. Chasing is off the table until it ends."
        : p !== "active"
          ? `The slate is ${p}.`
          : !reminderRoom
          ? `Reminder budget spent. It returns in ${budget.resetsInDays} day${budget.resetsInDays === 1 ? "" : "s"}.`
          : "Nothing is due or overdue right now.",
    budget,
  });

  /* ---- extension: the obligation pair ---- */
  caps.push({
    name: "request-extension",
    title: "Ask for more time",
    clause: "Asking registers an answer on the lender. Silence is not an option they have.",
    available: isBorrower && live && s.extension.status !== "pending" && (dueSoon || overdue > 0),
    reason: !isBorrower
      ? "Only the borrower asks for time."
      : s.extension.status === "pending"
        ? "A request is already pending an answer."
        : !live
          ? `The slate is ${p}.`
          : "Nothing is due or overdue right now.",
    registersForCounterparty: "grant-extension",
  });

  const pendingExt = s.extension.status === "pending";
  caps.push({
    name: "grant-extension",
    title: "Grant more time",
    clause: "Registered on the lender the moment a request is made.",
    available: isLender && pendingExt,
    reason: !isLender
      ? "Only the lender answers a request."
      : "No request is pending.",
  });
  caps.push({
    name: "decline-extension",
    title: "Decline the request",
    clause: "Declining is on the record, and it clears the borrower to propose a catch-up.",
    available: isLender && pendingExt,
    reason: !isLender
      ? "Only the lender answers a request."
      : "No request is pending.",
  });

  /* ---- hardship pause: once a year ---- */
  caps.push({
    name: "request-hardship-pause",
    title: "Take the hardship pause",
    clause: `One ${s.terms.pauseDays}-day pause per year, taken by the borrower without asking.`,
    available: isBorrower && p === "active" && pauseWait === 0 && outstanding(s) > 0,
    reason: !isBorrower
      ? "The pause belongs to the borrower alone."
      : pauseWait > 0
        ? `Already used. Available again in ${pauseWait} days.`
        : p === "paused"
          ? "The pause is already running."
          : `The slate is ${p}.`,
  });

  /* ---- default: gated behind the cure period ---- */
  const cured = overdue >= s.terms.cureDays;
  const remindedFirst = s.reminderDays.length > 0;
  caps.push({
    name: "declare-default",
    title: "Declare the loan in default",
    clause: `Only after ${s.terms.cureDays} days overdue, at least one reminder, and no pending request.`,
    available: isLender && p === "active" && cured && remindedFirst && !pendingExt,
    destructive: true,
    reason: !isLender
      ? "Only the lender may declare default."
      : p === "paused"
        ? "The hardship pause is running. Default is off the table until it ends."
        : p !== "active"
          ? `The slate is ${p}.`
          : pendingExt
          ? "A request for time is pending. Answer it first."
          : !cured
            ? overdue > 0
              ? `${s.terms.cureDays - overdue} more days of the cure period to run.`
              : "Nothing is overdue."
            : "No reminder has been sent. The cure period assumes the borrower was told.",
  });

  /* ---- forgiveness: lender only, irreversible ---- */
  caps.push({
    name: "forgive-remaining",
    title: "Wipe the slate",
    clause: "The lender's alone. It wipes the slate and takes every collection capability with it, for good.",
    available: isLender && live && outstanding(s) > 0,
    destructive: true,
    reason: !isLender
      ? "Only the lender may forgive."
      : outstanding(s) <= 0
        ? "Nothing is outstanding."
        : `The slate is ${p}.`,
  });

  return caps;
}

export function capability(s: LoanState, role: Role, name: string): CapabilityView | undefined {
  return capabilities(s, role).find((c) => c.name === name);
}

/* --------------------------------------------------------------- mutation */

export interface Action {
  type: string;
  role: Role;
  via?: "tool" | "ui" | "clock";
  payload?: Record<string, unknown>;
}

export interface ActionResult {
  ok: boolean;
  state: LoanState;
  message: string;
  /** Capability names that changed availability as a result. */
  changed: string[];
}

function log(s: LoanState, e: Omit<LedgerEvent, "id" | "day">): void {
  s.events.push({ id: uid("ev"), day: s.day, ...e });
  if (s.events.length > 400) s.events.splice(0, s.events.length - 400);
}

function snapshotCaps(s: LoanState): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const role of ["lender", "borrower"] as Role[]) {
    for (const c of capabilities(s, role)) out[`${role}:${c.name}`] = c.available;
  }
  return out;
}

function diffCaps(before: Record<string, boolean>, after: Record<string, boolean>): string[] {
  const changed: string[] = [];
  for (const k of Object.keys(after)) {
    if (before[k] !== after[k]) changed.push(`${after[k] ? "+" : "-"}${k}`);
  }
  return changed;
}

export function apply(state: LoanState, action: Action): ActionResult {
  const s: LoanState = JSON.parse(JSON.stringify(state));
  const before = snapshotCaps(s);
  const via = action.via ?? "ui";
  const role = action.role;
  const who = nameFor(s, role);
  const p = action.payload ?? {};
  let message = "";

  const deny = (why: string): ActionResult => ({
    ok: false,
    state,
    message: why,
    changed: [],
  });

  // Every mutation is checked against the capability surface. A tool that is
  // not registered cannot be executed even if the call is forged.
  const gate = (name: string) => {
    const c = capability(s, role, name);
    if (!c || !c.available) {
      return c?.reason ?? "That capability is not available to you right now.";
    }
    return null;
  };

  switch (action.type) {
    case "advance-clock": {
      const by = Math.max(1, Math.min(120, Number(p.days) || 1));
      s.day += by;
      log(s, { actor: "system", via: "clock", text: `Clock advanced ${by} day${by === 1 ? "" : "s"}.` });
      if (s.pause.activeUntil !== null && s.day >= s.pause.activeUntil) {
        s.pause.activeUntil = null;
        log(s, { actor: "system", via: "clock", text: "The hardship pause ended. The schedule resumes." });
      }
      message = `Now ${formatDay(s.day)}.`;
      break;
    }

    case "set-simulated-role": {
      s.simulatedRole = (p.role as Role | null) ?? null;
      message = s.simulatedRole ? `${nameFor(s, s.simulatedRole)} is now stood in for.` : "Both halves are held by people.";
      break;
    }

    // Not a capability: a party recording their own bank account number so the
    // other half can address a transfer to it. The number is public; the
    // secret that operates the account never comes near the slate.
    case "link-bank-account": {
      const id = String(p.accountId ?? "").trim().slice(0, 40);
      if (!id) return deny("An account number is needed.");
      s.bankAccounts = { ...(s.bankAccounts ?? {}), [role]: id };
      message = `${who} linked bank account ${id}.`;
      log(s, { actor: role, via, text: message });
      break;
    }

    case "propose-terms": {
      const why = gate("propose-terms");
      if (why) return deny(why);
      const t: Terms = { ...s.terms };
      if (p.principal !== undefined) t.principal = Math.max(1000, Math.round(Number(p.principal) * 100));
      if (p.installmentCount !== undefined) t.installmentCount = Math.max(1, Math.min(36, Number(p.installmentCount)));
      if (p.cadenceDays !== undefined) t.cadenceDays = Math.max(7, Math.min(90, Number(p.cadenceDays)));
      if (p.reminderBudget !== undefined) t.reminderBudget = Math.max(0, Math.min(10, Number(p.reminderBudget)));
      if (p.cureDays !== undefined) t.cureDays = Math.max(1, Math.min(120, Number(p.cureDays)));
      if (p.lenderName) t.lenderName = String(p.lenderName).slice(0, 24);
      if (p.borrowerName) t.borrowerName = String(p.borrowerName).slice(0, 24);
      s.terms = t;
      // `who` was read before this action ran, so it still holds the old name.
      // Proposing is the one action that can rename the parties, so the entry
      // has to be written with the names the proposal just set.
      const proposer = role === "lender" ? t.lenderName : t.borrowerName;
      s.proposal = { by: role, day: s.day, terms: t, accepted: false };
      s.signatures = { lender: false, borrower: false };
      log(s, {
        actor: role,
        via,
        tool: via === "tool" ? "propose-terms" : undefined,
        text: `${proposer} proposed terms: ${money(t.principal, t.currency)} over ${t.installmentCount} payments, ${t.reminderBudget} reminders per month, ${t.cureDays}-day cure period.`,
      });
      message = "Terms proposed. The other half now has an answer to give.";
      break;
    }

    case "accept-terms": {
      const why = gate("accept-terms");
      if (why) return deny(why);
      s.proposal!.accepted = true;
      log(s, { actor: role, via, tool: via === "tool" ? "accept-terms" : undefined, text: `${who} accepted the terms.` });
      message = "Terms accepted. Both halves can now be signed.";
      break;
    }

    case "sign-agreement": {
      const why = gate("sign-agreement");
      if (why) return deny(why);
      s.signatures[role] = true;
      log(s, { actor: role, via, tool: via === "tool" ? "sign-agreement" : undefined, text: `${who} signed their half.` });
      if (s.signatures.lender && s.signatures.borrower) {
        log(s, { actor: "system", via: "clock", text: "Agreement signed by both halves. The schedule starts." });
        message = "Both halves signed. The schedule is running.";
      } else {
        message = "Your half is signed. Waiting on the other.";
      }
      break;
    }

    case "log-payment": {
      const why = gate("log-payment");
      if (why) return deny(why);
      const amt = Math.round(Number(p.amount) * 100);
      if (!Number.isFinite(amt) || amt <= 0) return deny("A payment needs a positive amount.");
      const capped = Math.min(amt, outstanding(s));
      s.payments.push({
        id: uid("pay"),
        day: s.day,
        amount: capped,
        note: p.note ? String(p.note).slice(0, 120) : undefined,
        confirmed: false,
      });
      log(s, {
        actor: role,
        via,
        tool: via === "tool" ? "log-payment" : undefined,
        text: `${who} logged ${money(capped, s.terms.currency)}${p.note ? ` — ${String(p.note).slice(0, 80)}` : ""}.`,
      });
      message = `Logged ${money(capped, s.terms.currency)}. It counts once the lender confirms.`;
      break;
    }

    case "confirm-payment": {
      const why = gate("confirm-payment");
      if (why) return deny(why);
      const pend = pendingPayments(s);
      const target = p.paymentId ? pend.find((x) => x.id === p.paymentId) : pend[0];
      if (!target) return deny("No matching payment is waiting.");
      target.confirmed = true;
      target.confirmedDay = s.day;
      const evidence = p.evidence ? String(p.evidence).slice(0, 120) : "";
      log(s, {
        actor: role,
        via,
        tool: via === "tool" ? "confirm-payment" : undefined,
        text: evidence
          ? `${money(target.amount, s.terms.currency)} confirmed against ${evidence}.`
          : `${who} confirmed ${money(target.amount, s.terms.currency)} received.`,
      });
      if (outstanding(s) <= 0) {
        log(s, { actor: "system", via: "clock", text: "The slate is settled in full." });
      }
      message = `Confirmed ${money(target.amount, s.terms.currency)}.`;
      break;
    }

    case "send-reminder": {
      const why = gate("send-reminder");
      if (why) return deny(why);
      s.reminderDays.push(s.day);
      const after = reminderUsage(s);
      log(s, {
        actor: role,
        via,
        tool: via === "tool" ? "send-reminder" : undefined,
        text: `${who} sent a reminder. ${after.total - after.used} of ${after.total} left this month.`,
      });
      message =
        after.used >= after.total
          ? "Reminder sent. That was your last one this month — the capability is now spent."
          : `Reminder sent. ${after.total - after.used} left this month.`;
      break;
    }

    case "request-extension": {
      const why = gate("request-extension");
      if (why) return deny(why);
      const extra = Math.max(1, Math.min(90, Number(p.extraDays) || 14));
      s.extension = {
        status: "pending",
        requestedDay: s.day,
        extraDays: extra,
        reason: p.reason ? String(p.reason).slice(0, 160) : undefined,
      };
      log(s, {
        actor: role,
        via,
        tool: via === "tool" ? "request-extension" : undefined,
        text: `${who} asked for ${extra} more days${p.reason ? ` — ${String(p.reason).slice(0, 90)}` : ""}.`,
      });
      message = "Request sent. The lender now has an answer registered against them.";
      break;
    }

    case "grant-extension": {
      const why = gate("grant-extension");
      if (why) return deny(why);
      s.extension.status = "granted";
      s.extension.resolvedDay = s.day;
      log(s, {
        actor: role,
        via,
        tool: via === "tool" ? "grant-extension" : undefined,
        text: `${who} granted ${s.extension.extraDays} more days. The schedule shifts.`,
      });
      message = "Granted. Every due date moves.";
      break;
    }

    case "decline-extension": {
      const why = gate("decline-extension");
      if (why) return deny(why);
      s.extension.status = "declined";
      s.extension.resolvedDay = s.day;
      log(s, {
        actor: role,
        via,
        tool: via === "tool" ? "decline-extension" : undefined,
        text: `${who} declined the request for more time.`,
      });
      message = "Declined, and on the record.";
      break;
    }

    case "request-hardship-pause": {
      const why = gate("request-hardship-pause");
      if (why) return deny(why);
      s.pause.lastUsedDay = s.day;
      s.pause.activeUntil = s.day + s.terms.pauseDays;
      log(s, {
        actor: role,
        via,
        tool: via === "tool" ? "request-hardship-pause" : undefined,
        text: `${who} took the ${s.terms.pauseDays}-day hardship pause. Collection capabilities are off until ${formatDay(s.pause.activeUntil)}.`,
      });
      message = `Pause running until ${formatDay(s.pause.activeUntil)}.`;
      break;
    }

    case "declare-default": {
      const why = gate("declare-default");
      if (why) return deny(why);
      s.defaulted = true;
      s.defaultedDay = s.day;
      log(s, {
        actor: role,
        via,
        tool: via === "tool" ? "declare-default" : undefined,
        text: `${who} declared the loan in default after the full cure period.`,
      });
      message = "Declared in default.";
      break;
    }

    case "forgive-remaining": {
      const why = gate("forgive-remaining");
      if (why) return deny(why);
      const left = outstanding(s);
      s.forgiven = true;
      s.forgivenDay = s.day;
      log(s, {
        actor: role,
        via,
        tool: via === "tool" ? "forgive-remaining" : undefined,
        text: `${who} forgave ${money(left, s.terms.currency)}. Every collection capability is off the board permanently.`,
      });
      message = `Forgave ${money(left, s.terms.currency)}.`;
      break;
    }

    case "reset": {
      const fresh = newLoan(s.room, DEFAULT_TERMS);
      return { ok: true, state: fresh, message: "Slate reset.", changed: [] };
    }

    default:
      return deny(`Unknown action: ${action.type}`);
  }

  const changed = diffCaps(before, snapshotCaps(s));
  return { ok: true, state: s, message, changed };
}
