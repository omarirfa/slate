/**
 * Bridge from the Next.js API routes to wherever the room lives.
 *
 * On Cloudflare, each room is a Durable Object reached through the ROOM
 * binding; the route forwards the request there and returns the object's
 * response untouched (including the event stream). Anywhere else — `next dev`
 * without wrangler, `next start`, Render — there is no binding, and the routes
 * fall back to the in-process store in lib/store.ts.
 */

interface RoomNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export function normaliseRoom(code: string | null | undefined): string {
  return (code ?? "DEMO").toUpperCase().slice(0, 8);
}

export async function roomFetch(room: string, path: string, init?: RequestInit): Promise<Response | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    const ns = (env as unknown as { ROOM?: RoomNamespace }).ROOM;
    if (!ns) return null;
    const key = normaliseRoom(room);
    const stub = ns.get(ns.idFromName(key));
    const url = new URL(`https://room${path}`);
    url.searchParams.set("room", key);
    return await stub.fetch(new Request(url.toString(), init));
  } catch {
    return null;
  }
}
