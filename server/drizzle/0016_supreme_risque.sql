ALTER TABLE `event_materials` ADD COLUMN `missing_reason` text CONSTRAINT "event_materials_missing_reason_check" CHECK("missing_reason" is null or "missing_reason" in ('confirmed', 'auto_expired'));
