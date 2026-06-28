CREATE TABLE `travel_time_cache` (
	`id` integer PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`mode` text NOT NULL,
	`origin_normalized` text NOT NULL,
	`dest_normalized` text NOT NULL,
	`origin_lat` real NOT NULL,
	`origin_lng` real NOT NULL,
	`dest_lat` real NOT NULL,
	`dest_lng` real NOT NULL,
	`duration_seconds` integer,
	`duration_minutes` real,
	`distance_meters` real,
	`status` text NOT NULL,
	`provider_status` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text,
	`last_checked_at` text,
	CONSTRAINT "travel_time_cache_status_check" CHECK("travel_time_cache"."status" in ('resolved', 'no_route')),
	CONSTRAINT "travel_time_cache_duration_check" CHECK(("travel_time_cache"."status" = 'no_route') or ("travel_time_cache"."duration_seconds" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `travel_time_cache_pair_idx` ON `travel_time_cache` (`provider`,`mode`,`origin_normalized`,`dest_normalized`);