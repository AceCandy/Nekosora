INSERT INTO `model_catalog` (
  `id`, `name`, `canonical_model_id`, `aliases`, `model_type`, `capabilities`,
  `context_window`, `max_output_tokens`, `sort_order`
) VALUES
(
  'catalog-agnes-1-5-flash', 'Agnes 1.5 Flash', 'agnes-1.5-flash', '[]', 'chat',
  '{"vision":true,"tools":true,"systemPrompt":true}',
  262144, 65536, 130
),
(
  'catalog-agnes-2-0-flash', 'Agnes 2.0 Flash', 'agnes-2.0-flash', '[]', 'chat',
  '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"agnes","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"2048","xhigh":null,"max":null}}',
  524288, 65536, 131
)
ON CONFLICT(`canonical_model_id`) DO UPDATE SET
  `name` = excluded.`name`,
  `aliases` = excluded.`aliases`,
  `model_type` = excluded.`model_type`,
  `capabilities` = excluded.`capabilities`,
  `context_window` = excluded.`context_window`,
  `max_output_tokens` = excluded.`max_output_tokens`,
  `sort_order` = excluded.`sort_order`,
  `enabled` = 1;
