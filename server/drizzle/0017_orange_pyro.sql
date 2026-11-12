CREATE TABLE `note_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`note_id` integer NOT NULL,
	`text` text NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`done_at` text,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "note_items_done_check" CHECK("note_items"."done" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `note_items_note_idx` ON `note_items` (`note_id`);--> statement-breakpoint
CREATE TABLE `note_links` (
	`id` integer PRIMARY KEY NOT NULL,
	`note_id` integer NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "note_links_target_type_check" CHECK("note_links"."target_type" in ('event', 'task', 'thread'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_links_unique_idx` ON `note_links` (`note_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `note_links_target_idx` ON `note_links` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'note' NOT NULL,
	`title` text,
	`body` text,
	`note_date` text,
	`pinned` integer DEFAULT 0 NOT NULL,
	`added_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	CONSTRAINT "notes_kind_check" CHECK("notes"."kind" in ('note', 'checklist')),
	CONSTRAINT "notes_pinned_check" CHECK("notes"."pinned" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `notes_note_date_idx` ON `notes` (`note_date`);