import type { APIRoute } from "astro";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS, hashPassword, signSession } from "../../../lib/auth";
import { createUser, getUserByUsername } from "../../../lib/db";

const MAX_USERNAME_LENGTH = 40;
const MIN_PASSWORD_LENGTH = 8;

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!username || username.length > MAX_USERNAME_LENGTH || password.length < MIN_PASSWORD_LENGTH) {
    return new Response(JSON.stringify({ error: "Invalid username or password" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (getUserByUsername(username)) {
    return new Response(JSON.stringify({ error: "That username is taken" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });
  }

  const { hash, salt } = hashPassword(password);
  const user = createUser(username, hash, salt);

  cookies.set(SESSION_COOKIE_NAME, signSession(user.id), SESSION_COOKIE_OPTIONS);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
