ALTER TABLE `rooms` ADD `custom_title` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `max_size` integer;--> statement-breakpoint
ALTER TABLE `rooms` ADD `creator_user_id` integer REFERENCES users(id);