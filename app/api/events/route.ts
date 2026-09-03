import { NextRequest } from "next/server";
import { connect, disconnect, getPresence, getRoom, subscribe, type Presence } from "@/lib/store";
import { roomFetch } from "@/lib/rooms";
import type { LoanState, Role } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-sent events for one room. The other half's tools should appear on
 * this page the moment they register, not a poll later; this is what makes
 * the two-window demo feel like one slate rather than two copies.
 */
export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get("room") ?? "DEMO";
  const roleParam = req.nextUrl.searchParams.get("role");
  const role: Role | null = roleParam === "lender" || roleParam === "borrower" ? roleParam : null;

  // On Cloudflare the object owns the stream; hand it straight through.
  const forwarded = await roomFetch(room, `/events${role ? `?role=${role}` : ""}`, {
    method: "GET",
    signal: req.signal,
  });
  if (forwarded) return forwarded;

  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (state: LoanState, presence: Presence) => {
        try {
          controller.enqueue(encoder.encode(`event: state\ndata: ${JSON.stringify(state)}\n\n`));
          controller.enqueue(encoder.encode(`event: presence\ndata: ${JSON.stringify(presence)}\n\n`));
        } catch {
          /* closed */
        }
      };
      unsubscribe = subscribe(room, send);
      // Connecting as a half is what makes that half "here" to the other.
      if (role) connect(room, role);
      else send(getRoom(room), getPresence(room));
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* closed */
        }
      }, 15_000);
    },
    cancel() {
      close();
    },
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe?.();
    if (heartbeat) clearInterval(heartbeat);
    if (role) disconnect(room, role);
  };

  req.signal.addEventListener("abort", close);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
