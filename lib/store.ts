import { randomBytes } from "node:crypto";
import { apply, newLoan, type Action, type ActionResult } from "./engine";
import { LoanState, Role } from "./types";

/**
 * In-memory room store. Deliberately simple: one Node process holds the slate
 * so two devices can share it. Swap for Redis or a database if you deploy to a
 * serverless platform with more than one instance.
 *
 * Each room has two half-keys, one per party. The first device to open a room
 * receives both and hands the other one over in an invite link. Every mutation
 * must carry the key for the role it claims, so a role cannot be forged by
 * editing the address bar.
 */

export interface RoomKeys {
  lender: string;
  borrower: string;
}

export interface HalfPresence {
  /** Open event streams for this half right now. */
  online: boolean;
  /** Last time this half's device was connected, or null if it never has been. */
  lastSeen: number | null;
}
export type Presence = Record<Role, HalfPresence>;

type Listener = (state: LoanState, presence: Presence) => void;

declare global {
  // eslint-disable-next-line no-var
  var __slatePresence: Map<string, Record<Role, { connections: number; lastSeen: number | null }>> | undefined;
  // eslint-disable-next-line no-var
  var __slateRooms: Map<string, LoanState> | undefined;
  // eslint-disable-next-line no-var
  var __slateKeys: Map<string, RoomKeys> | undefined;
  // eslint-disable-next-line no-var
  var __slateListeners: Map<string, Set<Listener>> | undefined;
}

const rooms: Map<string, LoanState> = globalThis.__slateRooms ?? new Map();
const keys: Map<string, RoomKeys> = globalThis.__slateKeys ?? new Map();
const listeners: Map<string, Set<Listener>> = globalThis.__slateListeners ?? new Map();
const presence: Map<string, Record<Role, { connections: number; lastSeen: number | null }>> =
  globalThis.__slatePresence ?? new Map();
globalThis.__slatePresence = presence;
globalThis.__slateRooms = rooms;
globalThis.__slateKeys = keys;
globalThis.__slateListeners = listeners;

const MAX_ROOMS = 200;

/** Set SLATE_OPEN_ROOMS=1 to skip key checks. Demo-only: it makes roles forgeable. */
export const OPEN_ROOMS = process.env.SLATE_OPEN_ROOMS === "1";

function normalise(code: string): string {
  return code.toUpperCase().slice(0, 8);
}

export function getRoom(code: string): LoanState {
  const key = normalise(code);
  let state = rooms.get(key);
  if (!state) {
    state = newLoan(key);
    rooms.set(key, state);
    if (rooms.size > MAX_ROOMS) {
      const oldest = [...rooms.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) {
        rooms.delete(oldest[0]);
        keys.delete(oldest[0]);
        listeners.delete(oldest[0]);
      }
    }
  }
  return state;
}

/* ------------------------------------------------------------------- keys */

function mintKey(): string {
  return randomBytes(12).toString("base64url");
}

/** Whether a room has been opened (had its keys minted) yet. */
export function isOpened(code: string): boolean {
  return keys.has(normalise(code));
}

/**
 * Mint both half-keys for a fresh room. Returns null if the room was already
 * opened: the second device gets its key from the first one's invite link,
 * never from the server.
 */
export function openRoom(code: string): RoomKeys | null {
  const key = normalise(code);
  getRoom(key);
  if (keys.has(key)) return null;
  const minted = { lender: mintKey(), borrower: mintKey() };
  keys.set(key, minted);
  return minted;
}

export function holdsKey(code: string, role: Role, key: string | undefined): boolean {
  if (OPEN_ROOMS) return true;
  const k = keys.get(normalise(code));
  if (!k || !key) return false;
  return k[role] === key;
}

/** True if the key opens either half. Used for room-level actions like the clock. */
export function holdsAnyKey(code: string, key: string | undefined): boolean {
  if (OPEN_ROOMS) return true;
  const k = keys.get(normalise(code));
  if (!k || !key) return false;
  return k.lender === key || k.borrower === key;
}

/* --------------------------------------------------------------- presence */

function presenceFor(key: string) {
  let p = presence.get(key);
  if (!p) {
    p = {
      lender: { connections: 0, lastSeen: null },
      borrower: { connections: 0, lastSeen: null },
    };
    presence.set(key, p);
  }
  return p;
}

export function getPresence(code: string): Presence {
  const p = presenceFor(normalise(code));
  return {
    lender: { online: p.lender.connections > 0, lastSeen: p.lender.lastSeen },
    borrower: { online: p.borrower.connections > 0, lastSeen: p.borrower.lastSeen },
  };
}

/** A half's device connected its event stream. */
export function connect(code: string, role: Role): void {
  const key = normalise(code);
  const p = presenceFor(key);
  p[role].connections += 1;
  p[role].lastSeen = Date.now();
  notify(key, getRoom(key));
}

export function disconnect(code: string, role: Role): void {
  const key = normalise(code);
  const p = presenceFor(key);
  p[role].connections = Math.max(0, p[role].connections - 1);
  p[role].lastSeen = Date.now();
  notify(key, getRoom(key));
}

/* ---------------------------------------------------------------- actions */

export function actOnRoom(code: string, action: Action): ActionResult {
  const key = normalise(code);
  const current = getRoom(key);
  const result = apply(current, action);
  if (result.ok) {
    rooms.set(key, result.state);
    notify(key, result.state);
  }
  return result;
}

/* ------------------------------------------------------------- live feed */

export function subscribe(code: string, fn: Listener): () => void {
  const key = normalise(code);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(key);
  };
}

function notify(key: string, state: LoanState): void {
  const set = listeners.get(key);
  if (!set) return;
  const p = getPresence(key);
  for (const fn of set) {
    try {
      fn(state, p);
    } catch {
      /* a dead stream should not stop the others */
    }
  }
}

export function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
