# Deploy Slate to Cloudflare (free plan)

Two Workers: **slate** (the app, with the room Durable Object inside it) and
**bramble-bank** (the bank, with its ledger Durable Object). Both use SQLite-backed
Durable Objects, which are available on the Workers Free plan.

You need: a Cloudflare account, Node 22, and this folder.

## 1. Log the CLI in

```bash
npm install
npx wrangler login          # opens a browser; approve
npx wrangler whoami         # should show your account
```

## 2. Deploy the bank first (the app needs its URL)

```bash
cd bank
npx wrangler deploy
cd ..
```

Note the URL it prints, e.g. `https://bramble-bank.<you>.workers.dev`.

## 3. Deploy the app with the bank's URL baked in

```bash
NEXT_PUBLIC_BANK_ORIGIN=https://bramble-bank.<you>.workers.dev npm run cf:deploy
```

Note the URL it prints, e.g. `https://slate.<you>.workers.dev`.

## 4. Tell the bank which origin may see its tools

```bash
cd bank
npx wrangler deploy --var BANK_PARTNER_ORIGIN:https://slate.<you>.workers.dev
cd ..
```

(Or edit `vars.BANK_PARTNER_ORIGIN` in `bank/wrangler.jsonc` and deploy again.)

## 5. Open it

`https://slate.<you>.workers.dev/?demo=1` — full workbench.
Open the invite link in a second browser to see presence and live updates.

## Optional

- Model-driven stand-in and negotiators. Nobody needs a key: rules drive them by default.
  Anyone can paste their own Anthropic, OpenAI or Gemini key in the demo panel; it is sent
  per call, used once, and never stored or logged on the server (and stays in the tab
  unless they tick "remember on this device"). If you want the deployment to have its own
  key so visitors don't need one: `npx wrangler secret put ANTHROPIC_API_KEY` (or
  `OPENAI_API_KEY` / `GEMINI_API_KEY`), then redeploy the app. Model names can be set with
  `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `GEMINI_MODEL`.
- Native WebMCP chip: register `https://slate.<you>.workers.dev` for Chrome's WebMCP
  origin trial, then redeploy with the token:
  `NEXT_PUBLIC_ORIGIN_TRIAL_TOKEN=<token> NEXT_PUBLIC_BANK_ORIGIN=... npm run cf:deploy`
- Throwaway demo where `?role=` in the address is trusted: set `SLATE_OPEN_ROOMS` to `"1"`
  in `wrangler.jsonc` `vars`. Do not leave it on.

## Check without deploying

```bash
npm run cf:check     # type-checks the Durable Object and dry-run bundles both Workers
npm run cf:preview   # runs the app in Cloudflare's local runtime on http://localhost:8787
```

## Many people, one site

Every slate is its own room with two unguessable half-keys, one per device — that is the
session model, and it needs no accounts. Keys travel only in POST bodies over https, never
in URLs, so they do not reach logs.

The bank is shaped like an embedded banking widget:

- Opening an account returns a secret once; the bank stores only its SHA-256 hash.
- The secret stays in the holder's browser. The bank frame never sees it: Slate exchanges
  it for a 30-minute session token, hands the token to the frame by `postMessage`, and
  renews it a minute before expiry. Tokens are stored hashed too.
- The frame URL carries no credentials. All bank calls are Bearer over https.
- Transfers are addressed to account numbers; the sending account is whichever one the
  session belongs to, not a field the caller chooses. A bad secret reopens the account.

## Free-plan limits that matter

100,000 requests/day across Workers and Durable Objects; 10 ms CPU per request
(the page is static and the routes are tiny); event streams are long-lived but idle.
`workers.dev` gives you https, which the bank's `exposedTo` requires.
