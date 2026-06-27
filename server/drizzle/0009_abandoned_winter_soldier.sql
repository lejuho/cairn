ALTER TABLE `threads` ADD COLUMN `domain` text NOT NULL DEFAULT 'personal' CHECK (`domain` in ('personal', 'work'));
