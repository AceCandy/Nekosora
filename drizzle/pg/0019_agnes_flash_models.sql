INSERT INTO "model_catalog" (
  "id", "name", "canonical_model_id", "aliases", "model_type", "capabilities",
  "context_window", "max_output_tokens", "sort_order"
) VALUES
(
  'catalog-agnes-1-5-flash', 'Agnes 1.5 Flash', 'agnes-1.5-flash', '[]'::jsonb, 'chat',
  '{"vision":true,"tools":true,"systemPrompt":true}'::jsonb,
  262144, 65536, 130
),
(
  'catalog-agnes-2-0-flash', 'Agnes 2.0 Flash', 'agnes-2.0-flash', '[]'::jsonb, 'chat',
  '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"agnes","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"2048","xhigh":null,"max":null}}'::jsonb,
  524288, 65536, 131
)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "model_type" = EXCLUDED."model_type",
  "capabilities" = EXCLUDED."capabilities",
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true;
