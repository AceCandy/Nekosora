CREATE TABLE `ops_error_logs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`request_id` text NOT NULL,
	`source` text NOT NULL,
	`user_id` text,
	`api_key_id` text,
	`key_kind` text,
	`model` text NOT NULL,
	`upstream_model` text,
	`provider_name` text,
	`provider_ref` text,
	`route_id` text,
	`route_name` text,
	`request_path` text,
	`stream` integer DEFAULT false NOT NULL,
	`http_status` integer,
	`error_code` text NOT NULL,
	`error_message` text,
	`error_phase` text,
	`error_type` text,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer,
	`first_token_latency_ms` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ops_error_logs_user_idx` ON `ops_error_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `ops_error_logs_created_idx` ON `ops_error_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `ops_error_logs_error_code_idx` ON `ops_error_logs` (`error_code`);--> statement-breakpoint
CREATE INDEX `ops_error_logs_http_status_idx` ON `ops_error_logs` (`http_status`);--> statement-breakpoint
CREATE INDEX `ops_error_logs_provider_ref_idx` ON `ops_error_logs` (`provider_ref`);--> statement-breakpoint
CREATE INDEX `ops_error_logs_source_idx` ON `ops_error_logs` (`source`);--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `first_token_latency_ms` integer;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `provider_name` text;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `route_id` text;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `route_name` text;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `upstream_model` text;