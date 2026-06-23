CREATE TABLE `watcher_logs` (
	`id` integer PRIMARY KEY NOT NULL,
	`watcher_id` integer,
	`outcome` text,
	`observed_at` text,
	`note` text,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`watcher_id`) REFERENCES `watchers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "watcher_logs_outcome_check" CHECK("watcher_logs"."outcome" in ('checked_no_signal', 'signal_seen', 'missed_signal'))
);
