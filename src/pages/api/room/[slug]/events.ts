import type { APIRoute } from "astro";
import { getRoom } from "../../../../lib/db";
import { bus } from "../../../../lib/events";
import { getSnapshot, join, leave } from "../../../../lib/rooms";

// Server-sent events: a long-lived streaming response the browser consumes
// with `new EventSource(...)`. One-directional (server -> browser), which is
// why this needs no custom server or WebSocket upgrade --- it's plain HTTP.
export const GET: APIRoute = ({ params, url, locals }) => {
  const slug = params.slug;
  if (!slug || !getRoom(slug)) return new Response(null, { status: 404 });

  // Identity is resolved server-side from the session cookie (middleware
  // already populated locals.user), never trusted from a client-supplied
  // query param --- previously `handle` arrived unauthenticated on this
  // same URL, letting any client claim to be anyone.
  const user = locals.user;
  const connectionId = url.searchParams.get("connectionId");
  if (!connectionId || !user) return new Response(null, { status: user ? 400 : 401 });

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
