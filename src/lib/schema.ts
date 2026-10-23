import { sql } from "drizzle-orm";
import { int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Rooms are seeded by hand (scripts/seed-from-library.ts) --- never created through
// the app. The slug is the only way a room is ever addressed (the URL, the
// seed script's argument, heat_marks' reference below), so it's the primary
// key itself rather than a surrogate id with nothing to join through.
//
// Each room is one instance of a text from the library (scripts/library/,
// seeded via scripts/seed-from-library.ts): textSlug identifies which work
// (e.g. "macbeth"), instance is that work's 1-based room count (so the room
// displays as "Macbeth #0001", the next one seeded from the same work as
// "Macbeth #0002"). title/author/kind/sourceNote/description are copied in
// at seed time from the library's manifest rather than joined against it,
// since the manifest is a build-time asset, not a database table --- a
// room's display metadata stays exactly what it was seeded with even if the
// library's own copy is edited afterwards.
export const rooms = sqliteTable(
  "rooms",
  {
    slug: text().primaryKey(),
    text: text().notNull(),
    textSlug: text("text_slug").notNull(),
    instance: int().notNull(),
    title: text().notNull(),
    author: text().notNull(),
    kind: text().notNull(), // "poem" | "play" | "book"
    sourceNote: text("source_note").notNull(),
    description: text().notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [uniqueIndex("rooms_text_slug_instance_idx").on(table.textSlug, table.instance)],
);

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
