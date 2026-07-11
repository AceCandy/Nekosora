UPDATE "model_catalog"
SET "capabilities" = "capabilities" || '{"reasoningEffort":true}'::jsonb
WHERE "canonical_model_id" IN ('glm-5.2', 'deepseek-v4-flash', 'deepseek-v4-pro');
--> statement-breakpoint
UPDATE "model_catalog"
SET "capabilities" = jsonb_set(
  "capabilities",
  '{thinkingLevelMap}',
  '{"minimal":null,"low":null,"medium":null,"high":"","xhigh":null,"max":null}'::jsonb
)
WHERE "canonical_model_id" IN (
  'glm-4.7', 'glm-5-turbo', 'glm-5.1', 'glm-5v-turbo', 'kimi-k2.5', 'kimi-k2.6'
);
