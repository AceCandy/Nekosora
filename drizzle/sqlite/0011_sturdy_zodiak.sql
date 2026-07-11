CREATE TABLE `model_catalog` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`name` text NOT NULL,
	`canonical_model_id` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`model_type` text NOT NULL,
	`capabilities` text DEFAULT '{}' NOT NULL,
	`default_params` text DEFAULT '{}' NOT NULL,
	`context_window` integer,
	`max_output_tokens` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `model_catalog` (`id`, `name`, `canonical_model_id`, `aliases`, `model_type`, `capabilities`, `sort_order`) VALUES
('catalog-chat-generic', '通用对话模型', '__generic_chat__', '[]', 'chat', '{"systemPrompt":true}', 1000),
('catalog-image-generic', '通用绘图模型', '__generic_image__', '[]', 'image', '{"imageGeneration":true}', 1001),
('catalog-embedding-generic', '通用嵌入模型', '__generic_embedding__', '[]', 'embedding', '{}', 1002),
('catalog-rerank-generic', '通用重排模型', '__generic_rerank__', '[]', 'rerank', '{}', 1003),
('catalog-audio-generic', '通用音频模型', '__generic_audio__', '[]', 'audio', '{}', 1004),
('catalog-glm-5-2', 'GLM 5.2', 'glm-5.2', '["zai/glm-5.2","zhipu/glm-5.2","volcengine/glm-5.2"]', 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}', 10);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_catalog_canonical_model_id_unique_idx` ON `model_catalog` (`canonical_model_id`);--> statement-breakpoint
CREATE INDEX `model_catalog_enabled_sort_idx` ON `model_catalog` (`enabled`,`sort_order`);--> statement-breakpoint
ALTER TABLE `models` ADD `catalog_id` text NOT NULL REFERENCES model_catalog(id);--> statement-breakpoint
CREATE INDEX `models_catalog_idx` ON `models` (`catalog_id`);--> statement-breakpoint
ALTER TABLE `models` DROP COLUMN `vendor`;--> statement-breakpoint
ALTER TABLE `models` DROP COLUMN `capabilities`;
