UPDATE "model_catalog"
SET "capabilities" = "capabilities" || '{"thinkingFormat":"fixed","thinkingLevelMap":{"off":null,"minimal":null,"low":null,"medium":null,"high":"default","xhigh":null,"max":null}}'::jsonb,
    "updated_at" = now()
WHERE "canonical_model_id" IN (
  'kimi-k2.7-code',
  'kimi-k2.7-code-highspeed'
);
