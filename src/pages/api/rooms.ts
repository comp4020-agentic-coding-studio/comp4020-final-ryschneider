import type { APIRoute } from "astro";
import { createRoom } from "../../lib/db";
import { getLibraryEntry, readLibraryText } from "../../lib/library";

const MAX_ROOM_TITLE_LENGTH = 80;
const MIN_ROOM_SIZE = 2;
const MAX_ROOM_SIZE = 50;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return new Response(null, { status: 401 });

  const body = await request.json().catch(() => null);
  const textSlug = typeof body?.textSlug === "string" ? body.textSlug : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const maxSize = typeof body?.maxSize === "number" ? body.maxSize : undefined;

  // The <select> on the homepage only offers valid slugs, but this is the
  // real enforcement point --- same posture as isValidNoteColor() for the
  // curated color palette: never trust a submitted value just because the
  // client only offered valid ones.
  const entry = getLibraryEntry(textSlug);
  if (!entry) {
    return new Response(JSON.stringify({ error: "Pick a text from the library" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (!title || title.length > MAX_ROOM_TITLE_LENGTH) {
    return new Response(JSON.stringify({ error: `Title is required (max ${MAX_ROOM_TITLE_LENGTH} characters)` }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (maxSize === undefined || !Number.isInteger(maxSize) || maxSize < MIN_ROOM_SIZE || maxSize > MAX_ROOM_SIZE) {
    return new Response(
      JSON.stringify({ error: `Max size must be a whole number between ${MIN_ROOM_SIZE} and ${MAX_ROOM_SIZE}` }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const room = createRoom({
    textSlug: entry.slug,
    text: readLibraryText(entry.file),
    title: entry.title,
    author: entry.author,
    kind: entry.kind,
    sourceNote: entry.sourceNote,
    description: entry.description,
    customTitle: title,
    maxSize,
    creatorUserId: user.id,
  });

  return new Response(JSON.stringify({ ok: true, slug: room.slug }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
