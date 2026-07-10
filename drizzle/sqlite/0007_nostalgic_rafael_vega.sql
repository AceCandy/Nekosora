ALTER TABLE `ops_error_logs` ADD `task_kind` text;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `task_kind` text;--> statement-breakpoint
ALTER TABLE `user_models` ADD `sort_order` integer DEFAULT 0 NOT NULL;