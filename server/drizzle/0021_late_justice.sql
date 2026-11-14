CREATE TABLE `agent_artifacts` (
	`id` integer PRIMARY KEY NOT NULL,
	`conversation_id` integer NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`label` text NOT NULL,
	`last_action` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "agent_artifacts_target_type_check" CHECK("agent_artifacts"."target_type" in ('event', 'task', 'thread', 'note'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_artifacts_unique_idx` ON `agent_artifacts` (`conversation_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `agent_conversations` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`provider` text NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_messages` (
	`id` integer PRIMARY KEY NOT NULL,
	`conversation_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "agent_messages_role_check" CHECK("agent_messages"."role" in ('user', 'agent', 'error'))
);
--> statement-breakpoint
CREATE INDEX `agent_messages_conversation_idx` ON `agent_messages` (`conversation_id`);