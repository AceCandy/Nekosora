-- 统一资源模型:合并六张镜像表(global/user × providers/models/routes)为三张统一表。
-- 保留旧 id,搬迁数据后 drop 旧表。key_model_bindings 收敛 scope+globalModelId+userModelId → 单 modelId。
-- owner 归属:global_* → admin 用户;user_* → 原 user_id。visibility:global_models→public,user_models→private。
-- 顺序:先建新表 + 搬数据 → drop 旧表 → rename 临时表 + 索引。

-- 1. 新建 providers(合并 global_providers + user_providers,无 visibility)
CREATE TABLE `providers` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`protocol` text NOT NULL,
	`base_url` text NOT NULL,
	`api_keys_enc` text NOT NULL,
	`key_strategy` text DEFAULT 'round_robin' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`connect_timeout_ms` integer,
	`read_timeout_ms` integer,
	`stream_idle_timeout_ms` integer,
	`headers_json` text,
	`last_health_checked_at` integer,
	`last_healthy_key_count` integer,
	`last_total_key_count` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `providers_owner_idx` ON `providers` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `providers_owner_name_idx` ON `providers` (`owner_user_id`,`name`);--> statement-breakpoint

-- 2. 新建 models(合并 global_models + user_models,有 visibility)
CREATE TABLE `models` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`owner_user_id` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`name` text NOT NULL,
	`display_name` text,
	`vendor` text,
	`icon` text,
	`capabilities` text DEFAULT '{}' NOT NULL,
	`system_prompt` text,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `models_owner_idx` ON `models` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `models_visibility_idx` ON `models` (`visibility`);--> statement-breakpoint
CREATE UNIQUE INDEX `models_owner_name_idx` ON `models` (`owner_user_id`,`name`);--> statement-breakpoint

-- 3. 新建 routes(合并 global_routes + user_routes,owner 跟随所属 model)
CREATE TABLE `routes` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`owner_user_id` text NOT NULL,
	`model_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`upstream_model_name` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`headers_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `routes_model_idx` ON `routes` (`model_id`);--> statement-breakpoint
CREATE INDEX `routes_owner_idx` ON `routes` (`owner_user_id`);--> statement-breakpoint

-- 4. 新建 key_model_bindings_new(临时表,收敛单 modelId;FK 内联,索引用临时名)
CREATE TABLE `key_model_bindings_new` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`key_id` text NOT NULL,
	`model_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `kmb_new_key_idx` ON `key_model_bindings_new` (`key_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kmb_new_unique_idx` ON `key_model_bindings_new` (`key_id`,`model_id`);--> statement-breakpoint

-- 5. 搬迁 providers(global → admin owner;user → 原 user_id,api_key_enc→api_keys_enc)
-- 注:sqlite 不支持 `INSERT INTO ... SELECT ... FROM t ON CONFLICT DO NOTHING`(FROM 后的 ON
-- 会被解析为 JOIN ON,语法歧义),改用等价的 `INSERT OR IGNORE INTO`(忽略 PK/唯一约束冲突)。
INSERT OR IGNORE INTO `providers` (`id`, `owner_user_id`, `name`, `protocol`, `base_url`, `api_keys_enc`, `key_strategy`, `enabled`, `priority`, `connect_timeout_ms`, `read_timeout_ms`, `stream_idle_timeout_ms`, `headers_json`, `last_health_checked_at`, `last_healthy_key_count`, `last_total_key_count`, `created_at`, `updated_at`)
SELECT `id`, (SELECT `id` FROM `user` WHERE `role` = 'admin' ORDER BY `created_at` LIMIT 1), `name`, `protocol`, `base_url`, `api_keys_enc`, `key_strategy`, `enabled`, `priority`, `connect_timeout_ms`, `read_timeout_ms`, `stream_idle_timeout_ms`, `headers_json`, `last_health_checked_at`, `last_healthy_key_count`, `last_total_key_count`, `created_at`, `updated_at`
FROM `global_providers`;--> statement-breakpoint
INSERT OR IGNORE INTO `providers` (`id`, `owner_user_id`, `name`, `protocol`, `base_url`, `api_keys_enc`, `enabled`, `last_health_checked_at`, `last_healthy_key_count`, `last_total_key_count`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, `name`, `protocol`, `base_url`, `api_key_enc`, `enabled`, `last_health_checked_at`, `last_healthy_key_count`, `last_total_key_count`, `created_at`, `updated_at`
FROM `user_providers`;--> statement-breakpoint

-- 6. 搬迁 models(global → public;user → private;丢弃 access_scope / 遗留列)
INSERT OR IGNORE INTO `models` (`id`, `owner_user_id`, `visibility`, `name`, `display_name`, `vendor`, `icon`, `capabilities`, `system_prompt`, `description`, `enabled`, `sort_order`, `created_at`, `updated_at`)
SELECT `id`, (SELECT `id` FROM `user` WHERE `role` = 'admin' ORDER BY `created_at` LIMIT 1), 'public', `name`, `display_name`, `vendor`, `icon`, `capabilities`, `system_prompt`, `description`, `enabled`, `sort_order`, `created_at`, `updated_at`
FROM `global_models`;--> statement-breakpoint
INSERT OR IGNORE INTO `models` (`id`, `owner_user_id`, `visibility`, `name`, `display_name`, `vendor`, `capabilities`, `system_prompt`, `description`, `enabled`, `sort_order`, `created_at`)
SELECT `id`, `user_id`, 'private', `name`, `display_name`, `vendor`, `capabilities`, `system_prompt`, `description`, `enabled`, `sort_order`, `created_at`
FROM `user_models`;--> statement-breakpoint

-- 7. 搬迁 routes(owner 从 models 查;user_routes.user_model_id → model_id)
INSERT OR IGNORE INTO `routes` (`id`, `owner_user_id`, `model_id`, `provider_id`, `upstream_model_name`, `priority`, `weight`, `enabled`, `headers_json`, `created_at`)
SELECT `id`, (SELECT m.`owner_user_id` FROM `models` m WHERE m.`id` = `global_routes`.`model_id`), `model_id`, `provider_id`, `upstream_model_name`, `priority`, `weight`, `enabled`, `headers_json`, `created_at`
FROM `global_routes`;--> statement-breakpoint
INSERT OR IGNORE INTO `routes` (`id`, `owner_user_id`, `model_id`, `provider_id`, `upstream_model_name`, `priority`, `weight`, `enabled`, `headers_json`, `created_at`)
SELECT `id`, (SELECT m.`owner_user_id` FROM `models` m WHERE m.`id` = `user_routes`.`user_model_id`), `user_model_id`, `provider_id`, `upstream_model_name`, `priority`, `weight`, `enabled`, `headers_json`, `created_at`
FROM `user_routes`;--> statement-breakpoint

-- 8. 搬迁 key_model_bindings(COALESCE(global_model_id, user_model_id) → model_id)
INSERT OR IGNORE INTO `key_model_bindings_new` (`id`, `key_id`, `model_id`, `created_at`)
SELECT `id`, `key_id`, COALESCE(`global_model_id`, `user_model_id`), `created_at`
FROM `key_model_bindings`;--> statement-breakpoint

-- 9. drop 旧表(顺序:先 drop 引用方,再 drop 被引用方)
DROP TABLE `key_model_bindings`;--> statement-breakpoint
DROP TABLE `global_routes`;--> statement-breakpoint
DROP TABLE `user_routes`;--> statement-breakpoint
DROP TABLE `global_models`;--> statement-breakpoint
DROP TABLE `user_models`;--> statement-breakpoint
DROP TABLE `global_providers`;--> statement-breakpoint
DROP TABLE `user_providers`;--> statement-breakpoint

-- 10. rename key_model_bindings_new → key_model_bindings + 重建索引(sqlite 无 ALTER INDEX RENAME)
ALTER TABLE `key_model_bindings_new` RENAME TO `key_model_bindings`;--> statement-breakpoint
DROP INDEX `kmb_new_key_idx`;--> statement-breakpoint
CREATE INDEX `key_model_bindings_key_idx` ON `key_model_bindings` (`key_id`);--> statement-breakpoint
DROP INDEX `kmb_new_unique_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `key_model_bindings_unique_idx` ON `key_model_bindings` (`key_id`,`model_id`);
