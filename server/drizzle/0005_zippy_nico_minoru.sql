ALTER TABLE `threads` ADD COLUMN `resume_relevant` integer DEFAULT 0 CONSTRAINT `threads_resume_relevant_check` CHECK (`resume_relevant` in (0, 1));--> statement-breakpoint
ALTER TABLE `threads` ADD COLUMN `star_situation` text;--> statement-breakpoint
ALTER TABLE `threads` ADD COLUMN `star_action` text;--> statement-breakpoint
ALTER TABLE `threads` ADD COLUMN `star_result` text;--> statement-breakpoint
ALTER TABLE `threads` ADD COLUMN `skills_tags` text;
