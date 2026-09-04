/**
 * Verifies the cross-origin bridge without a browser.
 *
 * Two fake windows stand in for the slate page and the embedded bank frame.
 * postMessage between them delivers a MessageEvent with the sender's origin,
 * the way a browser would. The bank's shim (bank/public/webmcp-shim.js) and the
 * slate's shim (lib/webmcp.ts) are the real files. What is checked:
 *
 *   - a tool exposed to the slate origin is discoverable from it via
 *     getTools({ fromOrigins }), and runs in the bank's context when executed;
 *   - a third origin that is not in exposedTo sees nothing and cannot execute;
 *   - the bank's toolchange reaches the slate as a toolchange on its context.
 *
 * Run with: npm run verify
 */
import assert from "node:assert";
import fs from "node:fs";
import vm from "node:vm";

const SLATE = "http://localhost:3000";
const BANK = "http://localhost:3001";
const STRANGER = "https://stranger.example";

/* ------------------------------------------------------- fake windows */

function makeWindow(origin) {
  const listeners = new Map();
  const w = {
    origin,
    parent: null,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    /** Deliver to this window as if `from` had posted it. */
    deliver(data, from) {
      const event = { data: structuredClone(data), origin: from.origin, source: from };
      queueMicrotask(() => {
        for (const fn of listeners.get("message") ?? []) fn(event);
      });
    },
  };
  return w;
}

/** postMessage from `from` to `to`, enforcing targetOrigin like a browser. */
function wire(from, to) {
  to.postMessage = (data, targetOrigin) => {
    if (targetOrigin !== "*" && targetOrigin !== to.origin) return; // dropped
    to.deliver(data, from);
  };
}

const slateWin = makeWindow(SLATE);
const bankWin = makeWindow(BANK);
const strangerWin = makeWindow(STRANGER);
bankWin.parent = slateWin;

// Each window's postMessage must know who is calling it. In a browser that is
// implicit; here we bind per caller.
function postAs(caller, target) {
  return (data, targetOrigin) => {
    if (targetOrigin !== "*" && targetOrigin !== target.origin) return;
    target.deliver(data, caller);
  };
}

/* ----------------------------------------------- load the bank's shim */

const bankSource = fs.readFileSync(new URL("../bank/public/webmcp-shim.js", import.meta.url), "utf8");
const bankGlobals = {
  window: bankWin,
  location: { origin: BANK },
  document: {},
  navigator: {},
  DOMException,
  EventTarget,
  Event,
  console,
};
// The bank posts to its parent: bind that call to come from the bank.
slateWin.postMessage = postAs(bankWin, slateWin);
vm.runInNewContext(bankSource, bankGlobals);
const bank = bankGlobals.window.BankWebMCP.resolve();
assert.strictEqual(bank.provider, "shim");

/* ---------------------------------------------- load the slate's shim */

globalThis.window = slateWin;
globalThis.location = { origin: SLATE };
globalThis.document = {};
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
// The slate posts into the frame: bind to come from the slate.
bankWin.postMessage = postAs(slateWin, bankWin);
const { ToolRegistry } = await import("../.verify/webmcp.js");

/* ---------------------------------------------------------------- run */

const results = [];
const check = async (label, fn) => {
  try {
    await fn();
    results.push(["PASS", label]);
  } catch (e) {
    results.push(["FAIL", `${label} — ${e.message}`]);
  }
};

const text = (t) => ({ content: [{ type: "text", text: t }] });

await bank.mc.registerTool(
  {
    name: "get-balance",
    description: "Read the balance.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => text("Hugo has $1,435 available."),
  },
  { exposedTo: [SLATE] }
);

let prepared = null;
await bank.mc.registerTool(
  {
    name: "prepare-transfer",
    description: "Fill the form.",
    inputSchema: { type: "object", properties: { to: { type: "string" }, amount: { type: "number" } } },
    execute: async (args) => {
      prepared = args;
      return text(`Prepared $${args.amount} to ${args.to}.`);
    },
  },
  { exposedTo: [SLATE] }
);

await check("bank refuses an untrustworthy exposedTo origin", async () => {
  await assert.rejects(
    bank.mc.registerTool({ name: "x", description: "x", execute: () => {} }, { exposedTo: ["http://evil.example"] }),
    /not trustworthy/
  );
});

const slate = new ToolRegistry();
slate.attachFrame(bankWin, BANK);

let toolchanges = 0;
slate.context.addEventListener("toolchange", () => (toolchanges += 1));

await check("slate discovers the bank's tools with getTools({ fromOrigins })", async () => {
  const tools = await slate.context.getTools({ fromOrigins: [BANK] });
  const names = tools.filter((t) => t.origin === BANK).map((t) => t.name).sort();
  assert.deepStrictEqual(names, ["get-balance", "prepare-transfer"]);
});

await check("without fromOrigins the bank's tools are not returned", async () => {
  const tools = await slate.context.getTools();
  assert(!tools.some((t) => t.origin === BANK));
});

await check("executeTool on a bank tool runs in the bank's context", async () => {
  const tools = await slate.context.getTools({ fromOrigins: [BANK] });
  const tool = tools.find((t) => t.name === "prepare-transfer");
  const result = await slate.context.executeTool(tool, { to: "Amicia", amount: 400 });
  assert.deepStrictEqual(prepared, { to: "Amicia", amount: 400 });
  assert.match(result.content[0].text, /Prepared \$400 to Amicia/);
});

await check("a stranger origin discovers nothing and cannot execute", async () => {
  // Rebind the bank's inbound channel to come from the stranger.
  bankWin.postMessage = postAs(strangerWin, bankWin);
  strangerWin.postMessage = postAs(bankWin, strangerWin);
  globalThis.window = strangerWin;
  globalThis.location = { origin: STRANGER };
  const { ToolRegistry: TR } = await import("../.verify/webmcp.js?stranger");
  const stranger = new TR();
  stranger.attachFrame(bankWin, BANK);
  const tools = await stranger.context.getTools({ fromOrigins: [BANK] });
  assert.strictEqual(tools.filter((t) => t.origin === BANK).length, 0, "stranger should see no bank tools");
  await assert.rejects(
    stranger.context.executeTool({ name: "prepare-transfer", origin: BANK }, { to: "Mallory", amount: 999 }),
    /No tool named "prepare-transfer" is exposed to https:\/\/stranger\.example/
  );
  assert.deepStrictEqual(prepared, { to: "Amicia", amount: 400 }, "stranger must not have run the tool");
  // Restore the slate as the caller.
  bankWin.postMessage = postAs(slateWin, bankWin);
  globalThis.window = slateWin;
  globalThis.location = { origin: SLATE };
});

await check("the bank's toolchange reaches the slate as a toolchange event", async () => {
  const before = toolchanges;
  const ac = new AbortController();
  await bank.mc.registerTool(
    { name: "list-transactions", description: "List.", execute: async () => text("[]") },
    { exposedTo: [SLATE], signal: ac.signal }
  );
  await new Promise((r) => setTimeout(r, 10));
  assert(toolchanges > before, "registration should notify the embedder");
  const mid = toolchanges;
  ac.abort();
  await new Promise((r) => setTimeout(r, 10));
  assert(toolchanges > mid, "abort should notify the embedder");
  const tools = await slate.context.getTools({ fromOrigins: [BANK] });
  assert(!tools.some((t) => t.name === "list-transactions"), "aborted tool must be gone");
});

/* ------------------------------------------------------------- report */

let failed = 0;
for (const [status, label] of results) {
  if (status === "FAIL") failed += 1;
  console.log(`${status === "PASS" ? "  ok " : " FAIL"} ${label}`);
}
console.log(`\n${results.length - failed}/${results.length} bridge checks`);
process.exit(failed ? 1 : 0);
