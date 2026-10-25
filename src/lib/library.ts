import type { Room } from "./schema";

// "Macbeth #0001": the display name for a room, derived from its library
// metadata rather than stored as its own column --- the instance number is
// zero-padded to 4 digits, which is a display choice, not a limit (a 5th
// digit just grows the string if a work is ever seeded 10,000+ times).
export function displayName(room: Pick<Room, "title" | "instance">): string {
  return `${room.title} #${String(room.instance).padStart(4, "0")}`;
}

// SQLite's datetime('now') (used by every createdAt default, and by
// heat_marks) writes UTC as "YYYY-MM-DD HH:MM:SS" --- no "Z", no "T". Handed
// straight to `new Date(...)`, JS parses that as LOCAL time, not UTC, so the
// result is silently off by the server's UTC offset. Replacing the space
// with "T" and appending "Z" is what makes it parse as the UTC instant it
// actually is.
function parseSqliteTimestamp(value: string): Date {
  return new Date(`${value.replace(" ", "T")}Z`);
}

// A short, relative "how long ago" string for a room-list timestamp ---
// coarse on purpose (a room list doesn't need second-level precision, and
// coarseness means it doesn't need live updating to stay honest between
// page loads).
export function timeAgo(value: string): string {
  const ms = Date.now() - parseSqliteTimestamp(value).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// A plain calendar date for "created" --- absolute, not relative, since a
// room's creation is a fixed fact worth stating exactly rather than letting
// it erode into "3mo ago" as the library ages.
export function formatDate(value: string): string {
  return parseSqliteTimestamp(value).toLocaleDateString("en-AU", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
