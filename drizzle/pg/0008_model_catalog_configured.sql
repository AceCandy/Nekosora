-- 按当前已配置 models 补齐 model_catalog(来源: https://pi.dev/api/models)
-- 1) 缺失型号入库  2) 补 context_window / max_output_tokens  3) 将 generic 绑定改到对应目录
-- pi 未收录: diffusiongemma-26b-a4b-it、ling-flash-2.0 的窗口参数(后者仅已有目录行,不编造数值)

--> statement-breakpoint

-- 已有目录:补别名,便于自动匹配 / 回绑
UPDATE "model_catalog"
SET "aliases" = (
  SELECT jsonb_agg(DISTINCT v)
  FROM jsonb_array_elements_text(
    COALESCE("aliases", '[]'::jsonb) || '["gemini-flash-lite"]'::jsonb
  ) AS t(v)
),
"updated_at" = now()
WHERE "canonical_model_id" = 'gemini-3.1-flash-lite';
--> statement-breakpoint

UPDATE "model_catalog"
SET "aliases" = (
  SELECT jsonb_agg(DISTINCT v)
  FROM jsonb_array_elements_text(
    COALESCE("aliases", '[]'::jsonb) || '["zai-glm-4.7"]'::jsonb
  ) AS t(v)
),
"updated_at" = now()
WHERE "canonical_model_id" = 'glm-4.7';
--> statement-breakpoint

-- 已有目录但缺窗口:仅写 pi 明确给出的 contextWindow / maxTokens
UPDATE "model_catalog"
SET
  "context_window" = 128000,
  "max_output_tokens" = 16384,
  "updated_at" = now()
WHERE "canonical_model_id" = 'gpt-5-chat'
  AND ("context_window" IS NULL OR "max_output_tokens" IS NULL);
--> statement-breakpoint

-- step-3.7-flash: pi huggingface/stepfun-ai/Step-3.7-Flash
UPDATE "model_catalog"
SET
  "context_window" = 262144,
  "max_output_tokens" = 256000,
  "updated_at" = now()
WHERE "canonical_model_id" = 'step-3.7-flash'
  AND ("context_window" IS NULL OR "max_output_tokens" IS NULL);
--> statement-breakpoint

-- 新增目录(幂等 upsert)
INSERT INTO "model_catalog" (
  "id", "name", "canonical_model_id", "aliases", "model_type", "capabilities",
  "context_window", "max_output_tokens", "sort_order"
) VALUES
(
  'catalog-gpt-oss-120b', 'GPT OSS 120B', 'gpt-oss-120b',
  '["openai/gpt-oss-120b"]'::jsonb, 'chat',
  '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  131072, 131072, 140
),
(
  'catalog-gpt-oss-20b', 'GPT OSS 20B', 'gpt-oss-20b',
  '["openai/gpt-oss-20b","openai/gpt-oss-20b:free"]'::jsonb, 'chat',
  '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  131072, 32768, 141
),
(
  'catalog-gemma-4-31b', 'Gemma 4 31B', 'gemma-4-31b',
  '["gemma-4-31b-it","google/gemma-4-31b-it","google/gemma-4-31b-it:free"]'::jsonb, 'chat',
  '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"off":null,"minimal":"MINIMAL","low":null,"medium":null,"high":"HIGH"}}'::jsonb,
  262144, 32768, 142
),
(
  'catalog-gemma-4-26b-a4b-it', 'Gemma 4 26B A4B', 'gemma-4-26b-a4b-it',
  '["google/gemma-4-26b-a4b-it","google/gemma-4-26b-a4b-it:free"]'::jsonb, 'chat',
  '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"off":null,"minimal":"MINIMAL","low":null,"medium":null,"high":"HIGH"}}'::jsonb,
  262144, 32768, 143
),
(
  'catalog-nemotron-3-nano-30b-a3b', 'Nemotron 3 Nano 30B', 'nemotron-3-nano-30b-a3b',
  '["nvidia/nemotron-3-nano-30b-a3b","nvidia/nemotron-3-nano-30b-a3b:free"]'::jsonb, 'chat',
  '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  131072, 131072, 144
),
(
  'catalog-nemotron-3-super-120b-a12b', 'Nemotron 3 Super 120B', 'nemotron-3-super-120b-a12b',
  '["nvidia/nemotron-3-super-120b-a12b","nvidia/nemotron-3-super-120b-a12b:free"]'::jsonb, 'chat',
  '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  262144, 262144, 145
),
(
  'catalog-big-pickle', 'Big Pickle', 'big-pickle',
  '["opencode/big-pickle"]'::jsonb, 'chat',
  '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  200000, 32000, 146
),
(
  'catalog-qwen3-6-27b', 'Qwen3.6 27B', 'qwen3.6-27b',
  '["qwen/qwen3.6-27b"]'::jsonb, 'chat',
  '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","xhigh":null,"max":null}}'::jsonb,
  262144, 65536, 147
),
(
  'catalog-step-3-5-flash', 'Step 3.5 Flash', 'step-3.5-flash',
  '["stepfun/step-3.5-flash"]'::jsonb, 'chat',
  '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","reasoningEffort":true,"thinkingLevelMap":{"off":null,"minimal":null,"low":"low","medium":"medium","high":"high"}}'::jsonb,
  262144, 256000, 148
)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "model_type" = EXCLUDED."model_type",
  "capabilities" = EXCLUDED."capabilities",
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now();
--> statement-breakpoint

-- 将仍挂在通用模板上的已配置模型,按 name / 别名回绑到具体目录
UPDATE "models" AS "model"
SET
  "catalog_id" = "catalog"."id",
  "updated_at" = now()
FROM "model_catalog" AS "catalog"
WHERE "model"."catalog_id" = 'catalog-chat-generic'
  AND "catalog"."enabled" = true
  AND NOT "catalog"."canonical_model_id" LIKE '\_\_generic\_%' ESCAPE '\'
  AND (
    lower("catalog"."canonical_model_id") = lower("model"."name")
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text("catalog"."aliases") AS "alias"("value")
      WHERE lower("alias"."value") = lower("model"."name")
    )
  );
