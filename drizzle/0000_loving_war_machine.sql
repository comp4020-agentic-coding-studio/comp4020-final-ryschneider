CREATE TABLE `heat_marks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_slug` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`room_slug`) REFERENCES `rooms`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`slug` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
