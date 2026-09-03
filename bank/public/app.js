/* Bramble Bank page. Registers its tools with WebMCP, exposed to one partner origin. */
(async function () {
  const $ = (id) => document.getElementById(id);
  const config = await fetch("/api/config").then((r) => r.json());
  const PARTNER = config.partner;
  $("bank-name").textContent = config.name;
  $("partner").textContent = PARTNER;

  const fmt = (minor) =>
    "$" + (minor / 100).toLocaleString("en-US", { minimumFractionDigits: minor % 100 ? 2 : 0 });

  /* ------------------------------------------------------------ session */
  // No credential ever appears in this page's URL. The embedder hands over a
  // short-lived session token by postMessage once the page says it is ready,
  // and hands over a fresh one when this page reports the old one expired.

  let token = null;
  const embedded = window.parent && window.parent !== window;

  function tellParent(msg) {
    if (embedded) window.parent.postMessage({ bramble: msg.kind, ...msg }, PARTNER);
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== PARTNER) return;
    const msg = event.data;
    if (!msg || msg.bramble !== "session" || typeof msg.token !== "string") return;
    token = msg.token;
    void refresh();
  });

  async function api(path, init = {}) {
    if (!token) return { ok: false, code: "no-session" };
    const res = await fetch(path, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.code === "session-expired") {
      token = null;
      setStatus("Session ended. Reconnecting…", "prepared");
      tellParent({ kind: "session-expired" });
    }
    return data;
  }

  /* ------------------------------------------------------------- display */

  let account = null;
  let holder = "";

  async function refresh() {
    if (!token) {
      $("balance").textContent = embedded ? "Connecting…" : "No session";
      $("account-meta").textContent = embedded ? "" : "Open this page from Slate.";
      $("holder-label").textContent = "";
      return;
    }
    const [a, t] = await Promise.all([api("/api/me"), api("/api/transactions")]);
    if (!a.ok) {
      account = null;
      return;
    }
    account = a.account;
    holder = account.holder;
    $("holder-label").textContent = holder;
    $("balance").textContent = fmt(account.balance);
    $("account-meta").innerHTML = `${account.sort}<br>${account.id}`;
    const ul = $("tx");
    ul.innerHTML = "";
    for (const x of t.transactions || []) {
      const incoming = x.to === account.id;
      const li = document.createElement("li");
      li.innerHTML =
        `<span class="who">${incoming ? "From " + x.fromHolder : "To " + x.toHolder}</span>` +
        `<span class="amt" data-in="${incoming}">${fmt(x.amount)}</span>` +
        `<span class="ref">${x.reference ? x.reference : "no reference"}</span>`;
      ul.appendChild(li);
    }
    $("tx-empty").hidden = (t.transactions || []).length > 0;
  }
  await refresh();
  setInterval(() => void refresh(), 2500);
  tellParent({ kind: "ready" });

  /* ---------------------------------------------------------------- form */

  const form = $("transfer");
  const status = $("status");
  const pay = $("pay");

  function setStatus(text, tone) {
    status.textContent = text;
    status.dataset.tone = tone || "";
  }

  function markPrepared(on) {
    for (const el of [$("f-to"), $("f-amount"), $("f-ref")]) el.dataset.prepared = String(on);
    pay.dataset.armed = String(on);
  }

  async function submitTransfer() {
    if (!account) return setStatus("No account on this page.", "error");
    const body = {
      to: $("f-to").value.trim(),
      amount: Number($("f-amount").value),
      reference: $("f-ref").value,
    };
    const data = await api("/api/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setStatus(data.message || "No session.", data.ok ? "ok" : "error");
    if (data.ok) {
      form.reset();
      markPrepared(false);
      await refresh();
    }
    return data;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void submitTransfer();
  });

  /* -------------------------------------------------------------- WebMCP */

  const { mc, provider } = window.BankWebMCP.resolve();
  const chip = $("provider-chip");
  /* The shim is the designed fallback, not a fault — amber, and it says why. */
  const providerInfo = {
    document: {
      label: "native",
      detail: "This browser implements WebMCP itself, on document.modelContext.",
    },
    navigator: {
      label: "native (alias)",
      detail: "This browser exposes WebMCP on navigator.modelContext, the older alias.",
    },
    shim: {
      label: "shim — no browser WebMCP",
      detail:
        "This browser exposes neither document.modelContext nor navigator.modelContext, " +
        "so this page runs its own implementation of the same spec. The tools below work " +
        "either way; only the browser's built-in agent cannot see them. For the native " +
        "path, use Chrome with the WebMCP origin trial enabled.",
    },
  }[provider];
  chip.textContent = providerInfo.label;
  chip.title = providerInfo.detail;
  chip.dataset.native = String(provider !== "shim");
  chip.dataset.fallback = String(provider === "shim");
  const chipNote = $("provider-note");
  if (chipNote) chipNote.textContent = provider === "shim" ? providerInfo.detail : "";

  const text = (t) => ({ content: [{ type: "text", text: t }] });
  const opts = { exposedTo: [PARTNER] };
  const who = () => holder || "the account holder";

  const tools = [
    {
      name: "get-balance",
      title: "Read the balance",
      description: `Read the current balance of the account on this page at ${config.name}.`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, idempotentHint: true },
      execute: async () => {
        await refresh();
        return text(account ? `${who()} (${account.id}) has ${fmt(account.balance)} available.` : "No account on this page.");
      },
    },
    {
      name: "list-transactions",
      title: "List transactions",
      description: `List this account's recent transactions, newest first, optionally only those with a given reference. Returns JSON.`,
      inputSchema: {
        type: "object",
        properties: {
          reference: { type: "string", description: "Only transactions carrying exactly this reference." },
          limit: { type: "number", description: "At most this many, default 10." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      execute: async (args) => {
        if (!account) return text(JSON.stringify({ transactions: [] }));
        const q = new URLSearchParams();
        if (args && args.reference) q.set("reference", String(args.reference));
        const { transactions } = await api(`/api/transactions?${q}`);
        const limit = Math.max(1, Math.min(50, Number(args && args.limit) || 10));
        const list = (transactions || []).slice(0, limit).map((t) => ({
          id: t.id,
          at: new Date(t.at).toISOString(),
          direction: t.to === account.id ? "in" : "out",
          counterparty: t.to === account.id ? t.fromHolder : t.toHolder,
          counterpartyAccount: t.to === account.id ? t.from : t.to,
          amount: t.amount / 100,
          reference: t.reference,
        }));
        return text(JSON.stringify({ account: account.id, holder: who(), transactions: list }));
      },
    },
    {
      name: "prepare-transfer",
      title: "Prepare a transfer",
      description: `Fill in the Send money form on this account with a recipient account number, amount and reference. This does not move money: the account holder must press Pay.`,
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient's account number at this bank, e.g. br-31877403." },
          amount: { type: "number", description: "Amount in US dollars, e.g. 400." },
          reference: { type: "string", description: "Payment reference, up to 40 characters." },
        },
        required: ["to", "amount"],
        additionalProperties: false,
      },
      annotations: { idempotentHint: true },
      execute: async (args) => {
        $("f-to").value = String(args.to || "");
        $("f-amount").value = String(args.amount || "");
        $("f-ref").value = String(args.reference || "").slice(0, 40);
        markPrepared(true);
        setStatus(`Prepared. ${who()} must press Pay.`, "prepared");
        pay.focus({ preventScroll: true });
        return text(
          `Prepared a transfer of $${args.amount} to ${args.to}${args.reference ? ` with reference ${args.reference}` : ""}. It has not been sent: ${who()} must press Pay.`
        );
      },
    },
  ];

  for (const tool of tools) {
    try {
      await mc.registerTool(tool, opts);
    } catch (err) {
      console.warn("[bank] could not register", tool.name, err);
    }
  }

  async function showTools() {
    try {
      const names = (await mc.getTools()).map((t) => t.name);
      $("tools-line").textContent = names.length
        ? `Tools on this page: ${names.join(", ")} + the send-transfer form (no toolautosubmit).`
        : "No tools registered.";
    } catch {
      $("tools-line").textContent = "Tool discovery failed.";
    }
  }
  mc.addEventListener("toolchange", showTools);
  await showTools();
})();
