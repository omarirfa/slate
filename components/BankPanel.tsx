"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { arrears, installmentAmount, money, outstanding, pendingPayments } from "@/lib/engine";
import type { LoanState, Role } from "@/lib/types";
import type { ModelContextLike, RegisteredTool, ToolRegistry } from "@/lib/webmcp";

interface Props {
  bankOrigin: string;
  registry: ToolRegistry;
  mc: ModelContextLike;
  room: string;
  role: Role;
  myName: string;
  theirName: string;
  state: LoanState;
  /** Bumped by the parent whenever the page's own surface changes. */
  revision: number;
  /** Records this party's account number on the slate so the other half can pay to it. */
  onLink: (accountId: string) => Promise<{ ok: boolean; message: string }>;
}

interface BankCreds {
  id: string;
  secret: string;
}

function credsKey(room: string, role: Role): string {
  return `slate-bank:${room}:${role}`;
}

function loadCreds(room: string, role: Role): BankCreds | null {
  try {
    const raw = localStorage.getItem(credsKey(room, role));
    return raw ? (JSON.parse(raw) as BankCreds) : null;
  } catch {
    return null;
  }
}

interface BankTx {
  id: string;
  at: string;
  direction: "in" | "out";
  counterparty: string;
  amount: number;
  reference: string;
}

interface Note {
  id: number;
  text: string;
  tone: "ok" | "muted" | "warn";
}

const WATCH_MS = 3000;
const REF_PREFIX = "SLATE-";

/** The note a bank-sourced payment carries on the slate, so both halves can match it. */
function bankNote(tx: BankTx): string {
  return `bank ${tx.id} ref ${tx.reference}`;
}
function parseBankNote(note: string | undefined): { txId: string; reference: string } | null {
  const m = /^bank (\S+) ref (\S+)$/.exec(note ?? "");
  return m ? { txId: m[1], reference: m[2] } : null;
}

/**
 * The bank is another origin embedded here with allow="tools". This panel
 * never talks to the bank's server. It discovers the bank's tools with
 * getTools({ fromOrigins: [bank] }) and calls them with executeTool(), then
 * discharges the slate's own obligations through the slate's own tools:
 *
 *  borrower — an outgoing transfer carrying a slate reference is logged with
 *             log-payment, so "I paid" becomes "the bank says I paid";
 *  lender   — a pending payment is confirmed with confirm-payment only once
 *             list-transactions on the lender's account shows it landed.
 *
 * The lender's confirmation duty, registered by the borrower's log-payment,
 * is therefore satisfied by a read tool on a third origin rather than a
 * person clicking "yes". Money still moves only when a person presses Pay in
 * the bank frame: prepare-transfer fills the form and stops there.
 */
export default function BankPanel({
  bankOrigin,
  registry,
  mc,
  room,
  role,
  myName,
  theirName,
  state,
  revision,
  onLink,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [creds, setCreds] = useState<BankCreds | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const sessionRef = useRef<{ token: string; expiresAt: number } | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [attached, setAttached] = useState(false);
  const [bankTools, setBankTools] = useState<RegisteredTool[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const noteSeq = useRef(0);

  const note = useCallback((text: string, tone: Note["tone"] = "muted") => {
    setNotes((n) => [...n.slice(-7), { id: ++noteSeq.current, text, tone }]);
  }, []);

  const bankHost = useMemo(() => {
    try {
      return new URL(bankOrigin).host;
    } catch {
      return bankOrigin;
    }
  }, [bankOrigin]);

  /* --------------------------------------------------------- the account */

  // Each party gets their own numbered account, opened by Slate the first
  // time they arrive here. The secret lives in this browser and in the frame
  // URL only; the slate records just the number, which is what the other
  // half pays to.
  const otherRole: Role = role === "lender" ? "borrower" : "lender";
  const myAccount = state.bankAccounts?.[role] ?? null;
  const theirAccount = state.bankAccounts?.[otherRole] ?? null;

  useEffect(() => {
    const existing = loadCreds(room, role);
    if (existing) {
      setCreds(existing);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${bankOrigin}/api/accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ holder: myName }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!data?.ok) throw new Error(data?.message ?? "The bank would not open an account.");
        // The secret is shown once by the bank and kept only in this browser.
        const next: BankCreds = { id: data.account.id, secret: data.secret };
        localStorage.setItem(credsKey(room, role), JSON.stringify(next));
        setCreds(next);
      } catch (err) {
        if (!cancelled) setOpening(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bankOrigin, room, role, myName]);

  // Put the number on the slate once, or again if the slate was reset.
  useEffect(() => {
    if (!creds || myAccount === creds.id) return;
    void onLink(creds.id);
  }, [creds, myAccount, onLink]);

  /* ----------------------------------------------------------- sessions */

  // The frame never sees the secret. It gets a short-lived session token by
  // postMessage — on load, on request when one expires, and quietly a minute
  // before expiry. If the bank rejects the secret, the account is reopened.
  const mintSession = useCallback(async (): Promise<string | null> => {
    if (!creds) return null;
    try {
      const res = await fetch(`${bankOrigin}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: creds.id, secret: creds.secret }),
      });
      const data = await res.json();
      if (res.status === 403 && data?.code === "bad-credentials") {
        localStorage.removeItem(credsKey(room, role));
        setCreds(null);
        setFrameKey((k) => k + 1);
        return null;
      }
      if (!data?.ok) return null;
      sessionRef.current = { token: data.token, expiresAt: data.expiresAt };
      return data.token as string;
    } catch {
      return null;
    }
  }, [creds, bankOrigin, room, role]);

  const handToFrame = useCallback(
    async (fresh: boolean) => {
      const win = frameRef.current?.contentWindow;
      if (!win) return;
      const live = sessionRef.current && sessionRef.current.expiresAt - Date.now() > 60_000 ? sessionRef.current.token : null;
      const token = !fresh && live ? live : await mintSession();
      if (token) win.postMessage({ bramble: "session", token }, bankOrigin);
    },
    [mintSession, bankOrigin]
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== bankOrigin) return;
      const msg = event.data as { bramble?: string } | null;
      if (!msg) return;
      if (msg.bramble === "ready") void handToFrame(false);
      if (msg.bramble === "session-expired") void handToFrame(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bankOrigin, handToFrame]);

  // Renew a minute before expiry so the person never sees a gap.
  useEffect(() => {
    if (!creds) return;
    const timer = setInterval(() => {
      const s = sessionRef.current;
      if (s && s.expiresAt - Date.now() < 90_000) void handToFrame(true);
    }, 20_000);
    return () => clearInterval(timer);
  }, [creds, handToFrame]);

  /* -------------------------------------------------------- attach frame */

  const onLoad = useCallback(() => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    registry.attachFrame(win, bankOrigin);
    setAttached(true);
  }, [registry, bankOrigin]);

  useEffect(() => () => registry.detachFrame(bankOrigin), [registry, bankOrigin]);

  /* ----------------------------------------------------------- discover */

  const discover = useCallback(async () => {
    if (!attached) return [];
    try {
      const all = await mc.getTools({ fromOrigins: [bankOrigin] });
      const fromBank = all.filter((t) => t.origin === bankOrigin);
      setBankTools(fromBank);
      return all;
    } catch {
      setBankTools([]);
      return [];
    }
  }, [attached, mc, bankOrigin]);

  useEffect(() => {
    void discover();
  }, [discover, revision]);

  useEffect(() => {
    const handler = () => void discover();
    mc.addEventListener("toolchange", handler);
    return () => mc.removeEventListener("toolchange", handler);
  }, [mc, discover]);

  /* -------------------------------------------------------------- calls */

  const call = useCallback(
    async (tool: RegisteredTool, args: Record<string, unknown>) => {
      const result = (await mc.executeTool(tool, args)) as { content?: Array<{ text?: string }> };
      return result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
    },
    [mc]
  );

  const listTransactions = useCallback(
    async (all: RegisteredTool[], args: Record<string, unknown>): Promise<BankTx[] | null> => {
      const tool = all.find((t) => t.origin === bankOrigin && t.name === "list-transactions");
      if (!tool) return null;
      try {
        const text = await call(tool, args);
        const parsed = JSON.parse(text) as { transactions?: BankTx[] };
        return parsed.transactions ?? [];
      } catch {
        return null;
      }
    },
    [bankOrigin, call]
  );

  /* ------------------------------------------------------------ watchers */

  useEffect(() => {
    if (!attached) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      const s = stateRef.current;
      const all = await discover();
      if (!all.length) return;

      if (role === "borrower") {
        // Outgoing transfers with a slate reference that the slate has not seen.
        const txs = await listTransactions(all, { limit: 50 });
        if (!txs) return;
        const seen = new Set(
          s.payments.map((p) => parseBankNote(p.note)?.txId).filter((x): x is string => Boolean(x))
        );
        const fresh = txs
          .filter((t) => t.direction === "out" && t.reference.startsWith(`${REF_PREFIX}${room}-`) && !seen.has(t.id))
          .sort((a, b) => a.at.localeCompare(b.at));
        const tx = fresh[0];
        if (!tx) return;
        const log = all.find((t) => t.name === "log-payment" && t.origin !== bankOrigin);
        if (!log) {
          note(`The bank shows ${money(Math.round(tx.amount * 100), s.terms.currency)} sent (${tx.reference}), but log-payment is not on my surface right now.`, "warn");
          return;
        }
        note(`Bank shows ${money(Math.round(tx.amount * 100), s.terms.currency)} sent with ${tx.reference}. Logging it.`, "ok");
        const reply = await call(log, { amount: tx.amount, note: bankNote(tx) });
        note(reply, "muted");
        return;
      }

      // Lender: confirm pending bank-sourced payments only once they show as incoming.
      const pend = pendingPayments(s).filter((p) => parseBankNote(p.note));
      for (const p of pend) {
        const ref = parseBankNote(p.note)!;
        const txs = await listTransactions(all, { reference: ref.reference });
        if (!txs) return;
        const match = txs.find((t) => t.direction === "in" && t.id === ref.txId && Math.round(t.amount * 100) === p.amount);
        if (!match) continue;
        const confirm = all.find((t) => t.name === "confirm-payment" && t.origin !== bankOrigin);
        if (!confirm) {
          note(`${ref.reference} has landed, but confirm-payment is not on my surface right now.`, "warn");
          return;
        }
        note(`list-transactions shows ${ref.reference} landed from ${match.counterparty}. Confirming.`, "ok");
        const reply = await call(confirm, {
          paymentId: p.id,
          evidence: `${bankHost} transaction ${match.id}, ref ${ref.reference}, via list-transactions`,
        });
        note(reply, "muted");
        return;
      }
    };

    const timer = setInterval(() => void tick(), WATCH_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [attached, role, room, bankOrigin, bankHost, discover, listTransactions, call, note]);

  /* ------------------------------------------------------------ prepare */

  const nextRef = `${REF_PREFIX}${room}-${state.payments.length + 1}`;
  const late = arrears(state);
  const suggested = Math.min(late > 0 ? late : installmentAmount(state.terms), outstanding(state));
  const canPrepare =
    role === "borrower" && Boolean(theirAccount) && bankTools.some((t) => t.name === "prepare-transfer") && suggested > 0;

  async function prepare() {
    const tool = bankTools.find((t) => t.name === "prepare-transfer");
    if (!tool || !theirAccount) return;
    setBusy(true);
    try {
      const reply = await call(tool, { to: theirAccount, amount: suggested / 100, reference: nextRef });
      note(reply, "ok");
    } catch (err) {
      note(err instanceof Error ? err.message : String(err), "warn");
    } finally {
      setBusy(false);
    }
  }

  /* --------------------------------------------------------------- view */

  return (
    <section className="panel" aria-labelledby="bank-title">
      <div className="panel__head">
        <span className="label">Another origin, embedded with allow=&quot;tools&quot;</span>
        <h2 className="panel__title" id="bank-title">
          {myName}&rsquo;s bank
        </h2>
      </div>

      <div className="bank">
        <div className="bank__frame">
          {creds ? (
            <iframe
              key={frameKey}
              ref={frameRef}
              title={`Bank account for ${myName}`}
              src={`${bankOrigin}/`}
              onLoad={onLoad}
            // Delegates the WebMCP permission to the bank so the browser will
            // let it register tools; the bank's exposedTo then decides who
            // may discover them.
              allow="tools"
            />
          ) : (
            <p className="bank__discovered mono" style={{ padding: "var(--space-md)" }}>
              {opening ? `Could not open an account at ${bankHost}: ${opening}` : `Opening an account for ${myName} at ${bankHost}…`}
            </p>
          )}
        </div>

        <div className="bank__side">
          <p className="bank__discovered mono">
            {!attached
              ? `Loading ${bankHost}…`
              : bankTools.length
                ? `getTools({ fromOrigins: ["${bankHost}"] }) → ${bankTools.map((t) => t.name).join(", ")}`
                : `getTools({ fromOrigins: ["${bankHost}"] }) → nothing. Is the bank running, and does it expose tools to this origin?`}
          </p>

          {role === "borrower" ? (
            <div className="bank__action">
              <button type="button" className="btn btn--sm btn--primary" onClick={() => void prepare()} disabled={!canPrepare || busy}>
                {busy ? "Preparing" : `Prepare ${money(suggested, state.terms.currency)} at the bank`}
              </button>
              <p className="standin__note">
                {theirAccount ? (
                  <>
                    Calls the bank&rsquo;s <span className="mono">prepare-transfer</span> to {theirName}&rsquo;s account{" "}
                    <span className="mono">{theirAccount}</span> with reference <span className="mono">{nextRef}</span>. Nothing
                    moves until you press Pay in the frame. Once the bank shows the transfer, it is logged here through{" "}
                    <span className="mono">log-payment</span>.
                  </>
                ) : (
                  <>{theirName} hasn&rsquo;t opened a bank account yet. It opens the first time their slate shows the bank, once both halves are signed.</>
                )}
              </p>
            </div>
          ) : (
            <p className="standin__note">
              Watching {theirName}&rsquo;s bank-sourced payments. Each one is confirmed here through{" "}
              <span className="mono">confirm-payment</span> only once <span className="mono">list-transactions</span>{" "}
              on your account shows it landed — the confirmation duty is discharged by a read tool on another origin.
            </p>
          )}

          {notes.length > 0 && (
            <ul className="bank__notes">
              {notes.map((n) => (
                <li key={n.id} data-tone={n.tone}>
                  {n.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
