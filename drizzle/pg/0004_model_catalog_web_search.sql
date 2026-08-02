-- 原生搜索能力只标记已核验的官方请求语义和当前主流型号。
UPDATE "model_catalog"
SET
  "capabilities" = "capabilities" || '{"webSearchFormat":"openai"}'::jsonb,
  "updated_at" = now()
WHERE "model_type" = 'chat'
  AND "canonical_model_id" IN ('gpt-5.5', 'gpt-5.5-pro', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra')
  AND "capabilities" IS DISTINCT FROM "capabilities" || '{"webSearchFormat":"openai"}'::jsonb;
--> statement-breakpoint
UPDATE "model_catalog"
SET
  "capabilities" = "capabilities" || '{"webSearchFormat":"anthropic"}'::jsonb,
  "updated_at" = now()
WHERE "model_type" = 'chat'
  AND "canonical_model_id" IN ('claude-opus-5', 'claude-sonnet-5')
  AND "capabilities" IS DISTINCT FROM "capabilities" || '{"webSearchFormat":"anthropic"}'::jsonb;
--> statement-breakpoint
UPDATE "model_catalog"
SET
  "capabilities" = "capabilities" || '{"webSearchFormat":"google"}'::jsonb,
  "updated_at" = now()
WHERE "model_type" = 'chat'
  AND "canonical_model_id" IN (
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-3.1-pro-preview',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash'
  )
  AND "capabilities" IS DISTINCT FROM "capabilities" || '{"webSearchFormat":"google"}'::jsonb;
--> statement-breakpoint
UPDATE "model_catalog"
SET
  "capabilities" = "capabilities" || '{"webSearchFormat":"xai"}'::jsonb,
  "updated_at" = now()
WHERE "model_type" = 'chat'
  AND "canonical_model_id" = 'grok-4.5'
  AND "capabilities" IS DISTINCT FROM "capabilities" || '{"webSearchFormat":"xai"}'::jsonb;
