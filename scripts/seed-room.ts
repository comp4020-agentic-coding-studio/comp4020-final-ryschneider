#!/usr/bin/env node
// Rooms are only ever created by hand, via this script:
//   node scripts/seed-room.ts <slug> <path-to-text-file>
//
// This doesn't import src/lib/db.ts: that file is only ever imported through
// Astro's Vite bundler, which resolves its extensionless `./schema` import;
// run directly by plain Node (as this script is, per tsconfig's
// allowImportingTsExtensions comment) that import would fail, and db.ts's
// own migrate()-at-import-time would also redundantly re-run. So this script
// sets up its own tiny connection instead, duplicating db.ts's ~6 lines of
// boilerplate once, deliberately.
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { heatMarks, rooms } from "../src/lib/schema.ts";

const [, , slug, filePath] = process.argv;
if (!slug || !filePath) {
  console.error("usage: node scripts/seed-room.ts <slug> <path-to-text-file>");
  process.exit(1);
}

const text = readFileSync(filePath, "utf8");
const dbPath = process.env.DATABASE_PATH ?? "./.data/app.db";
mkdirSync(dirname(dbPath), { recursive: true });

const client = new Database(dbPath);
client.pragma("journal_mode = WAL");
const db = drizzle(client);
migrate(db, { migrationsFolder: "./drizzle" }); // idempotent, safe even pre-first-boot

const existing = db.select().from(rooms).where(eq(rooms.slug, slug)).get();

db.insert(rooms)
  .values({ slug, text })
  .onConflictDoUpdate({ target: rooms.slug, set: { text } })
  .run();

// A heat mark is a character span into this room's text --- if the text
// actually changed, every existing mark's offsets are now meaningless (or
// could even fall outside the new text), so they don't carry over.
if (existing && existing.text !== text) {
  db.delete(heatMarks).where(eq(heatMarks.roomSlug, slug)).run();
  console.log(`text changed --- cleared this room's existing heat marks`);
}

console.log(`seeded room "${slug}" (${text.length} chars) at ${dbPath}`);
