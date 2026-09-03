# Slate

**You get two nudges a month. Then Slate won't let you.**

A loan between friends, held in both their hands. Something owed is on the slate;
forgiving it wipes the slate. (The mechanism is older than the software: a split stick was
split lengthways so neither half could be altered alone.)

Built as a WebMCP demonstration.
The terms of the loan are not text both parties promise to honour. They are
**capabilities**. When a clause closes, the tool that performs it is torn off the page
with its `AbortController`, so neither side — nor any agent acting for them — can reach for it.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

Open the page. The first device to open a room is handed both **half-keys**; take a
half, then send the other person the invite link from the workbench — it carries their
key and only theirs. Or switch on the stand-in and play against it alone.

Verify that the clauses hold and that the tool surface enforces them:

```bash
npm run verify   # 18 clause checks on the engine, 28 checks on the registration layer
```

Optionally copy `.env.example` to `.env.local` and add an `ANTHROPIC_API_KEY` to let a
model play the stand-in.

## The clauses

| Clause | Mechanic | What it does |
| --- | --- | --- |
| Two reminders a month | counter-gated | When the budget is spent, `send-reminder` unregisters until the window resets. The clause protects the friendship, not the debt. |
| Asking for time | obligation-paired | `request-extension` registers `grant-extension` and `decline-extension` on the lender. The ask cannot be ignored into silence. |
| Cure period | time-gated | `declare-default` does not exist until the overdue payment has sat for the full cure period, a reminder was actually sent, and no request is outstanding. |
| Hardship pause | counter + time-gated | The borrower's to take once a year without permission. While it runs, the lender's reminder and default tools are off the page. |
| Confirmation | obligation-paired | Logging a payment registers `confirm-payment` on the lender. Until they confirm, it does not reduce the balance. |
| Forgiveness | asymmetric, irreversible | The lender's alone, and it removes every collection capability permanently. |

Clauses that cannot compile to capabilities — "the parties shall act in good faith" —
stay as prose. The app is honest about which half of an agreement a machine can hold.

## How it uses WebMCP

- **`document.modelContext` first**, falling back to the deprecated `navigator.modelContext`
  alias, then to a spec-shaped in-page shim. The banner shows which is live.
- **Dynamic registration.** `lib/engine.ts` derives a capability surface from loan state;
  `ToolRegistry.sync()` diffs it against what is registered and registers or aborts the
  difference. An unavailable clause is an **absent tool**, not a disabled button.
- **Per-party surfaces.** The lender and borrower see different tools on the same slate.
  Set `NEXT_PUBLIC_PARTNER_ORIGIN` and tools register with `exposedTo` and are
  discovered with `getTools({ fromOrigins })`, making the isolation browser-enforced
  across origins. Unset, the two halves share one origin and the server checks every
  call against a per-party **half-key** minted when the room is opened, then against the
  capability surface — a call claiming the wrong role is refused before the clause is
  even consulted.
- **Annotations.** `readOnlyHint` on the read tools, `destructiveHint` on `declare-default`
  and `forgive-remaining`, both of which additionally require a typed acknowledgement.
- **Read tools, not just write tools.** `get-loan-summary` and
  `explain-locked-capability` let an agent ask *which clause* is holding a tool shut.
- **Declarative API.** The terms form carries `toolname` / `tooldescription` /
  `toolparamdescription`, deliberately with **no `toolautosubmit`** — an agent may fill
  the terms, a person presses the button.
- **In-page agents.** The tool console discovers through `getTools()` and invokes through
  `executeTool()` with an `AbortSignal`, so the page demonstrates itself without a
  browser agent attached. The stand-in and the simulator are agents too: they hold the
  other party's tools on an **isolated model context** and can act only through it. There
  is no route from either of them to the server that does not pass through
  `executeTool()`.
- **`toolchange`** drives re-discovery, so the console re-reads the surface the moment a
  clause opens or closes.

## The bank: a second origin

`bank/` is Bramble Bank, a small bank on its own origin (`npm run bank`, port 3001, no
dependencies). Both parties hold an account there. The slate embeds the bank page with
`allow="tools"` and reaches it only through WebMCP:

- The bank registers `get-balance`, `list-transactions` and `prepare-transfer` with
  `exposedTo: [<slate origin>]`. Any other embedder discovers nothing.
- The slate discovers them with `getTools({ fromOrigins: [<bank origin>] })` and calls
  them with `executeTool()`. In the tool console they appear alongside the slate's own,
  tagged with the origin they came from.
- The bank's `send-transfer` is a declarative `<form>` with no `toolautosubmit`.
  `prepare-transfer` fills it in; only the account holder presses Pay. Money never moves
  on an agent's say-so.
- Borrower side: an outgoing transfer carrying a slate reference is picked up through
  `list-transactions` and logged through the slate's own `log-payment`. "I paid" becomes
  "the bank says I paid".
- Lender side: the confirmation duty that `log-payment` registered is discharged only
  once `list-transactions` on the lender's account shows the transfer landed — by a read
  tool on a third origin, not a person clicking yes. The ledger records what it checked.

Without native WebMCP, the two shims bridge over `postMessage` and the bank's shim
enforces `exposedTo` itself by checking the caller's origin. With native WebMCP the
browser mediates and the bridge is a no-op. `npm run verify` includes six checks on this:
a stranger origin sees nothing and cannot execute.

## Two agents negotiate, two people sign

While the slate is still being drafted, each half can hand the terms to an agent. The
lender's agent runs on the page's own model context, the borrower's on the isolated one,
and each has a stated position (`lib/negotiate.ts`). The lender's agent opens with
`propose-terms`; the other answers with `accept-terms` if the offer is inside its range or
a counter through `propose-terms` if not, meeting halfway each round. With rules they
agree in three proposals; with a model, the two positions are the system prompts.

`sign-agreement` is excluded from both agents' view. It is on both contexts — the
harness checks that — but the agents are never offered it, so the one irreversible step
stays with the people. `npm run verify` also checks that the agreed terms sit inside
both ranges and that neither agent ever saw the signing tool.

## Three ways to drive it

**Simulate.** Press Play. Seventeen narrated steps take a blank slate through agreement,
payment, arrears, a spent reminder budget, a request for time and a hardship pause. Every
step is an `executeTool()` call on the acting party's model context. Two steps are *meant*
to be refused, and they are refused because the tool is not registered at that moment —
not by a runtime check. Pause, Step and Stop are there for demoing at your own pace.

**Two people.** Send the invite link and two devices share one slate, each holding one
half-key. Changes arrive over a server-sent event stream, so a tool registering on one
half shows up on the other as it happens.

**A stand-in.** Play one half yourself and let the stand-in hold the other.

## The stand-in is an agent

The stand-in is handed a model context that belongs to the other party and nothing else.
Everything it knows about what it may do comes from `getTools()` on that context, and
everything it does goes through `executeTool()`. The panel under it prints exactly that:
what it sees, what it wants, what it calls, and what it *cannot* — a wish that meets no
tool is recorded as a refusal rather than quietly skipped.

Two brains, one path. With **rules**, a deterministic mover lists what the party would
like to do and the first wish on the surface is taken. With **model** (needs
`ANTHROPIC_API_KEY`), a Claude model is given the discovered tool list verbatim and asked
to act in character; when it wants something the list lacks it has to say so. Either way
the agent's server calls carry that party's half-key and are re-checked by the same
`apply()` as yours. Dispositions: pays on time, short this month, goes quiet.

## Deploy

The slate lives in one process's memory, so run a **single instance**. `render.yaml`
and a `Dockerfile` are included; Render's starter plan is the shortest path to the
live URL. For a multi-instance or serverless host, swap `lib/store.ts` for Redis first.

The bank is a second service. Point `NEXT_PUBLIC_BANK_ORIGIN` on the slate at it and
`BANK_PARTNER_ORIGIN` on the bank back at the slate; `exposedTo` requires a secure
origin, so both need https in production (localhost is allowed in development).

```bash
docker build -t slate . && docker run -p 3000:3000 slate
```

## Notes

- The clock is simulated so time-gated clauses are demonstrable. Advance a week or a
  month from the slate panel.
- Rooms, half-keys and event subscribers live in memory in one Node process. For a
  multi-instance deployment, swap `lib/store.ts` for Redis or a database.
- The device that opens a room holds both half-keys, which is what lets it run a
  stand-in or the simulator. A device that arrives by invite holds one.
- Light theme is the default; the toggle is in the banner and the choice persists.
