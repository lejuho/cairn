CREATE TABLE `annotations` (
	`id` integer PRIMARY KEY NOT NULL,
	`event_id` integer,
	`outcome` text,
	`reason_tags` text,
	`reason_text` text,
	`energy_at_time` integer,
	`logged_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "annotations_outcome_check" CHECK("annotations"."outcome" in ('done', 'cancelled', 'moved', 'late')),
	CONSTRAINT "annotations_energy_at_time_check" CHECK("annotations"."energy_at_time" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE `event_people` (
	`event_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	PRIMARY KEY(`event_id`, `person_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY NOT NULL,
	`thread_id` integer,
	`title` text NOT NULL,
	`type` text,
	`start` text,
	`end` text,
	`location` text,
	`source` text,
	`self_imposed` integer DEFAULT 0,
	`status` text DEFAULT 'planned',
	`commitment` integer DEFAULT 2,
	`reversible` integer DEFAULT 1,
	`cancel_money` integer DEFAULT 0,
	`cancel_social` integer DEFAULT 0,
	`cancel_effort` text DEFAULT 'none',
	`cancel_window` text,
	`refund_cutoff` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "events_source_check" CHECK("events"."source" in ('gcal', 'manual', 'cairn')),
	CONSTRAINT "events_self_imposed_check" CHECK("events"."self_imposed" in (0, 1)),
	CONSTRAINT "events_status_check" CHECK("events"."status" in ('planned', 'confirmed', 'done', 'cancelled', 'moved', 'late')),
	CONSTRAINT "events_commitment_check" CHECK("events"."commitment" between 1 and 3),
	CONSTRAINT "events_reversible_check" CHECK("events"."reversible" in (0, 1)),
	CONSTRAINT "events_cancel_money_check" CHECK("events"."cancel_money" >= 0),
	CONSTRAINT "events_cancel_social_check" CHECK("events"."cancel_social" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE `links` (
	`id` integer PRIMARY KEY NOT NULL,
	`from_id` integer,
	`from_kind` text,
	`to_id` integer,
	`to_kind` text,
	`kind` text,
	`firmness` text DEFAULT 'soft',
	`source` text DEFAULT 'inferred',
	`created_at` text DEFAULT (datetime('now')),
	CONSTRAINT "links_from_kind_check" CHECK("links"."from_kind" in ('event', 'task')),
	CONSTRAINT "links_to_kind_check" CHECK("links"."to_kind" in ('event', 'task')),
	CONSTRAINT "links_kind_check" CHECK("links"."kind" in ('blocks', 'requires', 'triggers', 'caused_by', 'follows')),
	CONSTRAINT "links_firmness_check" CHECK("links"."firmness" in ('hard', 'soft', 'tentative')),
	CONSTRAINT "links_source_check" CHECK("links"."source" in ('given', 'authored', 'inferred')),
	CONSTRAINT "links_inferred_not_hard_check" CHECK(not ("links"."source" = 'inferred' and "links"."firmness" = 'hard'))
);
--> statement-breakpoint
CREATE TABLE `params` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`relation` text,
	`preferred_windows` text,
	`hard_constraints` text,
	`lead_time` text,
	`channel` text,
	`sensitivities` text,
	`total_meets` integer DEFAULT 0,
	`last_met` text
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY NOT NULL,
	`thread_id` integer,
	`title` text NOT NULL,
	`est_minutes` integer,
	`due` text,
	`context` text,
	`status` text DEFAULT 'todo',
	`optional` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tasks_status_check" CHECK("tasks"."status" in ('todo', 'doing', 'done', 'dropped')),
	CONSTRAINT "tasks_optional_check" CHECK("tasks"."optional" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `thread_links` (
	`id` integer PRIMARY KEY NOT NULL,
	`from_thread` integer,
	`to_thread` integer,
	`kind` text,
	`firmness` text DEFAULT 'soft',
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`from_thread`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_thread`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "thread_links_kind_check" CHECK("thread_links"."kind" in ('contains', 'blocks', 'feeds', 'competes', 'shares')),
	CONSTRAINT "thread_links_firmness_check" CHECK("thread_links"."firmness" in ('hard', 'soft'))
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text,
	`goal` text,
	`definition_of_done` text,
	`deadline` text,
	`status` text DEFAULT 'active',
	`created_at` text DEFAULT (datetime('now')),
	CONSTRAINT "threads_status_check" CHECK("threads"."status" in ('active', 'done', 'paused', 'dropped'))
);
--> statement-breakpoint
CREATE TABLE `watchers` (
	`id` integer PRIMARY KEY NOT NULL,
	`category` text,
	`label` text,
	`kind` text,
	`armed` integer DEFAULT 1,
	`rule` text,
	`threshold` text,
	`last_fired` text,
	`snoozed_until` text,
	`created_at` text DEFAULT (datetime('now')),
	CONSTRAINT "watchers_kind_check" CHECK("watchers"."kind" in ('A', 'B')),
	CONSTRAINT "watchers_armed_check" CHECK("watchers"."armed" in (0, 1))
);
