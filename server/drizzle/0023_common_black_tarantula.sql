CREATE TABLE `agent_sheets` (
	`id` integer PRIMARY KEY NOT NULL,
	`spreadsheet_id` text NOT NULL,
	`name` text NOT NULL,
	`added_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_sheets_spreadsheet_idx` ON `agent_sheets` (`spreadsheet_id`);