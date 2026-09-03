/**
 * Bramble Bank on Cloudflare Workers. The three page files are static assets;
 * the ledger lives in one Durable Object so balances persist. The bank exposes
 * its WebMCP tools only to BANK_PARTNER_ORIGIN — set it to the slate's URL.
 */
import { DurableObject } from "cloudflare:workers";
import { createLedger, handleApi } from "./ledger.mjs";

export class BankLedger extends DurableObject {
  async fetch(request) {
    if (!this.ledger) {
      const saved = await this.ctx.storage.get("ledger");
      this.ledger = createLedger(saved ?? null);
    }
    const url = new URL(request.url);
    const partner = (this.env.BANK_PARTNER_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
    const res = await handleApi(url, request, this.ledger, { partner });
    if (!res) return new Response("Not found", { status: 404 });
    if (request.method === "POST") await this.ctx.storage.put("ledger", this.ledger.snapshot());
    return res;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const stub = env.LEDGER.get(env.LEDGER.idFromName("bramble"));
      return stub.fetch(request);
    }
    // Everything else is a static asset (index.html, app.js, webmcp-shim.js).
    return env.ASSETS.fetch(request);
  },
};
