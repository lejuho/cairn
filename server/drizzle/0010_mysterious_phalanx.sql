CREATE TABLE `geocode_cache` (
	`id` integer PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`normalized_location` text NOT NULL,
	`location_text` text NOT NULL,
	`status` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`display_label` text,
	`provider_result_id` text,
	`confidence` text NOT NULL,
	`provider_status` text,
	`uncertainty_json` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text,
	`last_checked_at` text,
	CONSTRAINT "geocode_cache_status_check" CHECK("geocode_cache"."status" in ('resolved', 'ambiguous', 'zero_results', 'failed')),
	CONSTRAINT "geocode_cache_confidence_check" CHECK("geocode_cache"."confidence" in ('high', 'medium', 'low', 'unknown')),
	CONSTRAINT "geocode_cache_coords_check" CHECK(("geocode_cache"."latitude" is null) = ("geocode_cache"."longitude" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `geocode_cache_provider_location_idx` ON `geocode_cache` (`provider`,`normalized_location`);