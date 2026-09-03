import { NextRequest, NextResponse } from "next/server";
import { actOnRoom, getPresence, getRoom, holdsAnyKey, holdsKey, isOpened, openRoom } from "@/lib/store";
import { roomFetch } from "@/lib/rooms";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Room-level actions: not a party's capability, so any half-key will do. */
const ROOM_ACTIONS = new Set(["advance-clock", "reset", "set-simulated-role"]);

export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get("room") ?? "DEMO";
  // On Cloudflare the room is a Durable Object; forward and return its answer.
  const forwarded = await roomFetch(room, "/state", { method: "GET" });
  if (forwarded) return forwarded;
  return NextResponse.json({ state: getRoom(room), opened: isOpened(room), presence: getPresence(room) });
}

interface Body {
  room?: string;
  type?: string;
  role?: Role;
  key?: string;
  via?: "tool" | "ui" | "clock";
  payload?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request body." }, { status: 400 });
  }

  const { room = "DEMO", type, role, key, via = "ui", payload = {} } = body;
  if (!type) {
    return NextResponse.json({ ok: false, message: "An action needs a type." }, { status: 400 });
  }

  const forwarded = await roomFetch(room, "/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (forwarded) return forwarded;

  // Opening a room mints both half-keys, once. The opener passes the other
  // half's key on in an invite link; the server never hands it out again.
  if (type === "open-room") {
    const minted = openRoom(room);
    if (!minted) {
      return NextResponse.json({
        ok: false,
        message: "This slate has already been opened. Ask the person who opened it for your invite link.",
        state: getRoom(room),
      });
    }
    return NextResponse.json({ ok: true, message: "Slate opened.", keys: minted, state: getRoom(room) });
  }

  if (!role) {
    return NextResponse.json({ ok: false, message: "An action needs a role." }, { status: 400 });
  }

  // The role is only as good as the key that comes with it. A call claiming
  // to be the lender without the lender's half-key is refused before the
  // capability surface is even consulted.
  const allowed = ROOM_ACTIONS.has(type) ? holdsAnyKey(room, key) : holdsKey(room, role, key);
  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        message: `Refused: that call does not carry the ${role}'s half-key.`,
        state: getRoom(room),
        changed: [],
      },
      { status: 403 }
    );
  }

  // Every action is re-checked against the capability surface here, so a tool
  // call forged from outside the page is refused just as it would be in-page.
  const result = actOnRoom(room, { type, role, via, payload });
  return NextResponse.json({
    ok: result.ok,
    message: result.message,
    state: result.state,
    changed: result.changed,
  });
}
