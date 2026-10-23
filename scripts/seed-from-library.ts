#!/usr/bin/env node
// Rooms are only ever created by hand, via this script:
//   node scripts/seed-from-library.ts <text-slug>
//
// Every room is an instance of a specific text in scripts/library/manifest.json
// (its title, author, kind, source note and description all come from there)
// --- there's no more "seed arbitrary text file" path, since every room's
// metadata columns are NOT NULL and a library entry is the only thing that
// supplies them. Run it once per room you want: a second run for the same
// text-slug makes a SEPARATE room, numbered the next instance for that work
// ("Macbeth #0001", then "Macbeth #0002", ...), not an update to the first.
//
// This doesn't import src/lib/db.ts: that file is only ever imported through
// Astro's Vite bundler, which resolves its extensionless `./schema` import;
// run directly by plain Node (as this script is, per tsconfig's
// allowImportingTsExtensions comment) that import would fail, and db.ts's
// own migrate()-at-import-time would also redundantly re-run. So this script
// sets up its own tiny connection instead, duplicating db.ts's ~6 lines of
// boilerplate once, deliberately.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { desc, eq } from "drizzle-orm";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { rooms } from "../src/lib/schema.ts";

interface LibraryEntry {
  file: string;
  slug: string;
  title: string;
  author: string;
  kind: "poem" | "play" | "book";
  sourceNote: string;
  description: string;
}

const LIBRARY_DIR = join(import.meta.dirname, "library");

const [, , textSlug] = process.argv;
if (!textSlug) {
  const manifest: LibraryEntry[] = JSON.parse(readFileSync(join(LIBRARY_DIR, "manifest.json"), "utf8"));
  console.error("usage: node scripts/seed-from-library.ts <text-slug>");
  console.error("\navailable text-slugs:");
  for (const entry of manifest) console.error(`  ${entry.slug} --- ${entry.title}, ${entry.author}`);
  process.exit(1);
}

const manifest: LibraryEntry[] = JSON.parse(readFileSync(join(LIBRARY_DIR, "manifest.json"), "utf8"));
const entry = manifest.find((e) => e.slug === textSlug);
if (!entry) {
  console.error(`no library entry with slug "${textSlug}" (see manifest.json for valid slugs)`);
  process.exit(1);
}

const text = readFileSync(join(LIBRARY_DIR, "texts", entry.file), "utf8").trimEnd();

const dbPath = process.env.DATABASE_PATH ?? "./.data/app.db";
mkdirSync(dirname(dbPath), { recursive: true });

const client = new Database(dbPath);
client.pragma("journal_mode = WAL");
const db = drizzle(client);
migrate(db, { migrationsFolder: "./drizzle" }); // idempotent, safe even pre-first-boot

const latest = db
  .select({ instance: rooms.instance })
  .from(rooms)
  .where(eq(rooms.textSlug, textSlug))
  .orderBy(desc(rooms.instance))
  .limit(1)
  .get();
const instance = (latest?.instance ?? 0) + 1;
const slug = `${textSlug}-${String(instance).padStart(4, "0")}`;

db.insert(rooms)
  .values({
    slug,
    text,
    textSlug,
    instance,
    title: entry.title,
    author: entry.author,
    kind: entry.kind,
    sourceNote: entry.sourceNote,
    description: entry.description,
  })
  .run();

console.log(`seeded room "${slug}" --- ${entry.title} #${String(instance).padStart(4, "0")} (${text.length} chars) at ${dbPath}`);
