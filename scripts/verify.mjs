/**
 * Walks a full loan and asserts that each clause actually holds.
 * Run with: node --experimental-strip-types scripts/verify.mjs
 */
import assert from "node:assert";

const { apply, capability, newLoan, daysOverdue, reminderUsage } = await import(
  "../.verify/engine.js"
);
const { DEFAULT_TERMS } = await import("../.verify/types.js");

let s = newLoan("TEST", DEFAULT_TERMS);
const act = (type, role, payload = {}) => {
  const r = apply(s, { type, role, via: "tool", payload });
  s = r.state;
  return r;
};
const can = (role, name) => Boolean(capability(s, role, name)?.available);
const why = (role, name) => capability(s, role, name)?.reason;

const results = [];
const check = (label, fn) => {
  try {
    fn();
    results.push(["PASS", label]);
  } catch (e) {
    results.push(["FAIL", `${label} — ${e.message}`]);
  }
};

/* ------------------------------------------------- 1. nothing before signing */

check("no collection tools exist before the agreement is signed", () => {
  assert(!can("lender", "send-reminder"), "reminder should not exist");
  assert(!can("lender", "declare-default"), "default should not exist");
  assert(!can("borrower", "log-payment"), "payment should not exist");
});

check("a party cannot sign until terms are accepted by the other", () => {
  assert(!can("lender", "sign-agreement"), "sign should be locked with no accepted terms");
});

act("propose-terms", "lender", { principal: 2400, installmentCount: 6, reminderBudget: 2, cureDays: 21 });

check("proposing registers accept-terms on the counterparty only", () => {
  assert(can("borrower", "accept-terms"), "borrower should be able to accept");
  assert(!can("lender", "accept-terms"), "proposer cannot accept their own terms");
});

act("accept-terms", "borrower");
act("sign-agreement", "lender");
act("sign-agreement", "borrower");

check("schedule starts only once both halves are signed", () => {
  assert(can("borrower", "log-payment"), "payment should now exist");
});

/* ---------------------------------------------- 2. the payment confirmation pair */

act("advance-clock", "lender", { days: 30 });
act("log-payment", "borrower", { amount: 400 });

check("logging a payment registers confirm-payment on the lender", () => {
  assert(can("lender", "confirm-payment"), "lender should owe a confirmation");
  assert(!can("borrower", "confirm-payment"), "borrower cannot confirm their own payment");
});

act("confirm-payment", "lender");

check("confirmation clears the duty", () => {
  assert(!can("lender", "confirm-payment"), "nothing left to confirm");
});

/* -------------------------------------------- 3. the counter-gated reminder */

act("advance-clock", "lender", { days: 35 });

check("reminder is available once a payment is overdue", () => {
  assert(daysOverdue(s) > 0, "should be overdue");
  assert(can("lender", "send-reminder"), "reminder should be available");
});

act("send-reminder", "lender");
check("one reminder left after the first", () => {
  const b = reminderUsage(s);
  assert.equal(b.used, 1);
  assert(can("lender", "send-reminder"), "second reminder still allowed");
});

act("send-reminder", "lender");
check("the budget genuinely removes the capability", () => {
  assert(!can("lender", "send-reminder"), "reminder must be gone");
  assert(/budget spent/i.test(why("lender", "send-reminder") ?? ""), "reason should cite the budget");
});

check("a forged reminder call is refused, not merely hidden", () => {
  const r = apply(s, { type: "send-reminder", role: "lender", via: "tool", payload: {} });
  assert.equal(r.ok, false, "forged call must fail");
});

/* ------------------------------------------------- 4. default behind the cure */

check("default is locked while the cure period is still running", () => {
  assert(!can("lender", "declare-default"), "cure period should hold it shut");
  assert(/cure period/i.test(why("lender", "declare-default") ?? ""), "reason should cite the cure period");
});

/* --------------------------------------------- 5. the obligation-paired ask */

act("request-extension", "borrower", { extraDays: 14, reason: "short this month" });

check("asking for time registers an answer on the lender", () => {
  assert(can("lender", "grant-extension"), "grant should appear");
  assert(can("lender", "decline-extension"), "decline should appear");
});

check("a pending request blocks default outright", () => {
  const r = apply(s, { type: "declare-default", role: "lender", via: "tool", payload: {} });
  assert.equal(r.ok, false, "cannot default over an unanswered request");
});

act("grant-extension", "lender");

check("granting removes both answer capabilities and shifts the schedule", () => {
  assert(!can("lender", "grant-extension"), "grant should be gone");
  assert(!can("lender", "decline-extension"), "decline should be gone");
  assert.equal(daysOverdue(s), 0, "extension should clear the arrears clock");
});

/* -------------------------------------------------- 6. the hardship pause */

act("advance-clock", "lender", { days: 60 });
act("request-hardship-pause", "borrower");

check("the pause strips the lender's collection tools while it runs", () => {
  assert(!can("lender", "send-reminder"), "no reminders during a pause");
  assert(!can("lender", "declare-default"), "no default during a pause");
});

check("the pause cannot be taken twice in a year", () => {
  assert(!can("borrower", "request-hardship-pause"), "second pause must be locked");
  assert(/available again in/i.test(why("borrower", "request-hardship-pause") ?? ""), "reason should give the wait");
});

/* ---------------------------------------------------- 7. forgiveness is final */

act("advance-clock", "lender", { days: 40 });
const beforeForgive = capability(s, "lender", "forgive-remaining");
check("forgiveness is the lender's alone", () => {
  assert(beforeForgive?.available, "lender should be able to forgive");
  assert(!can("borrower", "forgive-remaining"), "borrower cannot forgive their own debt");
});

act("forgive-remaining", "lender");

check("forgiveness takes every collection capability off the board for good", () => {
  assert(!can("lender", "send-reminder"), "reminders gone");
  assert(!can("lender", "declare-default"), "default gone");
  assert(!can("lender", "forgive-remaining"), "nothing left to forgive");
  const r = apply(s, { type: "declare-default", role: "lender", via: "tool", payload: {} });
  assert.equal(r.ok, false, "default must be unreachable after forgiveness");
});

/* ------------------------------------------------------------------ report */

let failed = 0;
for (const [status, label] of results) {
  if (status === "FAIL") failed++;
  console.log(`${status}  ${label}`);
}
console.log(
  `\n${results.length - failed}/${results.length} clause checks passed.`
);
process.exit(failed ? 1 : 0);
