import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE_NAME, verifySession } from "./lib/auth";
import { getUserById } from "./lib/db";

// Runs once per request and resolves "who's logged in, if anyone" into
// Astro.locals.user --- the one place every page/layout reads identity from,
// instead of each of them independently parsing the session cookie.
export const onRequest = defineMiddleware((context, next) => {
  const token = context.cookies.get(SESSION_COOKIE_NAME)?.value;
  const userId = verifySession(token);
  context.locals.user = userId ? (getUserById(userId) ?? null) : null;
  return next();
});
