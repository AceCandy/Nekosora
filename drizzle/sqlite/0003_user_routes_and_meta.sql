CREATE TABLE `user_routes` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`user_id` text NOT NULL,
	`user_model_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`upstream_model_name` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`headers_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_model_id`) REFERENCES `user_models`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `user_providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_routes_model_idx` ON `user_routes` (`user_model_id`);--> statement-breakpoint
ALTER TABLE `user_models` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `user_models` ADD `vendor` text;--> statement-breakpoint
ALTER TABLE `user_models` ADD `system_prompt` text;--> statement-breakpoint
ALTER TABLE `user_models` ADD `description` text;--> statement-breakpoint
-- 数据补种:为每条尚未有路由的旧 user_models 用其遗留的 provider_id/upstream_model_name
-- 生成 1 条 user_routes(priority=0, weight=1, enabled=true)。
-- 幂等:NOT EXISTS 保证重复执行只补缺失路由的模型,不产生重复路由。
INSERT INTO `user_routes` (`id`, `user_id`, `user_model_id`, `provider_id`, `upstream_model_name`, `priority`, `weight`, `enabled`, `created_at`)
SELECT lower(hex(randomblob(16))), um.`user_id`, um.`id`, um.`provider_id`, um.`upstream_model_name`, 0, 1, 1, unixepoch()
FROM `user_models` um
WHERE NOT EXISTS (SELECT 1 FROM `user_routes` ur WHERE ur.`user_model_id` = um.`id`);