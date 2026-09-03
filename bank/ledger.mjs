/**
 * Bramble Bank's ledger, independent of where it runs. bank/server.mjs keeps
 * it in memory for local development; bank/worker.mjs keeps it in a Durable
 * Object on Cloudflare. Same accounts, same transfers, same messages.
 *
 * The credential model is the one embedded banking widgets use:
 *
 *  - Opening an account returns a secret exactly once. The bank stores only
 *    its SHA-256 hash. The secret is the account holder's device-bound
 *    credential and never appears in a URL.
 *  - The holder's device exchanges the secret for a short-lived session
 *    token (POST /api/sessions). The embedded page is opened with that token
 *    and uses it as a Bearer. Sessions expire; the page asks its embedder for
 *    a fresh one. Tokens are stored hashed too.
 *  - Transfers are addressed to account numbers, which are public. The
 *    sending account is whichever one the session belongs to; it is not a
 *    field the caller chooses.
 */

export const SESSION_TTL_MS = 30 * 60 * 1000;

export function fmt(minor) {
  return `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: minor % 100 ? 2 : 0 })}`;
}

function rand(len) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createLedger(initial = null) {
  const accounts = new Map(initial?.accounts?.map((a) => [a.id, a]) ?? []);
  const sessions = new Map(initial?.sessions?.map((s) => [s.tokenHash, s]) ?? []);
  const transactions = initial?.transactions ?? [];
  let seq = initial?.seq ?? 0;
  let next = initial?.next ?? 31877402;

  async function openAccount(holder) {
    const clean = String(holder || "").trim().slice(0, 24) || "Account holder";
    const secret = rand(32);
    const acc = {
      id: `br-${String(next++)}`,
      holder: clean,
      sort: "40-11-27",
      secretHash: await sha256(secret),
      balance: 250_000,
      openedAt: Date.now(),
    };
    accounts.set(acc.id, acc);
    return { account: acc, secret };
  }

  async function verifySecret(id, secret) {
    const acc = accounts.get(String(id || ""));
    if (!acc || !secret) return null;
    return (await sha256(secret)) === acc.secretHash ? acc : null;
  }

  function sweep() {
    const now = Date.now();
    for (const [k, s] of sessions) if (s.expiresAt <= now) sessions.delete(k);
  }

  async function createSession(id, secret) {
    const acc = await verifySecret(id, secret);
    if (!acc) return null;
    sweep();
    const token = rand(40);
    const session = { tokenHash: await sha256(token), accountId: acc.id, expiresAt: Date.now() + SESSION_TTL_MS };
    sessions.set(session.tokenHash, session);
    return { token, expiresAt: session.expiresAt };
  }

  /** Resolve a Bearer token to an account, or null. */
  async function authBearer(request) {
    const header = request.headers.get("authorization") || "";
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) return null;
    const s = sessions.get(await sha256(m[1].trim()));
    if (!s) return null;
    if (s.expiresAt <= Date.now()) {
      sessions.delete(s.tokenHash);
      return null;
    }
    return accounts.get(s.accountId) ?? null;
  }

  function publicView(acc) {
    return { id: acc.id, holder: acc.holder, sort: acc.sort };
  }

  function transfer(src, { to, amount, reference }) {
    const dst = accounts.get(String(to || "").trim());
    if (!dst) return { ok: false, message: `No account ${to} at this bank.` };
    if (src === dst) return { ok: false, message: "Cannot transfer to the same account." };
    const minor = Math.round(Number(amount) * 100);
    if (!Number.isFinite(minor) || minor <= 0) return { ok: false, message: "Amount must be a positive number." };
    if (src.balance < minor) {
      return { ok: false, message: `Insufficient funds: ${src.holder} has ${fmt(src.balance)}, transfer is ${fmt(minor)}.` };
    }
    const ref = String(reference || "").trim().slice(0, 40);
    src.balance -= minor;
    dst.balance += minor;
    const tx = {
      id: `tx_${(++seq).toString(36)}`,
      at: Date.now(),
      from: src.id,
      fromHolder: src.holder,
      to: dst.id,
      toHolder: dst.holder,
      amount: minor,
      reference: ref,
    };
    transactions.push(tx);
    if (transactions.length > 2000) transactions.shift();
    return { ok: true, message: `Sent ${fmt(minor)} to ${dst.holder} (${dst.id})${ref ? `, ref ${ref}` : ""}.`, transaction: tx };
  }

  function list(acc, reference) {
    let out = transactions.filter((t) => t.from === acc.id || t.to === acc.id);
    if (reference) out = out.filter((t) => t.reference === reference);
    return out.slice(-50).reverse();
  }

  function snapshot() {
    sweep();
    return { accounts: [...accounts.values()], sessions: [...sessions.values()], transactions, seq, next };
  }

  return { openAccount, createSession, authBearer, publicView, transfer, list, accounts, snapshot };
}

/** Routes one API request against a ledger. Shared by both hosts. */
export async function handleApi(url, request, ledger, config) {
  const cors = {
    "Access-Control-Allow-Origin": config.partner,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
  const json = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors },
    });
  const readJson = async () => {
    try {
      return await request.json();
    } catch {
      return null;
    }
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (url.pathname === "/api/config") return json(200, { partner: config.partner, name: "Bramble Bank", sessionTtlMs: SESSION_TTL_MS });

  // Open an account. The secret is returned once and never again.
  if (url.pathname === "/api/accounts" && request.method === "POST") {
    const body = await readJson();
    if (!body) return json(400, { ok: false, message: "Malformed body." });
    const { account, secret } = await ledger.openAccount(body.holder);
    return json(200, { ok: true, account: { id: account.id, holder: account.holder, sort: account.sort }, secret });
  }

  // Exchange the secret for a short-lived session.
  if (url.pathname === "/api/sessions" && request.method === "POST") {
    const body = await readJson();
    if (!body) return json(400, { ok: false, message: "Malformed body." });
    const session = await ledger.createSession(body.account, body.secret);
    if (!session) return json(403, { ok: false, code: "bad-credentials", message: "That account or secret is not right." });
    return json(200, { ok: true, ...session });
  }

  // Public view of one account: number and name, for addressing a transfer.
  const pub = /^\/api\/accounts\/([^/]+)\/public$/.exec(url.pathname);
  if (pub && request.method === "GET") {
    const acc = ledger.accounts.get(decodeURIComponent(pub[1]));
    return acc ? json(200, { ok: true, account: ledger.publicView(acc) }) : json(404, { ok: false, message: "No such account." });
  }

  // Everything below needs a live session.
  const me = await ledger.authBearer(request);
  const expired = () => json(401, { ok: false, code: "session-expired", message: "Your session has ended." });

  if (url.pathname === "/api/me" && request.method === "GET") {
    if (!me) return expired();
    return json(200, { ok: true, account: { id: me.id, holder: me.holder, sort: me.sort, balance: me.balance } });
  }

  if (url.pathname === "/api/transactions" && request.method === "GET") {
    if (!me) return expired();
    return json(200, { transactions: ledger.list(me, url.searchParams.get("reference")) });
  }

  if (url.pathname === "/api/transfer" && request.method === "POST") {
    if (!me) return expired();
    const body = await readJson();
    if (!body) return json(400, { ok: false, message: "Malformed body." });
    const result = ledger.transfer(me, body);
    return json(result.ok ? 200 : 422, result);
  }
  return null;
}
