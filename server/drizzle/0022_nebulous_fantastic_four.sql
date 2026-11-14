CREATE TABLE `agent_reason_messages` (
	`id` integer PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`sender` text NOT NULL,
	`sender_agent` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`received_at` text NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_reason_messages_message_idx` ON `agent_reason_messages` (`message_id`);