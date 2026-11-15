CREATE TABLE `files` (
	`id` integer PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_sha256_idx` ON `files` (`sha256`);--> statement-breakpoint
CREATE TABLE `note_attachments` (
	`id` integer PRIMARY KEY NOT NULL,
	`note_id` integer NOT NULL,
	`kind` text NOT NULL,
	`file_id` integer,
	`url` text,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "note_attachments_kind_check" CHECK("note_attachments"."kind" in ('file', 'link'))
);
--> statement-breakpoint
CREATE INDEX `note_attachments_note_idx` ON `note_attachments` (`note_id`);--> statement-breakpoint
CREATE INDEX `note_attachments_file_idx` ON `note_attachments` (`file_id`);