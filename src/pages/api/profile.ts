import type { APIRoute } from "astro";
import { getUserByUsername, updateUserProfile } from "../../lib/db";
import { isValidNoteColor } from "../../lib/palette";

const MAX_USERNAME_LENGTH = 40;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return new Response(null, { status: 401 });

  const body = await request.json().catch(() => null);
  const rawUsername = typeof body?.username === "string" ? body.username.trim() : undefined;
  const rawColor = typeof body?.color === "string" ? body.color : undefined;

  if (rawUsername !== undefined) {
    if (!rawUsername || rawUsername.length > MAX_USERNAME_LENGTH) {
      return new Response(JSON.stringify({ error: "Invalid username" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const existing = getUserByUsername(rawUsername);
    if (existing && existing.id !== user.id) {
      return new Response(JSON.stringify({ error: "That username is taken" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    }
  }

  // The palette is curated, not just suggested in the UI --- this is the
  // actual enforcement point, rejecting anything that isn't one of the
  // exact --note-* hex values (src/lib/palette.ts).
  if (rawColor !== undefined && !isValidNoteColor(rawColor)) {
    return new Response(JSON.stringify({ error: "Invalid color" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  updateUserProfile(user.id, { username: rawUsername, color: rawColor });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
