-- Every room is now an instance of a library text, with metadata columns
-- that are NOT NULL and have no default --- which SQLite's ALTER TABLE ADD
-- COLUMN refuses outright on a non-empty table. The only room that can
-- exist before this migration is the old single ad-hoc "demo" room seeded
-- by the retired scripts/seed-room.ts; it predates the library entirely and
-- has no textSlug/instance/title/etc. to backfill, so rather than invent
-- placeholder values for columns meant to be real metadata, this migration
-- clears the table --- the library's own seeding script
-- (scripts/seed-from-library.ts) repopulates it with real rooms afterward.
-- Existing heat_marks reference rooms by slug, so they go too; a heat mark
-- is nothing without the room (and text offsets) it was measured against.
DELETE FROM `heat_marks`;--> statement-breakpoint
DELETE FROM `rooms`;--> statement-breakpoint
ALTER TABLE `rooms` ADD `text_slug` text NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `instance` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `title` text NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `author` text NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `kind` text NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `source_note` text NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `description` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_text_slug_instance_idx` ON `rooms` (`text_slug`,`instance`);