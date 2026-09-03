# Demo script — under three minutes

Judges are not required to watch past 3:00, and the first fifteen seconds decide
whether they keep watching. Lead with the mechanic, not the backstory.

**Shortcut:** press **Play** in the Simulate panel and the whole arc runs itself with
narration, including both refusals. Use Step to hold on a beat while you talk over it.

Set up before recording:

- Chrome, two windows side by side: open a room as lender in one, paste the invite link
  into the other. (Or set `SLATE_OPEN_ROOMS=1` for the session and use
  `?room=DEMO&role=lender` / `?room=DEMO&role=borrower` directly.)
- Or one window as lender with the stand-in switched on to "goes quiet", brain set to the
  model if you have a key.
- Light theme for the first half, flip to dark once on camera so it is on the record.
- Have the capability surface panel visible in both windows.

---

## 0:00–0:20 — the claim

> "This is a loan between two friends. The unusual part is that the terms are not
> text they promise to honour — they are capabilities. When a clause closes, the
> tool that performs it is torn off the page, so neither side's agent can reach
> for it."

Point at the capability surface: open tools listed, locked ones struck through
with the clause responsible printed underneath.

## 0:20–0:40 — the agents haggle

On the blank slate press **Let the agents negotiate**. Three proposals, an accept.

> "Two agents, each on its own model context, each with a position. They
> found propose-terms and accept-terms and nothing else — signing is not on
> their list. It is on the page; they were never offered it. I sign."

Sign both halves.

## 0:40–1:05 — the reminder budget

Advance the clock a month. A payment goes overdue and `send-reminder` appears.

Send one. Send the second.

> "Two reminders a month. That was the second."

`send-reminder` visibly strikes through and the tool count drops. Open the tool
console and press `getTools()`.

> "It is not a disabled button. The tool is not registered any more, so an agent
> reading this page cannot see it. The clause that protects the friendship is the
> one the machine actually enforces."

## 0:55–1:25 — the obligation pair, and the bank

Switch to the borrower window. Call `request-extension`.

Cut to the lender window: `grant-extension` and `decline-extension` have just
appeared, live, without a refresh.

> "Asking registers an answer on the lender. A request cannot be ignored into
> silence — that is the whole clause, and it is enforced by registration."

Back on the borrower: press **Prepare at the bank**. The bank frame fills in.

> "That is another origin. The slate found its tools with `getTools` and
> `fromOrigins`; the bank chose to expose them to this origin and no other.
> The agent prepared the transfer. It cannot press Pay — that is the form with
> no `toolautosubmit`. I press Pay."

Press Pay. Cut to the lender: the ledger line reads *confirmed against
bank transaction … via list-transactions*.

> "The lender's confirmation duty was discharged by a read tool on a third
> origin. Nobody clicked yes."

## 1:25–1:50 — the thing that cannot be done

Switch on the stand-in for the lender, disposition "goes quiet". Watch the trace.

> "This agent has been handed the lender's model context and nothing else. It
> wants to declare default. Look at what it sees: `getTools()` — no such tool.
> It records that it cannot, and falls through to a reminder instead."

Point at the highlighted line: *cannot — wanted declare-default, not on my surface.*

> "It did not hit a permission check. It never found the door. That is the
> difference between a disabled button and an absent capability, and it is the
> whole reason this is built on WebMCP."

If a model is driving, read its own WANTED line aloud.

## 1:50–2:15 — the API

Show the banner chip reading native or shim, then the code for two seconds.

> "`document.modelContext` first, the deprecated navigator alias second, then a
> spec-shaped shim so it runs anywhere. Every state change re-derives the
> capability surface and diffs it against what is registered — new clauses get
> `registerTool`, closed ones get their `AbortController` aborted. Read tools,
> destructive-hint annotations on the two irreversible actions, two declarative
> forms with no `toolautosubmit`, and a second origin reached only through
> `exposedTo` and `fromOrigins`."

## 2:15–2:40 — the honest limit

> "Not every clause compiles. 'The parties shall act in good faith' cannot be a
> capability, and the app says so rather than pretending. An agreement has a
> layer a machine can hold and a layer only people can."

Flip to dark theme here.

## 2:40–3:00 — close

> "People lend money to family constantly and it goes wrong in the same way every
> time: nobody wrote anything down, and the person owed does not want to become
> the person who chases. Slate makes chasing a metered capability and makes
> asking for time impossible to ignore. Eighteen clause checks, thirty-three
> surface checks, six cross-origin checks, all passing."

Show `npm run verify` output for two seconds on the final frame.

---

## Shots worth having in the can

- The capability flashing as it registers and unregisters — the animation is the
  whole idea in one second of footage.
- The tool count in the panel footer changing.
- Two windows side by side when the extension request lands.
- The refused call: a forged `send-reminder` after the budget is spent.
- The stand-in trace with a red *cannot* line, ideally with a model's own words.
- Two windows: an action in one, the tool appearing in the other with the
  banner chip reading *live*.
- The bank form filling itself, then the lender's ledger line naming the
  transaction it checked.
