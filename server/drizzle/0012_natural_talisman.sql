CREATE TABLE `pinned_transit_facts` (
	`id` integer PRIMARY KEY NOT NULL,
	`origin_normalized` text NOT NULL,
	`dest_normalized` text NOT NULL,
	`origin_label` text,
	`dest_label` text,
	`origin_lat` real NOT NULL,
	`origin_lng` real NOT NULL,
	`dest_lat` real NOT NULL,
	`dest_lng` real NOT NULL,
	`mode` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`note` text,
	`source` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text,
	`last_confirmed_at` text,
	CONSTRAINT "pinned_transit_facts_mode_check" CHECK("pinned_transit_facts"."mode" in ('public_transit')),
	CONSTRAINT "pinned_transit_facts_source_check" CHECK("pinned_transit_facts"."source" in ('pinned_user')),
	CONSTRAINT "pinned_transit_facts_active_check" CHECK("pinned_transit_facts"."active" in (0, 1)),
	CONSTRAINT "pinned_transit_facts_duration_check" CHECK("pinned_transit_facts"."duration_minutes" > 0 and "pinned_transit_facts"."duration_minutes" <= 600)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pinned_transit_facts_pair_idx` ON `pinned_transit_facts` (`origin_normalized`,`dest_normalized`,`mode`);