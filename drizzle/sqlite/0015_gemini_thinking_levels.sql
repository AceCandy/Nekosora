UPDATE `model_catalog`
SET `capabilities` = json_set(
  `capabilities`,
  '$.thinkingLevelMap',
  json('{"off":null,"minimal":"MINIMAL","low":"LOW","medium":"MEDIUM","high":"HIGH"}')
)
WHERE `canonical_model_id` IN (
  'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'
);
