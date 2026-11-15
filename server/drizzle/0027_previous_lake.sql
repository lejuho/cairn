PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_note_links` (
	`id` integer PRIMARY KEY NOT NULL,
	`note_id` integer NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "note_links_target_type_check" CHECK("target_type" in ('event', 'task', 'thread', 'person'))
);
--> statement-breakpoint
INSERT INTO `__new_note_links`("id", "note_id", "target_type", "target_id", "created_at") SELECT "id", "note_id", "target_type", "target_id", "created_at" FROM `note_links`;--> statement-breakpoint
DROP TABLE `note_links`;--> statement-breakpoint
ALTER TABLE `__new_note_links` RENAME TO `note_links`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `note_links_unique_idx` ON `note_links` (`note_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `note_links_target_idx` ON `note_links` (`target_type`,`target_id`);