ALTER TABLE `events` ADD `external_calendar_id` text;--> statement-breakpoint
ALTER TABLE `events` ADD `external_event_id` text;--> statement-breakpoint
ALTER TABLE `events` ADD `external_ical_uid` text;--> statement-breakpoint
ALTER TABLE `events` ADD `external_etag` text;--> statement-breakpoint
ALTER TABLE `events` ADD `external_updated` text;--> statement-breakpoint
CREATE UNIQUE INDEX `events_external_identity_idx` ON `events` (`external_calendar_id`,`external_event_id`);