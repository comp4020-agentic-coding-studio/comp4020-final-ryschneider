import type { APIRoute } from "astro";
import { getRoom } from "../../../../lib/db";
import { writeNote } from "../../../../lib/rooms";

const MAX_NOTE_LENGTH = 280;

export const POST: APIRoute = async ({ params, request }) => {
  const slug = params.slug;
  const room = slug ? getRoom(slug) : undefined;
  if (!slug || !room) return new Response(null, { status: 404 });

  const body = await request.json().catch(() => null);
  const connectionId = typeof body?.connectionId === "string" ? body.connectionId : undefined;
  const start = typeof body?.start === "number" ? body.start : undefined;
  const end = typeof body?.end === "number" ? body.end : undefined;
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_NOTE_LENGTH) : undefined;

  if (
    !connectionId ||
    start === undefined ||
    end === undefined ||
    !text ||
    !(start >= 0 && start < end && end <= room.text.length)
  ) {
    return new Response(null, { status: 400 });
  }

  const note = writeNote(slug, connectionId, start, end, text);
  if (!note) return new Response(null, { status: 400 }); // connectionId never joined

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
