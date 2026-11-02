import type { APIRoute } from "astro";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS, hashPassword, signSession, verifyPassword } from "../../../lib/auth";
import { getUserByUsername } from "../../../lib/db";

// A fixed dummy hash/salt pair, run through verifyPassword() whenever the
// username lookup misses --- otherwise a nonexistent username returns
// measurably faster than a wrong password for a real one (no scryptSync call
// happens), leaking which usernames are registered via response timing even
// though the error message itself is generic either way.
const DUMMY = hashPassword("dummy-password-for-timing-only");

const GENERIC_ERROR = "Incorrect username or password";

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const user = username ? getUserByUsername(username) : undefined;
  // Always call verifyPassword, win or lose, so response timing doesn't
  // depend on whether the username exists --- the dummy call's result is
  // discarded (!user already decides the outcome for a missing user).
  const passwordOk = user
    ? verifyPassword(password, user.passwordHash, user.passwordSalt)
    : verifyPassword(password, DUMMY.hash, DUMMY.salt);

  if (!user || !passwordOk) {
    return new Response(JSON.stringify({ error: GENERIC_ERROR }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  cookies.set(SESSION_COOKIE_NAME, signSession(user.id), SESSION_COOKIE_OPTIONS);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
