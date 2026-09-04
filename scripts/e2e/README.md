# End-to-end suites

Drive the real app in headless Chromium. Start both servers first:

    NEXT_PUBLIC_BANK_ORIGIN=http://localhost:3001 npx next build
    BANK_PARTNER_ORIGIN=http://localhost:3000 BANK_PORT=3001 node bank/server.mjs &
    npx next start -p 3000 &

Then:

    node scripts/e2e/journeys.mjs            # entry paths, roles, nav, toggles, mobile
    node scripts/e2e/interactions.mjs        # simulator, tour, negotiator, two devices
    node scripts/e2e/clauses-and-bank.mjs    # bank bridge, clause refusals, error states
    node scripts/e2e/responsive.mjs          # ten resolutions and both orientations
    node scripts/e2e/playground.mjs          # /playground, by hand and by model
    node scripts/e2e/publish-shim.mjs        # ?inspect=1, and that detection stays honest
    node scripts/e2e/theme-motion-icon.mjs   # shared toggle, page motion, favicon
    node scripts/e2e/acknowledgement.mjs     # the typed confirmation, on every path

They need `puppeteer-core` and `@sparticuz/chromium`, which are not project
dependencies — install them without saving when you want to run these:

    npm i --no-save puppeteer-core @sparticuz/chromium

Two behaviours these encode, because both looked like bugs at first:

- **Stop is a reset, not a pause.** `Simulate` has a separate Pause control;
  Stop returns the run to 0 deliberately.
- **A refusal only shows on the step it belongs to.** Checking for refusal text
  after the run finishes finds nothing; the suites sample during playback.

## Running against the real Worker runtime

The suites above can be pointed at Node (`next start`) or at Cloudflare's local
runtime. Only the second exercises the **Durable Object**; `lib/store.ts` is an
in-memory store used when the app runs on Node, so a Node-only pass proves
nothing about room state in production.

    NEXT_PUBLIC_BANK_ORIGIN=http://localhost:3001 npx opennextjs-cloudflare build
    BANK_PARTNER_ORIGIN=http://localhost:3000 BANK_PORT=3001 node bank/server.mjs &
    npx wrangler dev --port 3000 --local &

Use `localhost`, not `127.0.0.1` — the bank's `exposedTo` names one origin and
the two are different origins to the browser.

`durable-object.mjs` and `lifecycle.mjs` are API-level and safe to run against
either; the rest drive the browser.

## Model mode, without an API key

`fake-model.mjs` and `fake-model-clauses.mjs` test model-driven agents with a
scripted model. `lib/agent.ts` posts to `/api/agent` and reads back an
Anthropic-shaped `content` array, so intercepting that one request is the whole
seam: the agent loop, the tool dispatch, the trace and the capability surface
all run for real, and only the model's judgement is canned — a fixed list of
replies played in order.

This is the only way to test what rules mode cannot: that a model's chosen tool
call is executed against the WebMCP context, and that a tool the surface does
not offer is refused rather than improvised around.

Note the model only runs during **drafting** — that is where the negotiators
live. There is no model-driven agent on an active loan.
