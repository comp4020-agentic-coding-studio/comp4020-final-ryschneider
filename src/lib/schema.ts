import { sql } from "drizzle-orm";
import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Rooms are seeded by hand (scripts/seed-room.ts) --- never created through
// the app. The slug is the only way a room is ever addressed (the URL, the
// seed script's argument, heat_marks' reference below), so it's the primary
// key itself rather than a surrogate id with nothing to join through.
export const rooms = sqliteTable("rooms", {
  slug: text().primaryKey(),
  text: text().notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type Room = typeof rooms.$inferSelect;

// The permanent, anonymous residue of a note whose last original carrier
// disconnected: just a span, no author, no content. See src/lib/rooms.ts for
// the live note this used to be before it faded.
export const heatMarks = sqliteTable("heat_marks", {
  id: int().primaryKey({ autoIncrement: true }),
  roomSlug: text("room_slug")
    .notNull()
    .references(() => rooms.slug),
  startOffset: int("start_offset").notNull(),
  endOffset: int("end_offset").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type HeatMark = typeof heatMarks.$inferSelect;
