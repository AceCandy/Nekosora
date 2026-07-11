UPDATE "model_catalog"
SET "capabilities" = jsonb_set(
  "capabilities",
  '{thinkingLevelMap}',
  '{"off":null,"minimal":"MINIMAL","low":"LOW","medium":"MEDIUM","high":"HIGH"}'::jsonb
)
WHERE "canonical_model_id" IN (
  'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'
);
