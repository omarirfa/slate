import { DurableObject } from "cloudflare:workers";
import { apply, newLoan, type Action } from "../lib/engine";
import type { LoanState, Role } from "../lib/types";

/**
 * One room, one object. This is lib/store.ts moved into a Durable Object so
 * it survives restarts and works from every edge location. The same three
 * endpoints the Next.js routes expose are implemented here; the routes just
 * forward to the object for the room in question.
 *
 *   GET  /state?room=X            → { state, opened, presence }
 *   POST /state  { room, type, role, key, via, payload }
 *   GET  /events?room=X&role=R    → server-sent events: state + presence
 *
 * Storage is the object's own SQLite-backed KV; the engine, key checks and
 * refusal messages are identical to the Node version.
 */

interface RoomKeys {
  lender: string;
  borrower: string;
}

interface HalfPresence {
  online: boolean;
  lastSeen: number | null;
}
type Presence = Record<Role, HalfPresence>;

interface Stream {
  controller: ReadableStreamDefaultController<Uint8Array>;
  role: Role | null;
  heartbeat: ReturnType<typeof setInterval>;
}

interface Env {
  SLATE_OPEN_ROOMS?: string;
}

const ROOM_ACTIONS = new Set(["advance-clock", "reset", "set-simulated-role"]);
const encoder = new TextEncoder();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function mintKey(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class SlateRoom extends DurableObject<Env> {
  private streams = new Set<Stream>();
  private lastSeen: Record<Role, number | null> = { lender: null, borrower: null };
  private loaded = false;
  private state: LoanState | null = null;
  private keys: RoomKeys | null = null;
  private room = "DEMO";

  /* ------------------------------------------------------------ storage */

  private async load(room: string): Promise<void> {
    if (this.loaded) return;
    this.room = room;
    const [state, keys, seen] = await Promise.all([
      this.ctx.storage.get<LoanState>("state"),
      this.ctx.storage.get<RoomKeys>("keys"),
      this.ctx.storage.get<Record<Role, number | null>>("lastSeen"),
    ]);
    this.state = state ?? newLoan(room);
    this.keys = keys ?? null;
    if (seen) this.lastSeen = seen;
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put("state", this.state);
  }

  private presence(): Presence {
    const online = { lender: 0, borrower: 0 };
    for (const s of this.streams) if (s.role) online[s.role] += 1;
    return {
      lender: { online: online.lender > 0, lastSeen: this.lastSeen.lender },
      borrower: { online: online.borrower > 0, lastSeen: this.lastSeen.borrower },
    };
  }

  private holdsKey(role: Role, key: string | undefined): boolean {
    if (this.env.SLATE_OPEN_ROOMS === "1") return true;
    return Boolean(this.keys && key && this.keys[role] === key);
  }

  private holdsAnyKey(key: string | undefined): boolean {
    if (this.env.SLATE_OPEN_ROOMS === "1") return true;
    return Boolean(this.keys && key && (this.keys.lender === key || this.keys.borrower === key));
  }

  /* --------------------------------------------------------------- feed */

  private broadcast(): void {
    const state = this.state!;
    const presence = this.presence();
    const frame =
      `event: state\ndata: ${JSON.stringify(state)}\n\n` + `event: presence\ndata: ${JSON.stringify(presence)}\n\n`;
    const bytes = encoder.encode(frame);
    for (const s of this.streams) {
      try {
        s.controller.enqueue(bytes);
      } catch {
        this.drop(s);
      }
    }
  }

  private drop(s: Stream): void {
    if (!this.streams.delete(s)) return;
    clearInterval(s.heartbeat);
    if (s.role) {
      this.lastSeen[s.role] = Date.now();
      void this.ctx.storage.put("lastSeen", this.lastSeen);
      this.broadcast();
    }
  }

  /* ------------------------------------------------------------- fetch */

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const room = (url.searchParams.get("room") ?? "DEMO").toUpperCase().slice(0, 8);
    await this.load(room);

    if (url.pathname === "/state" && request.method === "GET") {
      return json({ state: this.state, opened: Boolean(this.keys), presence: this.presence() });
    }

    if (url.pathname === "/state" && request.method === "POST") {
      let body: {
        type?: string;
        role?: Role;
        key?: string;
        via?: "tool" | "ui" | "clock";
        payload?: Record<string, unknown>;
      };
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, message: "Malformed request body." }, 400);
      }
      const { type, role, key, via = "ui", payload = {} } = body;
      if (!type) return json({ ok: false, message: "An action needs a type." }, 400);

      if (type === "open-room") {
        if (this.keys) {
          return json({
            ok: false,
            message: "This slate has already been opened. Ask the person who opened it for your invite link.",
            state: this.state,
          });
        }
        this.keys = { lender: mintKey(), borrower: mintKey() };
        await this.ctx.storage.put("keys", this.keys);
        return json({ ok: true, message: "Slate opened.", keys: this.keys, state: this.state });
      }

      if (!role) return json({ ok: false, message: "An action needs a role." }, 400);

      const allowed = ROOM_ACTIONS.has(type) ? this.holdsAnyKey(key) : this.holdsKey(role, key);
      if (!allowed) {
        return json(
          { ok: false, message: `Refused: that call does not carry the ${role}'s half-key.`, state: this.state, changed: [] },
          403
        );
      }

      const result = apply(this.state!, { type, role, via, payload } as Action);
      if (result.ok) {
        this.state = result.state;
        await this.save();
        this.broadcast();
      }
      return json({ ok: result.ok, message: result.message, state: result.state, changed: result.changed });
    }

    if (url.pathname === "/events" && request.method === "GET") {
      const roleParam = url.searchParams.get("role");
      const role: Role | null = roleParam === "lender" || roleParam === "borrower" ? roleParam : null;
      let stream: Stream | null = null;

      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          stream = {
            controller,
            role,
            heartbeat: setInterval(() => {
              try {
                controller.enqueue(encoder.encode(`: ping\n\n`));
              } catch {
                if (stream) this.drop(stream);
              }
            }, 15_000),
          };
          this.streams.add(stream);
          if (role) {
            this.lastSeen[role] = Date.now();
            void this.ctx.storage.put("lastSeen", this.lastSeen);
          }
          // Everyone, including the new stream, sees the presence change.
          this.broadcast();
        },
        cancel: () => {
          if (stream) this.drop(stream);
        },
      });

      request.signal.addEventListener("abort", () => {
        if (stream) this.drop(stream);
      });

      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    return json({ ok: false, message: "Not found." }, 404);
  }
}
