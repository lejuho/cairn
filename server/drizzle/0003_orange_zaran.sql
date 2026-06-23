CREATE TABLE `resource_links` (
	`id` integer PRIMARY KEY NOT NULL,
	`resource_id` integer NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`firmness` text DEFAULT 'soft' NOT NULL,
	`reason` text,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "resource_links_target_type_check" CHECK("resource_links"."target_type" in ('event', 'task', 'thread')),
	CONSTRAINT "resource_links_firmness_check" CHECK("resource_links"."firmness" in ('hard', 'soft', 'tentative'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_links_unique_idx` ON `resource_links` (`resource_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `resources` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`source_person_id` integer,
	`note` text,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`source_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "resources_kind_check" CHECK("resources"."kind" in ('item', 'knowledge'))
);
