/**
 * Bramble Bank — a small bank on its own origin.
 *
 * It exists so that money can move between the two parties through a
 * cross-origin WebMCP tool rather than a typed-in "I paid". The bank page
 * registers `get-balance`, `list-transactions` and `prepare-transfer` with
 * `exposedTo: [BANK_PARTNER_ORIGIN]`, and carries a declarative
 * `send-transfer` form with no `toolautosubmit` — an agent may prepare a
 * transfer, but the account holder presses Pay.
 *
 * No dependencies. Run: node bank/server.mjs   (BANK_PORT, BANK_PARTNER_ORIGIN)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.BANK_PORT || process.env.PORT || 3001);
const PARTNER = (process.env.BANK_PARTNER_ORIGIN || "http://localhost:3000").replace(/\/$/, "");

import { createLedger, handleApi } from "./ledger.mjs";

const ledger = createLedger();

/* ----------------------------------------------------------------- server */

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}


function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve(null);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    const body = req.method === "POST" ? await readBody(req) : null;
    const webReq = new Request(url, {
      method: req.method,
      headers: {
        "content-type": "application/json",
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
      },
      body: body === null ? undefined : JSON.stringify(body),
    });
    const out = await handleApi(url, webReq, ledger, { partner: PARTNER });
    if (!out) return json(res, 404, { ok: false, message: "Not found." });
    res.writeHead(out.status, Object.fromEntries(out.headers.entries()));
    return res.end(await out.text());
  }

  // Static files. The page is embedded by the partner, so no X-Frame-Options.
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
  const pub = path.join(here, "public");
  const full = path.join(pub, file);
  if (!full.startsWith(pub) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404);
    return res.end("Not found");
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(full)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(full).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Bramble Bank on http://localhost:${PORT}  (exposes tools to ${PARTNER})`);
});
