PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_models` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`user_id` text NOT NULL,
	`provider_id` text,
	`name` text NOT NULL,
	`upstream_model_name` text,
	`capabilities` text DEFAULT '{}' NOT NULL,
	`display_name` text,
	`vendor` text,
	`system_prompt` text,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `user_providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_models`("id", "user_id", "provider_id", "name", "upstream_model_name", "capabilities", "display_name", "vendor", "system_prompt", "description", "enabled", "created_at") SELECT "id", "user_id", "provider_id", "name", "upstream_model_name", "capabilities", "display_name", "vendor", "system_prompt", "description", "enabled", "created_at" FROM `user_models`;--> statement-breakpoint
DROP TABLE `user_models`;--> statement-breakpoint
ALTER TABLE `__new_user_models` RENAME TO `user_models`;--> statement-breakpoint
PRAGMA foreign_keys=ON;