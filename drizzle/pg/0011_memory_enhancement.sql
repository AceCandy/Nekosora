ALTER TABLE "user_memories" ADD COLUMN "disclosure" text;--> statement-breakpoint
ALTER TABLE "user_memories" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories" ADD COLUMN "last_accessed_at" timestamp with time zone;--> statement-breakpoint
-- 数据迁移:scope 值域 custom → project(design §1)
UPDATE "user_memories" SET "scope" = 'project' WHERE "scope" = 'custom';--> statement-breakpoint
-- 回填默认 priority:scope 映射 preference=0/profile=1/project=2
UPDATE "user_memories" SET "priority" = CASE "scope" WHEN 'preference' THEN 0 WHEN 'profile' THEN 1 ELSE 2 END;--> statement-breakpoint
-- 回填 last_accessed_at:用 created_at 兜底(旧记忆无访问记录)
UPDATE "user_memories" SET "last_accessed_at" = "created_at" WHERE "last_accessed_at" IS NULL;--> statement-breakpoint
-- 旧 embedding 清空重建:融合向量改变 embedding 语义(design §1.1),旧记忆靠关键词兜底,新抽取渐进恢复
UPDATE "user_memories" SET "embedding" = NULL, "disclosure" = NULL;