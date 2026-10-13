PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_inbox_items` (
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
	CONSTRAINT "inbox_items_kind_check" CHECK("__new_inbox_items"."kind" in ('outcome_check', 'deadline', 'watcher_due', 'event_candidate', 'thread_link', 'person_profile')),
	CONSTRAINT "inbox_items_status_check" CHECK("__new_inbox_items"."status" in ('pending', 'answered', 'dismissed', 'expired'))
);
--> statement-breakpoint
INSERT INTO `__new_inbox_items`("id", "kind", "dedupe_key", "prompt", "thread_id", "subject_type", "subject_id", "payload", "evidence", "priority", "status", "decision", "answer", "answered_by", "snoozed_until", "expires_at", "created_at", "answered_at") SELECT "id", "kind", "dedupe_key", "prompt", "thread_id", "subject_type", "subject_id", "payload", "evidence", "priority", "status", "decision", "answer", "answered_by", "snoozed_until", "expires_at", "created_at", "answered_at" FROM `inbox_items`;--> statement-breakpoint
DROP TABLE `inbox_items`;--> statement-breakpoint
ALTER TABLE `__new_inbox_items` RENAME TO `inbox_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_items_dedupe_idx` ON `inbox_items` (`dedupe_key`);