DROP TABLE "knowledge_bases" CASCADE;--> statement-breakpoint
DROP TABLE "prompt_templates" CASCADE;--> statement-breakpoint
ALTER TABLE "file_objects" DROP COLUMN "knowledge_base_id";--> statement-breakpoint
UPDATE "conversations"
SET "composer_state" = "composer_state" - 'kbIds'
WHERE "composer_state" ? 'kbIds';
