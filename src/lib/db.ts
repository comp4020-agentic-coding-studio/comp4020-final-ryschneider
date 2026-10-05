import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { type HeatMark, type Room, heatMarks, rooms } from "./schema";

// One SQLite file is the app's whole persistent state. In production
// fly.toml points DATABASE_PATH at the machine's volume (/data), which is
// how state survives a reload and a redeploy; locally it defaults to an
// untracked file in .data/.
const path = process.env.DATABASE_PATH ?? "./.data/app.db";
mkdirSync(dirname(path), { recursive: true });

const client = new Database(path);
client.pragma("journal_mode = WAL");

export const db = drizzle(client);

// Migrations run at boot, on whatever machine holds the volume --- the
// recommended shape for SQLite on Fly, where there's no separate machine to
// run them from. The flow: edit src/lib/schema.ts, `pnpm db:generate`,
// commit the migration it writes to drizzle/.
migrate(db, { migrationsFolder: "./drizzle" });

export type { Room, HeatMark };

export function getRoom(slug: string): Room | undefined {
  return db.select().from(rooms).where(eq(rooms.slug, slug)).get();
}

export function listRooms(): Room[] {
  return db.select().from(rooms).orderBy(asc(rooms.createdAt)).all();
}

export function listHeatMarks(slug: string): HeatMark[] {
  return db
    .select()
    .from(heatMarks)
    .where(eq(heatMarks.roomSlug, slug))
    .orderBy(asc(heatMarks.id))
    .all();
}

export function addHeatMark(slug: string, start: number, end: number): HeatMark {
  return db
    .insert(heatMarks)
    .values({ roomSlug: slug, startOffset: start, endOffset: end })
    .returning()
    .get();
}
