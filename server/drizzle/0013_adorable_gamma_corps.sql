CREATE TABLE `inbox_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`prompt` text NOT NULL,
	`thread_id` integer,
	`subject_type` text,
	`subject_id` integer,
	`payload` text,
	`evidence` text,
	`priority` integer DEFAULT 50 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decision` text,
	`answer` text,
	`answered_by` text,
	`snoozed_until` text,
	`expires_at` text,
	`created_at` text DEFAULT (datetime('now')),
	`answered_at` text,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inbox_items_kind_check" CHECK("inbox_items"."kind" in ('outcome_check', 'deadline', 'watcher_due', 'event_candidate', 'thread_link')),
	CONSTRAINT "inbox_items_status_check" CHECK("inbox_items"."status" in ('pending', 'answered', 'dismissed', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_items_dedupe_idx` ON `inbox_items` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `observations` (
	`id` integer PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_ref` text,
	`app` text,
	`title` text,
	`body` text,
	`cwd` text,
	`occurred_at` text,
	`received_at` text DEFAULT (datetime('now')),
	`meta` text,
	`processed_at` text,
	CONSTRAINT "observations_source_check" CHECK("observations"."source" in ('claude_session', 'phone_notification', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observations_source_ref_idx` ON `observations` (`source`,`source_ref`);--> statement-breakpoint
CREATE TABLE `thread_workspaces` (
	`id` integer PRIMARY KEY NOT NULL,
	`thread_id` integer NOT NULL,
	`path` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_workspaces_path_idx` ON `thread_workspaces` (`path`);