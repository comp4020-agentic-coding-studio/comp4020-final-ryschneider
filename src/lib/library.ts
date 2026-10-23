import type { Room } from "./schema";

// "Macbeth #0001": the display name for a room, derived from its library
// metadata rather than stored as its own column --- the instance number is
// zero-padded to 4 digits, which is a display choice, not a limit (a 5th
// digit just grows the string if a work is ever seeded 10,000+ times).
export function displayName(room: Pick<Room, "title" | "instance">): string {
  return `${room.title} #${String(room.instance).padStart(4, "0")}`;
}
