import type { APIRoute } from "astro";
import { getRoom } from "../../../../lib/db";
import { bus } from "../../../../lib/events";
import { getSnapshot, isPresent, join, leave, presenceCount } from "../../../../lib/rooms";

// Server-sent events: a long-lived streaming response the browser consumes
// with `new EventSource(...)`. One-directional (server -> browser), which is
// why this needs no custom server or WebSocket upgrade --- it's plain HTTP.
export const GET: APIRoute = ({ params, url, locals }) => {
  const slug = params.slug;
  const room = slug ? getRoom(slug) : undefined;
  if (!slug || !room) return new Response(null, { status: 404 });

  // Identity is resolved server-side from the session cookie (middleware
  // already populated locals.user), never trusted from a client-supplied
  // query param --- previously `handle` arrived unauthenticated on this
  // same URL, letting any client claim to be anyone.
  const user = locals.user;
  const connectionId = url.searchParams.get("connectionId");
  if (!connectionId || !user) return new Response(null, { status: user ? 400 : 401 });

  // The real capacity boundary --- the room page's own SSR check is only
  // the visible UX; it can't be atomic with this connect (a room can fill
  // in the gap between page render and the client opening its
  // EventSource), so this is what actually stops a room exceeding its cap.
  if (room.maxSize !== null && !isPresent(slug, user.id) && presenceCount(slug) >= room.maxSize) {
    return new Response(JSON.stringify({ error: "This room is full" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  let onEvent: (event: unknown) => void;
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream<string>({
    start(controller) {
      controller.enqueue(": connected\n\n");
      heartbeat = setInterval(() => controller.enqueue(": ping\n\n"), 30_000);

      // join() then read-the-snapshot then subscribe, all synchronous: no
      // window where a concurrent event could be missed or double-delivered.
      join(slug, connectionId, user.id, user.username, user.color);
      controller.enqueue(`data: ${JSON.stringify(getSnapshot(slug))}\n\n`);
      onEvent = (event) => controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
      bus.on(`room:${slug}`, onEvent);
    },
    cancel() {
      clearInterval(heartbeat);
      bus.off(`room:${slug}`, onEvent);
      leave(slug, connectionId); // may itself emit leave/fade to everyone else
    },
  });

  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
};
