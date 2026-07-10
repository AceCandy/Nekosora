-- 统一资源模型:合并六张镜像表(global/user × providers/models/routes)为三张统一表。
-- 保留旧 id,搬迁数据后 drop 旧表。key_model_bindings 收敛 scope+globalModelId+userModelId → 单 modelId。
-- owner 归属:global_* → admin 用户;user_* → 原 user_id。visibility:global_models→public,user_models→private。
-- 顺序:先建新表 + 搬数据 → drop 旧表/旧 enum → rename 临时表。

-- 1. 新建 model_visibility enum
CREATE TYPE "public"."model_visibility" AS ENUM('public', 'private');--> statement-breakpoint

-- 2. 新建 providers(合并 global_providers + user_providers,无 visibility)
CREATE TABLE "providers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"protocol" "provider_protocol" NOT NULL,
	"base_url" text NOT NULL,
	"api_keys_enc" text NOT NULL,
	"key_strategy" text DEFAULT 'round_robin' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"connect_timeout_ms" integer,
	"read_timeout_ms" integer,
	"stream_idle_timeout_ms" integer,
	"headers_json" jsonb,
	"last_health_checked_at" timestamp with time zone,
	"last_healthy_key_count" integer,
	"last_total_key_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "providers_owner_idx" ON "providers" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_owner_name_idx" ON "providers" USING btree ("owner_user_id","name");--> statement-breakpoint

-- 3. 新建 models(合并 global_models + user_models,有 visibility)
CREATE TABLE "models" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"visibility" "model_visibility" DEFAULT 'private' NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"vendor" text,
	"icon" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"system_prompt" text,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "models_owner_idx" ON "models" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "models_visibility_idx" ON "models" USING btree ("visibility");--> statement-breakpoint
CREATE UNIQUE INDEX "models_owner_name_idx" ON "models" USING btree ("owner_user_id","name");--> statement-breakpoint

-- 4. 新建 routes(合并 global_routes + user_routes,owner 跟随所属 model)
CREATE TABLE "routes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"upstream_model_name" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"headers_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "routes_model_idx" ON "routes" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "routes_owner_idx" ON "routes" USING btree ("owner_user_id");--> statement-breakpoint

-- 5. 新建 key_model_bindings_new(临时表,收敛单 modelId;FK + 索引 rename 后补)
CREATE TABLE "key_model_bindings_new" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_id" text NOT NULL,
	"model_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "kmb_new_key_idx" ON "key_model_bindings_new" USING btree ("key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kmb_new_unique_idx" ON "key_model_bindings_new" USING btree ("key_id","model_id");--> statement-breakpoint

-- 6. 搬迁 providers(global → admin owner;user → 原 user_id,api_key_enc→api_keys_enc)
INSERT INTO "providers" ("id", "owner_user_id", "name", "protocol", "base_url", "api_keys_enc", "key_strategy", "enabled", "priority", "connect_timeout_ms", "read_timeout_ms", "stream_idle_timeout_ms", "headers_json", "last_health_checked_at", "last_healthy_key_count", "last_total_key_count", "created_at", "updated_at")
SELECT "id", (SELECT "id" FROM "user" WHERE "role" = 'admin' ORDER BY "created_at" LIMIT 1), "name", "protocol", "base_url", "api_keys_enc", "key_strategy", "enabled", "priority", "connect_timeout_ms", "read_timeout_ms", "stream_idle_timeout_ms", "headers_json", "last_health_checked_at", "last_healthy_key_count", "last_total_key_count", "created_at", "updated_at"
FROM "global_providers"
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
INSERT INTO "providers" ("id", "owner_user_id", "name", "protocol", "base_url", "api_keys_enc", "enabled", "last_health_checked_at", "last_healthy_key_count", "last_total_key_count", "created_at", "updated_at")
SELECT "id", "user_id", "name", "protocol", "base_url", "api_key_enc", "enabled", "last_health_checked_at", "last_healthy_key_count", "last_total_key_count", "created_at", "updated_at"
FROM "user_providers"
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint

-- 7. 搬迁 models(global → public;user → private;丢弃 access_scope / 遗留列)
INSERT INTO "models" ("id", "owner_user_id", "visibility", "name", "display_name", "vendor", "icon", "capabilities", "system_prompt", "description", "enabled", "sort_order", "created_at", "updated_at")
SELECT "id", (SELECT "id" FROM "user" WHERE "role" = 'admin' ORDER BY "created_at" LIMIT 1), 'public', "name", "display_name", "vendor", "icon", "capabilities", "system_prompt", "description", "enabled", "sort_order", "created_at", "updated_at"
FROM "global_models"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "models" ("id", "owner_user_id", "visibility", "name", "display_name", "vendor", "capabilities", "system_prompt", "description", "enabled", "sort_order", "created_at")
SELECT "id", "user_id", 'private', "name", "display_name", "vendor", "capabilities", "system_prompt", "description", "enabled", "sort_order", "created_at"
FROM "user_models"
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 8. 搬迁 routes(owner 从 models 查;user_routes.user_model_id → model_id)
INSERT INTO "routes" ("id", "owner_user_id", "model_id", "provider_id", "upstream_model_name", "priority", "weight", "enabled", "headers_json", "created_at")
SELECT "id", (SELECT m."owner_user_id" FROM "models" m WHERE m."id" = "global_routes"."model_id"), "model_id", "provider_id", "upstream_model_name", "priority", "weight", "enabled", "headers_json", "created_at"
FROM "global_routes"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "routes" ("id", "owner_user_id", "model_id", "provider_id", "upstream_model_name", "priority", "weight", "enabled", "headers_json", "created_at")
SELECT "id", (SELECT m."owner_user_id" FROM "models" m WHERE m."id" = "user_routes"."user_model_id"), "user_model_id", "provider_id", "upstream_model_name", "priority", "weight", "enabled", "headers_json", "created_at"
FROM "user_routes"
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 9. 搬迁 key_model_bindings(COALESCE(global_model_id, user_model_id) → model_id)
INSERT INTO "key_model_bindings_new" ("id", "key_id", "model_id", "created_at")
SELECT "id", "key_id", COALESCE("global_model_id", "user_model_id"), "created_at"
FROM "key_model_bindings"
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 10. drop 旧表(顺序:先 drop 引用方,再 drop 被引用方)
DROP TABLE "key_model_bindings";--> statement-breakpoint
DROP TABLE "global_routes";--> statement-breakpoint
DROP TABLE "user_routes";--> statement-breakpoint
DROP TABLE "global_models";--> statement-breakpoint
DROP TABLE "user_models";--> statement-breakpoint
DROP TABLE "global_providers";--> statement-breakpoint
DROP TABLE "user_providers";--> statement-breakpoint

-- 11. drop 旧 enum
DROP TYPE "public"."access_scope";--> statement-breakpoint
DROP TYPE "public"."binding_scope";--> statement-breakpoint

-- 12. rename key_model_bindings_new → key_model_bindings + 补 FK + rename 索引
ALTER TABLE "key_model_bindings_new" RENAME TO "key_model_bindings";--> statement-breakpoint
ALTER INDEX "kmb_new_key_idx" RENAME TO "key_model_bindings_key_idx";--> statement-breakpoint
ALTER INDEX "kmb_new_unique_idx" RENAME TO "key_model_bindings_unique_idx";--> statement-breakpoint
ALTER TABLE "key_model_bindings" ADD CONSTRAINT "key_model_bindings_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_model_bindings" ADD CONSTRAINT "key_model_bindings_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;
