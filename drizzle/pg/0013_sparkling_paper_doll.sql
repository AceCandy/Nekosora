CREATE TABLE "model_catalog" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"canonical_model_id" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_type" text NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"context_window" integer,
	"max_output_tokens" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "name", "canonical_model_id", "aliases", "model_type", "capabilities", "sort_order") VALUES
('catalog-chat-generic', '通用对话模型', '__generic_chat__', '[]'::jsonb, 'chat', '{"systemPrompt":true}'::jsonb, 1000),
('catalog-image-generic', '通用绘图模型', '__generic_image__', '[]'::jsonb, 'image', '{"imageGeneration":true}'::jsonb, 1001),
('catalog-embedding-generic', '通用嵌入模型', '__generic_embedding__', '[]'::jsonb, 'embedding', '{}'::jsonb, 1002),
('catalog-rerank-generic', '通用重排模型', '__generic_rerank__', '[]'::jsonb, 'rerank', '{}'::jsonb, 1003),
('catalog-audio-generic', '通用音频模型', '__generic_audio__', '[]'::jsonb, 'audio', '{}'::jsonb, 1004),
('catalog-glm-5-2', 'GLM 5.2', 'glm-5.2', '["zai/glm-5.2","zhipu/glm-5.2","volcengine/glm-5.2"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 10);
--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "catalog_id" text;--> statement-breakpoint
UPDATE "models" AS "model"
SET "catalog_id" = COALESCE(
	(
		SELECT "catalog"."id"
		FROM "model_catalog" AS "catalog"
		WHERE lower("catalog"."canonical_model_id") = lower("model"."name")
			OR "catalog"."aliases" ? "model"."name"
		ORDER BY "catalog"."sort_order", "catalog"."id"
		LIMIT 1
	),
	CASE
		WHEN "model"."capabilities" ->> 'imageGeneration' = 'true' THEN 'catalog-image-generic'
		ELSE 'catalog-chat-generic'
	END
);--> statement-breakpoint
ALTER TABLE "models" ALTER COLUMN "catalog_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "model_catalog_canonical_model_id_unique_idx" ON "model_catalog" USING btree ("canonical_model_id");--> statement-breakpoint
CREATE INDEX "model_catalog_enabled_sort_idx" ON "model_catalog" USING btree ("enabled","sort_order");--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_catalog_id_model_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."model_catalog"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "models_catalog_idx" ON "models" USING btree ("catalog_id");--> statement-breakpoint
ALTER TABLE "models" DROP COLUMN "vendor";--> statement-breakpoint
ALTER TABLE "models" DROP COLUMN "capabilities";
