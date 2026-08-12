CREATE TYPE "public"."route_api_format" AS ENUM('openai-chat', 'openai-responses', 'anthropic-messages', 'gemini-generate-content', 'openai-images', 'openai-audio-stt', 'openai-audio-tts');--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "api_format" "route_api_format";--> statement-breakpoint
UPDATE "routes" AS r
SET "api_format" = (
  CASE p."protocol"::text
    WHEN 'openai' THEN 'openai-chat'
    WHEN 'openai-compatible' THEN 'openai-chat'
    WHEN 'anthropic' THEN 'anthropic-messages'
    WHEN 'gemini' THEN 'gemini-generate-content'
    WHEN 'openai-images' THEN 'openai-images'
    WHEN 'openai-audio-stt' THEN 'openai-audio-stt'
    WHEN 'openai-audio-tts' THEN 'openai-audio-tts'
  END
)::"route_api_format"
FROM "providers" AS p
WHERE r."provider_id" = p."id";--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "routes" WHERE "api_format" IS NULL) THEN
    RAISE EXCEPTION 'routes.api_format backfill incomplete';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "routes" ALTER COLUMN "api_format" SET NOT NULL;
