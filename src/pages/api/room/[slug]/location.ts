import type { APIRoute } from "astro";
import { getRoom } from "../../../../lib/db";
import { updateLocation } from "../../../../lib/rooms";

export const POST: APIRoute = async ({ params, request }) => {
  const slug = params.slug;
  if (!slug || !getRoom(slug)) return new Response(null, { status: 404 });

  const body = await request.json().catch(() => null);
  const connectionId = typeof body?.connectionId === "string" ? body.connectionId : undefined;
  const offset = typeof body?.offset === "number" ? body.offset : undefined;
  if (!connectionId || offset === undefined || offset < 0) {
    return new Response(null, { status: 400 });
  }

  // Handle is resolved server-side from connectionId --- a client-supplied
  // handle on this request is never trusted; join() already established the
  // mapping when the SSE connection opened.
  const ok = updateLocation(slug, connectionId, offset);
  return new Response(null, { status: ok ? 204 : 400 });
};
