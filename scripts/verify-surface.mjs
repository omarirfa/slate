/**
 * Verifies the registration layer, not just the engine.
 *
 * Two isolated model contexts (one per party) are kept in sync with the
 * capability surface the same way the page does it. The scenario is then
 * driven through getTools() / executeTool() only, and every step that is
 * meant to be refused must be refused because the tool is absent, not
 * because a runtime check caught it. Finally the stand-in agent runs against
 * the lender's context in its most aggressive disposition and must record a
 * refusal for declare-default when the clause is shut.
 *
 * Run with: npm run verify
 */
import assert from "node:assert";

const { apply, newLoan } = await import("../.verify/engine.js");
const { DEFAULT_TERMS } = await import("../.verify/types.js");
const { ToolRegistry } = await import("../.verify/webmcp.js");
const { buildTools } = await import("../.verify/tools.js");
const { SCENARIO } = await import("../.verify/scenario.js");
const { StandInAgent } = await import("../.verify/agent.js");
const { negotiationWants, negotiationBrief, negotiationSettled, withinRange, proposalCount } = await import(
  "../.verify/negotiate.js"
);

let s = newLoan("SURFACE", DEFAULT_TERMS);
const registries = {
  lender: new ToolRegistry({ isolated: true }),
  borrower: new ToolRegistry({ isolated: true }),
};

const toolchanges = { lender: 0, borrower: 0 };
for (const role of ["lender", "borrower"]) {
  registries[role].context.addEventListener("toolchange", () => {
    toolchanges[role] += 1;
  });
}

async function sync() {
  for (const role of ["lender", "borrower"]) {
    const specs = buildTools(s, role, async (type, payload) => {
      const r = apply(s, { type, role, via: "tool", payload });
      if (r.ok) {
        s = r.state;
        await sync();
      }
      return { ok: r.ok, message: r.message };
    });
    await registries[role].sync(specs);
  }
}

async function roomAction(type, payload = {}) {
  const r = apply(s, { type, role: "lender", via: "clock", payload });
  if (r.ok) s = r.state;
  await sync();
  return r;
}

async function runTool(role, name, args = {}) {
  const mc = registries[role].context;
  const tools = await mc.getTools();
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { ok: false, absent: true, message: `${name} is not registered on the ${role}'s context.` };
  const result = await mc.executeTool(tool, args);
  const text = result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
  const refused = /^(Not done|Refused)/.test(text) || /not available/i.test(text);
  return { ok: !refused, absent: false, message: text };
}

const results = [];
const check = async (label, fn) => {
  try {
    await fn();
    results.push(["PASS", label]);
  } catch (e) {
    results.push(["FAIL", `${label} — ${e.message}`]);
  }
};

/* ------------------------------------------------ 1. the surface at rest */

await sync();

await check("a fresh slate registers only read tools and propose-terms on each party", async () => {
  const names = (await registries.lender.context.getTools()).map((t) => t.name).sort();
  assert.deepStrictEqual(names, ["explain-locked-capability", "get-loan-summary", "propose-terms"]);
});

await check("the two contexts are isolated: the borrower's tools are not on the lender's context", async () => {
  await runTool("lender", "propose-terms", { principal: 2400 });
  const lender = (await registries.lender.context.getTools()).map((t) => t.name);
  const borrower = (await registries.borrower.context.getTools()).map((t) => t.name);
  assert(borrower.includes("accept-terms"), "borrower should have accept-terms");
  assert(!lender.includes("accept-terms"), "lender must not see accept-terms");
});

/* ------------------------------------------- 2. the scenario, tools only */

s = newLoan("SURFACE", DEFAULT_TERMS);
await sync();

let refusedByAbsence = 0;
let succeeded = 0;
for (const step of SCENARIO) {
  const before = { l: toolchanges.lender, b: toolchanges.borrower };
  const r =
    step.action === "advance-clock" || step.action === "reset"
      ? await roomAction(step.action, step.payload ?? {})
      : await runTool(step.role, step.action, step.payload ?? {});
  if (step.expectRefusal) {
    await check(`refused because absent: ${step.role} → ${step.action}`, () => {
      assert(!r.ok, "step should have been refused");
      assert(r.absent, "refusal should come from the tool being unregistered, not a runtime check");
    });
    refusedByAbsence += 1;
  } else {
    await check(`succeeds through executeTool: ${step.role} → ${step.action}`, () => {
      assert(r.ok, r.message);
    });
    succeeded += 1;
    if (r.changed?.length) {
      await check(`toolchange fired when the surface moved after ${step.action}`, () => {
        assert(
          toolchanges.lender > before.l || toolchanges.borrower > before.b,
          "no toolchange event"
        );
      });
    }
  }
}

await check("the scenario contains the two intended refusals", () => {
  assert.strictEqual(refusedByAbsence, SCENARIO.filter((x) => x.expectRefusal).length);
  assert(succeeded > 10);
});

/* ------------------------------------- 3. the stand-in against the surface */

// Fresh slate, signed, then 55 days: the first payment is 25 days overdue,
// past the 21-day cure period, but no reminder has ever been sent, so the
// cure-period clause keeps declare-default off the lender's context.
await roomAction("reset");
await runTool("lender", "propose-terms", { principal: 2400 });
await runTool("borrower", "accept-terms");
await runTool("lender", "sign-agreement");
await runTool("borrower", "sign-agreement");
await roomAction("advance-clock", { days: 55 });

const trace = [];
const agent = new StandInAgent({
  mc: registries.lender.context,
  role: "lender",
  mood: "avoidant",
  mode: "rules",
  getState: () => s,
  onTrace: (e) => trace.push(e),
});

await check("setup: declare-default is absent and send-reminder is present on the lender", async () => {
  const names = (await registries.lender.context.getTools()).map((t) => t.name);
  assert(!names.includes("declare-default"), "default should be unregistered");
  assert(names.includes("send-reminder"), "reminder should be registered");
});

await agent.tick();
const dump = () => trace.map((e) => `${e.kind}: ${e.text}`).join(" | ");

await check("stand-in discovers through getTools() before acting", () => {
  assert(trace.some((e) => e.kind === "discover" && e.text.startsWith("getTools()")), dump());
});

await check("stand-in records a refusal for declare-default while the clause is shut", () => {
  assert(trace.some((e) => e.kind === "refused" && /declare-default/.test(e.text)), dump());
});

await check("stand-in falls through to the first wish that is on its surface", () => {
  assert(trace.some((e) => e.kind === "call" && /send-reminder/.test(e.text)), dump());
  assert.strictEqual(s.reminderDays.length, 1, "the reminder should have reached the engine");
});

await check("stand-in never reaches the engine for a tool it cannot see", () => {
  assert(!trace.some((e) => e.kind === "call" && /declare-default/.test(e.text)), dump());
  assert(!s.defaulted);
});

/* ---------------------------------------------- 4. two agents negotiate */

await roomAction("reset");
const talk = [];
const negotiator = (role) =>
  new StandInAgent({
    mc: registries[role].context,
    role,
    mood: "reliable",
    mode: "rules",
    getState: () => s,
    onTrace: (e) => talk.push({ ...e, who: role }),
    wants: negotiationWants,
    brief: negotiationBrief,
    exclude: ["sign-agreement"],
  });
const negotiators = { lender: negotiator("lender"), borrower: negotiator("borrower") };
const whoseMove = () => (!s.proposal ? "lender" : s.proposal.by === "lender" ? "borrower" : "lender");

let turns = 0;
while (!negotiationSettled(s) && turns < 12) {
  await negotiators[whoseMove()].tick();
  turns += 1;
}

await check("the two negotiators reach agreement within a few proposals", () => {
  assert(negotiationSettled(s), `not settled after ${turns} turns`);
  assert(proposalCount(s) <= 6, `${proposalCount(s)} proposals`);
});

await check("the agreed terms sit inside both parties' acceptable ranges", () => {
  const t = s.terms;
  assert(withinRange("lender", t), `lender would not accept ${JSON.stringify(t)}`);
  assert(withinRange("borrower", t), `borrower would not accept ${JSON.stringify(t)}`);
});

await check("neither negotiator ever saw or called sign-agreement", () => {
  assert(!talk.some((e) => e.kind === "discover" && /sign-agreement/.test(e.text)), "sign-agreement leaked into a discover line");
  assert(!talk.some((e) => e.kind === "call" && /sign-agreement/.test(e.text)));
  assert(!s.signatures.lender && !s.signatures.borrower, "nobody should have signed");
});

await check("after agreement, sign-agreement is on both contexts for the people", async () => {
  const l = (await registries.lender.context.getTools()).map((t) => t.name);
  const b = (await registries.borrower.context.getTools()).map((t) => t.name);
  assert(l.includes("sign-agreement") && b.includes("sign-agreement"));
});

await check("negotiation brief is written for the right party", () => {
  assert(/You are Amicia, the lender/.test(negotiationBrief(s, "lender")));
  assert(/You are Hugo, the borrower/.test(negotiationBrief(s, "borrower")));
  assert(/cannot sign/.test(negotiationBrief(s, "borrower")));
});

/* ---------------------------------------------------------------- report */

let failed = 0;
for (const [status, label] of results) {
  if (status === "FAIL") failed += 1;
  console.log(`${status === "PASS" ? "  ok " : " FAIL"} ${label}`);
}
console.log(`\n${results.length - failed}/${results.length} surface checks`);
process.exit(failed ? 1 : 0);
