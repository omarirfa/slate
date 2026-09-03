# Quickstart

Requires Node 18.18 or newer (Node 22 recommended).

```bash
cd slate
npm install
npm run bank     # Bramble Bank on http://localhost:3001, in one terminal
npm run dev      # the slate on http://localhost:3000, in another
```

Open **http://localhost:3000** in Chrome. The bank is optional; without it the bank
panel just reports that nothing was discovered.

## See it work in thirty seconds

1. On the entry screen, type your name, your friend's, and the amount, and say who lent
   it. That opens the slate with you holding both half-keys.
2. In the **Simulate** panel at the top right, press **Play**.
3. Watch the **capability surface** below it. Tools appear and strike through as the
   agreement changes state. Two steps are refused on purpose.

Use **Step** instead of Play to advance one beat at a time.

## Two people on two devices

Open a room, take a half, then copy the **invite link** from the panel titled with the
other person's name. It carries their half-key. On a phone, replace `localhost` with
your machine's LAN IP. Both devices then share one slate, live.

Prefer to play alone? Take one half and switch on the **stand-in** to hold the other.
With an `ANTHROPIC_API_KEY` in `.env.local` you can hand the stand-in to a model.

## Let the agents haggle

On a fresh slate, press **Let the agents negotiate**. Priya's agent opens, Marcus's
counters, they meet in the middle, and the panel stops with *Sign your half*. Both people
sign; the agents cannot.

## Pay through the bank

Once the agreement is signed, the borrower's page shows their Bramble Bank account in a
frame. Press **Prepare … at the bank**: the slate calls the bank's `prepare-transfer`
across origins and the form fills in. Press **Pay** inside the frame. Within a few seconds
the borrower's half logs the payment from the bank's records, and the lender's half
confirms it against their own incoming transactions — both through tool calls, and the
ledger says so.

## Verify

```bash
npm run verify      # 18 clause checks, 33 registration-layer checks, 6 bridge checks
```

## Notes

- Use `localhost`, not `127.0.0.1`: the bank exposes its tools to `http://localhost:3000`
  by default, and origins have to match exactly.
- The banner chip reads **shim** unless Chrome exposes `document.modelContext`; with the
  WebMCP origin trial enabled it reads **native**. Everything works either way.
- The clock is simulated so the time-gated clauses are demonstrable. Advance a week or a
  month from the slate panel.
- The slate lives in one process's memory. Run a single instance, and use the **Reset**
  button to start a room over. Restarting the server forgets the half-keys, so open a new
  room afterwards.
- For a throwaway demo where `?role=` in the address should just work, set
  `SLATE_OPEN_ROOMS=1`. It makes roles forgeable; do not deploy with it.
