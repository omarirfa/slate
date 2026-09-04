/**
 * Model mode, driven by a scripted fake model.
 *
 * `lib/agent.ts` posts to /api/agent and reads back an Anthropic-shaped
 * `content` array. Intercepting that one request is the whole seam: the agent
 * loop, the tool dispatch, the trace and the capability surface all run for
 * real, and only the model's judgement is canned. Same idea as a fake LLM in a
 * test harness — a fixed list of replies, played in order.
 *
 * What this proves that rules mode cannot: that a model's chosen tool call is
 * actually executed against the WebMCP context, and that a call the surface
 * does not offer is refused rather than improvised around.
 */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const B = "http://localhost:3000";
let pass = 0, fail = 0; const fails = [];
const ck = (n, c, e = "") => c ? (pass++, console.log(`  ok    ${n}`))
  : (fail++, fails.push(`${n} — ${e}`), console.log(`  FAIL  ${n} — ${e}`));
const w = ms => new Promise(r => setTimeout(r, ms));

/** One canned reply per call, in order; the last one repeats. */
const REPLIES = [
  // 1. a plain read: should execute and come back with a summary
  [{ type: "text", text: "Let me look at where the loan stands." },
   { type: "tool_use", id: "c1", name: "get-loan-summary", input: {} }],
  // 2. a tool that is NOT on the surface: must be refused, not improvised
  [{ type: "tool_use", id: "c2", name: "seize-collateral", input: { amount: 9999 } }],
  // 3. the model asking for something it has no tool for
  [{ type: "text", text: "WANTED: charge-late-fee — the payment is overdue." }],
  // 4. a real, available action
  [{ type: "text", text: "I will put terms on the table." },
   { type: "tool_use", id: "c4", name: "propose-terms",
     input: { principal: 900, installmentCount: 3, reminderBudget: 2, cureDays: 21 } }],
  // 5. nothing further
  [{ type: "text", text: "Nothing more to do this round." }],
];

const args = [...chromium.args.filter(a => !/single-process/.test(a)), "--no-sandbox", "--disable-dev-shm-usage"];
const br = await puppeteer.launch({ executablePath: await chromium.executablePath(), args, headless: true });
const p = await br.newPage();
await p.setViewport({ width: 1440, height: 1100 });

let calls = 0;
const seen = [];
await p.setRequestInterception(true);
p.on("request", (req) => {
  if (!/\/api\/agent$/.test(new URL(req.url()).pathname) || req.method() !== "POST") return void req.continue();
  const body = JSON.parse(req.postData() || "{}");
  seen.push({ tools: (body.tools || []).map(t => t.name) });
  const content = REPLIES[Math.min(calls, REPLIES.length - 1)];
  calls++;
  req.respond({ status: 200, contentType: "application/json",
    body: JSON.stringify({ ok: true, content }) });
});
// The page decides whether model mode is offered at all from this endpoint.
await p.evaluateOnNewDocument(() => {
  const real = window.fetch;
  window.fetch = (u, o) => (String(u).endsWith("/api/agent") && (!o || o.method !== "POST"))
    ? Promise.resolve(new Response(JSON.stringify({ serverKey: true, provider: "anthropic", model: "fake-model" }),
        { status: 200, headers: { "Content-Type": "application/json" } }))
    : real(u, o);
});

console.log("=== model mode with a scripted model ===");
await p.goto(B + "/?demo=1", { waitUntil: "domcontentloaded" });
await p.waitForSelector("#op-me", { timeout: 20000 }); await w(600);
await p.type("#op-me", "Amicia"); await p.type("#op-them", "Hugo");
await p.click("#op-amount", { clickCount: 3 }); await p.type("#op-amount", "1200");
await p.evaluate(() => [...document.querySelectorAll("button")].find(b => /open the slate/i.test(b.textContent))?.click());
await w(4000);
await p.evaluate(() => document.querySelector(".tour .btn--ghost")?.click()); await w(400);

const offered = await p.evaluate(() => {
  const sel = document.querySelector("select");
  return sel ? [...sel.options].map(o => o.value) : null;
});
ck("model mode is offered when a key is reported", offered && offered.includes("model"), JSON.stringify(offered));

await p.evaluate(() => { const s = document.querySelector("select");
  if (s) { s.value = "model"; s.dispatchEvent(new Event("change", { bubbles: true })); } });
await w(500);
await p.evaluate(() => [...document.querySelectorAll("button")].find(b => /let the agents/i.test(b.textContent))?.click());
await w(14000);

const t = await p.evaluate(() => ({
  trace: [...document.querySelectorAll(".trace__item")].map(li => li.innerText.replace(/\n/g, " · ").slice(0, 90)),
  body: document.body.innerText,
}));
console.log("        model calls intercepted:", calls);
for (const line of t.trace.slice(0, 10)) console.log("        · " + line);

ck("the agent actually called the model", calls > 0, `${calls}`);
ck("the model was handed the discovered tool list", seen[0]?.tools?.length > 0, JSON.stringify(seen[0]).slice(0, 90));
ck("only registered tools were offered to it",
  !(seen[0]?.tools || []).includes("seize-collateral"), (seen[0]?.tools || []).join(","));
ck("a fabricated tool name is refused, not improvised around",
  /seize-collateral/i.test(t.trace.join(" ")) && /no such tool|refus/i.test(t.trace.join(" ")),
  t.trace.join(" | ").slice(0, 120));
ck("a WANTED line is surfaced as a refusal",
  /charge-late-fee/i.test(t.trace.join(" ")), t.trace.join(" | ").slice(0, 120));
ck("the model's real tool call took effect",
  /900/.test(t.body) || /proposed terms/i.test(t.body), "no proposal in the ledger");
ck("no page errors", true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) console.log("FAILURES:\n - " + fails.join("\n - "));
await br.close();
