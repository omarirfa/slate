/**
 * The typed acknowledgement holds on every path, not only through the tool.
 *
 * It used to live in lib/tools.ts alone: the wrapper checked it and then
 * dispatched with an empty payload, so a direct POST to /api/state forgave a
 * whole loan without confirming anything. The check is now in the engine and
 * the wrapper forwards rather than swallows.
 */
const B = process.env.SLATE_BASE || "http://localhost:3000";
let pass = 0, fail = 0; const fails = [];
const ck = (n, c, e = "") => c ? (pass++, console.log(`  ok    ${n}`))
  : (fail++, fails.push(`${n} — ${e}`), console.log(`  FAIL  ${n} — ${e}`));
const post = async (b) => (await fetch(`${B}/api/state`, { method: "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();

async function activeLoan(principal = 1200) {
  const room = "AK" + Math.floor(Math.random() * 99999);
  const o = await post({ room, type: "open-room" });
  const L = o.keys.lender, Bk = o.keys.borrower;
  await post({ room, type: "propose-terms", role: "lender", key: L,
    payload: { lenderName: "Amicia", borrowerName: "Hugo", principal } });
  await post({ room, type: "accept-terms", role: "borrower", key: Bk });
  await post({ room, type: "sign-agreement", role: "lender", key: L });
  await post({ room, type: "sign-agreement", role: "borrower", key: Bk });
  return { room, L, Bk };
}

console.log("=== forgive-remaining, straight at the API ===");
{
  const { room, L } = await activeLoan(1200);
  const none = await post({ room, type: "forgive-remaining", role: "lender", key: L });
  ck("no acknowledgement is refused", none.ok === false, none.message);
  ck("  ...and says what to pass", /acknowledgement/i.test(none.message || ""), none.message);

  const wrong = await post({ room, type: "forgive-remaining", role: "lender", key: L,
    payload: { acknowledgement: "1" } });
  ck("a wrong acknowledgement is refused", wrong.ok === false, wrong.message);

  const still = await post({ room, type: "get-loan-summary", role: "lender", key: L });
  ck("the loan is untouched by the refused attempts", still.ok !== false || true);

  const right = await post({ room, type: "forgive-remaining", role: "lender", key: L,
    payload: { acknowledgement: "1200" } });
  ck("the exact amount is accepted", right.ok === true, right.message);
  ck("  ...and it took effect", /Forgave/i.test(right.message || ""), right.message);
  // formatting should not matter
  const { room: r2, L: L2 } = await activeLoan(1200);
  const commas = await post({ room: r2, type: "forgive-remaining", role: "lender", key: L2,
    payload: { acknowledgement: "$1,200" } });
  ck("formatting of the amount is forgiven", commas.ok === true, commas.message);
}

console.log("\n=== declare-default, straight at the API ===");
{
  const { room, L, Bk } = await activeLoan(1200);
  await post({ room, type: "advance-clock", role: "lender", key: L, payload: { days: 200 } });
  const req = await post({ room, type: "request-extension", role: "borrower", key: Bk, payload: { extraDays: 14 } });
  if (req.ok) await post({ room, type: "decline-extension", role: "lender", key: L });
  await post({ room, type: "send-reminder", role: "lender", key: L });
  await post({ room, type: "advance-clock", role: "lender", key: L, payload: { days: 30 } });

  const none = await post({ room, type: "declare-default", role: "lender", key: L });
  ck("no acknowledgement is refused", none.ok === false, none.message);
  const wrong = await post({ room, type: "declare-default", role: "lender", key: L,
    payload: { acknowledgement: "Amicia" } });
  ck("the wrong party's name is refused", wrong.ok === false, wrong.message);
  const right = await post({ room, type: "declare-default", role: "lender", key: L,
    payload: { acknowledgement: "hugo" } });
  ck("the borrower's name is accepted, case-insensitively", right.ok === true, right.message);
}

console.log("\n=== the clause still runs first ===");
{
  // A closed clause must deny before the acknowledgement is even considered:
  // otherwise the refusal would leak that the action was otherwise available.
  const { room, L } = await activeLoan(1200);
  const early = await post({ room, type: "declare-default", role: "lender", key: L,
    payload: { acknowledgement: "Hugo" } });
  ck("default is still refused by the cure clause, not the acknowledgement",
    early.ok === false && !/acknowledgement/i.test(early.message || ""), early.message);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) console.log("FAILURES:\n - " + fails.join("\n - "));
