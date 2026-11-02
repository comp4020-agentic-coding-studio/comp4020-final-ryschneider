import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scryptSync's default cost parameters use roughly 16-17MB of transient
// memory per concurrent call --- worth naming given fly.toml's own comment
// that the whole app has to fit in 256MB. Fine for this app's realistic
// concurrency (a handful of logins during a crit demo), but not something to
// leave unstated given this repo's discipline about the memory ceiling.
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

// Fail loudly, not silently: a hardcoded fallback here would mean that if
// SESSION_SECRET is ever unset in production (an easy manual step to miss),
// the app would silently sign cookies with a secret sitting in plaintext in
// the source --- and this repo goes public once shipped, so that fallback
// would become a publicly known key, letting anyone forge a session for any
// userId. Only accept a missing secret in local dev.
const SECRET =
  process.env.SESSION_SECRET ??
  (import.meta.env.DEV
    ? "dev-only-insecure-secret"
    : (() => {
        throw new Error(
          "SESSION_SECRET must be set outside local dev --- see ARCHITECTURE.md's Accounts and sessions section",
        );
      })());

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// The payload is userId.issuedAt, not just userId --- an HMAC with no
// timestamp never expires on the server side no matter what maxAge the
// cookie itself claims (a copied cookie would otherwise be valid forever,
// since maxAge is a browser-only hint the server can't check against a
// payload that doesn't encode it).
export function signSession(userId: number): string {
  const payload = `${userId}.${Date.now()}`;
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [idPart, issuedAtPart, sig] = parts;
  const payload = `${idPart}.${issuedAtPart}`;
  const expected = createHmac("sha256", SECRET).update(payload).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const issuedAt = Number(issuedAtPart);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > SESSION_MAX_AGE_MS) return null;
  const userId = Number(idPart);
  return Number.isInteger(userId) ? userId : null;
}

export const SESSION_COOKIE_NAME = "session";

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: import.meta.env.PROD,
  sameSite: "lax" as const,
  maxAge: SESSION_MAX_AGE_MS / 1000,
  path: "/",
};
