"use client";

import { useState } from "react";
import type { LoanState, Role } from "@/lib/types";

interface Props {
  keys: Partial<Record<Role, string>>;
  state: LoanState;
  note: string | null;
  /** Opener: creates the terms proposal in your name and takes your half. */
  onOpen: (role: Role, names: { lender: string; borrower: string }, principal: number) => Promise<{ ok: boolean; message: string }>;
  /** Invitee: takes the half the invite link carries. */
  onTake: (role: Role) => void;
}

/**
 * Three fields and a switch. Real names are what make this useful rather than
 * a demo: the slate is between two people, and they should be named on it.
 */
export default function Opener({ keys, state, note, onOpen, onTake }: Props) {
  const both = Boolean(keys.lender && keys.borrower);
  const invited: Role | null = !both ? (keys.lender ? "lender" : keys.borrower ? "borrower" : null) : null;

  const [me, setMe] = useState("");
  const [them, setThem] = useState("");
  const [amount, setAmount] = useState("");
  const [lent, setLent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    const principal = Number(amount);
    if (!me.trim() || !them.trim()) return setError("Both names are needed.");
    if (!Number.isFinite(principal) || principal < 10) return setError("Enter the amount lent, at least 10.");
    setError(null);
    setBusy(true);
    const role: Role = lent ? "lender" : "borrower";
    const names = lent ? { lender: me.trim(), borrower: them.trim() } : { lender: them.trim(), borrower: me.trim() };
    const res = await onOpen(role, names, principal);
    setBusy(false);
    if (!res.ok) setError(res.message);
  }

  if (invited) {
    const name = invited === "lender" ? state.terms.lenderName : state.terms.borrowerName;
    const other = invited === "lender" ? state.terms.borrowerName : state.terms.lenderName;
    return (
      <div className="opener">
        <h2 className="panel__title">Your half is ready, {name}.</h2>
        <p className="opener__lede">
          {other} opened a slate with you{state.terms.principal ? ` for $${(state.terms.principal / 100).toLocaleString("en-US")}` : ""}. Your invite carries your half-key and only yours — nobody
          else can act as you.
        </p>
        <button type="button" className="btn btn--primary" onClick={() => onTake(invited)}>
          Open my half
        </button>
      </div>
    );
  }

  if (!both) {
    return (
      <div className="opener">
        <h2 className="panel__title">{note ? "This slate is taken" : "Opening a slate…"}</h2>
        {note && <p className="entry__warn">{note}</p>}
        {note && (
          <p className="opener__lede">
            Start your own instead:{" "}
            <a className="link" href="/">
              open a new slate
            </a>
            .
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="opener">
      <h2 className="panel__title">Open a slate</h2>

      <div className="opener__switch" role="radiogroup" aria-label="Which way did the money go">
        <label className="opener__opt" data-on={lent || undefined}>
          <input type="radio" name="dir" checked={lent} onChange={() => setLent(true)} />I lent it
        </label>
        <label className="opener__opt" data-on={!lent || undefined}>
          <input type="radio" name="dir" checked={!lent} onChange={() => setLent(false)} />I borrowed it
        </label>
      </div>

      <div className="opener__fields">
        <div className="field">
          <label className="field__label" htmlFor="op-me">
            Your name
          </label>
          <input id="op-me" className="input" value={me} onChange={(e) => setMe(e.target.value)} autoComplete="given-name" maxLength={24} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="op-them">
            {lent ? "Who you lent to" : "Who lent it"}
          </label>
          <input id="op-them" className="input" value={them} onChange={(e) => setThem(e.target.value)} maxLength={24} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="op-amount">
            How much
          </label>
          <input id="op-amount" className="input figure" inputMode="decimal" placeholder="2400" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>

      <div className="console__row">
        <button type="button" className="btn btn--primary" onClick={() => void open()} disabled={busy}>
          {busy ? "Opening" : "Open the slate"}
        </button>
        <span className="field__help">Six monthly payments, two nudges a month, a 21-day cure period. Change any of it before you sign.</span>
      </div>
      {error && <p className="entry__warn">{error}</p>}

      <p className="field__help">You&rsquo;ll get a link to send {them.trim() || "them"}. It carries their half-key and only theirs.</p>
    </div>
  );
}
