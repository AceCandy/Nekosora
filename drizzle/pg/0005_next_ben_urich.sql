-- 维度从 1536 迁移到 1024(切换到 bge-m3);旧向量维度不兼容,清空后由后续写入重建。
-- file_chunks:文件需重新处理(processFile)以生成 1024 维向量;
-- user_memories:记忆内容保留,向量清空,召回在下次抽取/编辑时重建。
UPDATE "file_chunks" SET "embedding" = NULL;--> statement-breakpoint
UPDATE "user_memories" SET "embedding" = NULL;--> statement-breakpoint
ALTER TABLE "file_chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);--> statement-breakpoint
ALTER TABLE "user_memories" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);