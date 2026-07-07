CREATE TABLE "user_routes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"user_model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"upstream_model_name" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"headers_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_models" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "user_models" ADD COLUMN "vendor" text;--> statement-breakpoint
ALTER TABLE "user_models" ADD COLUMN "system_prompt" text;--> statement-breakpoint
ALTER TABLE "user_models" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "user_routes" ADD CONSTRAINT "user_routes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_routes" ADD CONSTRAINT "user_routes_user_model_id_user_models_id_fk" FOREIGN KEY ("user_model_id") REFERENCES "public"."user_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_routes" ADD CONSTRAINT "user_routes_provider_id_user_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."user_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_routes_model_idx" ON "user_routes" USING btree ("user_model_id");--> statement-breakpoint
-- 数据补种:为每条尚未有路由的旧 user_models 用其遗留的 provider_id/upstream_model_name
-- 生成 1 条 user_routes(priority=0, weight=1, enabled=true)。
-- 幂等:NOT EXISTS 保证重复执行只补缺失路由的模型,不产生重复路由。
INSERT INTO "user_routes" ("id", "user_id", "user_model_id", "provider_id", "upstream_model_name", "priority", "weight", "enabled", "created_at")
SELECT gen_random_uuid(), um."user_id", um."id", um."provider_id", um."upstream_model_name", 0, 1, true, now()
FROM "user_models" um
WHERE NOT EXISTS (SELECT 1 FROM "user_routes" ur WHERE ur."user_model_id" = um."id");