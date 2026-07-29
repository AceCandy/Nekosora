-- 全量导入 pi 缺失模型到 model_catalog + 更新已有行(由 scripts/sync-pi-models.ts 生成,幂等 upsert)
-- 数据源: https://pi.dev/api/models

INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-fable-5:batch', 'Anthropic: Claude Fable 5 (batch)', '["openrouter/anthropic/claude-fable-5:batch","anthropic/claude-fable-5:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1000000, 128000, 2395)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-haiku-4.5:batch', 'Anthropic: Claude Haiku 4.5 (batch)', '["openrouter/anthropic/claude-haiku-4.5:batch","anthropic/claude-haiku-4.5:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 200000, 64000, 2396)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-opus-4.1:batch', 'Anthropic: Claude Opus 4.1 (batch)', '["openrouter/anthropic/claude-opus-4.1:batch","anthropic/claude-opus-4.1:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 200000, 32000, 2397)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-opus-4.5:batch', 'Anthropic: Claude Opus 4.5 (batch)', '["openrouter/anthropic/claude-opus-4.5:batch","anthropic/claude-opus-4.5:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 200000, 64000, 2398)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-opus-4.6:batch', 'Anthropic: Claude Opus 4.6 (batch)', '["openrouter/anthropic/claude-opus-4.6:batch","anthropic/claude-opus-4.6:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1000000, 128000, 2399)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-opus-4.7:batch', 'Anthropic: Claude Opus 4.7 (batch)', '["openrouter/anthropic/claude-opus-4.7:batch","anthropic/claude-opus-4.7:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1000000, 128000, 2400)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-opus-4.8:batch', 'Anthropic: Claude Opus 4.8 (batch)', '["openrouter/anthropic/claude-opus-4.8:batch","anthropic/claude-opus-4.8:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1000000, 128000, 2401)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-sonnet-4.5:batch', 'Anthropic: Claude Sonnet 4.5 (batch)', '["openrouter/anthropic/claude-sonnet-4.5:batch","anthropic/claude-sonnet-4.5:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1000000, 64000, 2402)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-sonnet-5:batch', 'Anthropic: Claude Sonnet 5 (batch)', '["openrouter/anthropic/claude-sonnet-5:batch","anthropic/claude-sonnet-5:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1000000, 128000, 2403)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'cosmos-reason2-8b', 'Cosmos Reason2 8B', '["nvidia/nvidia/cosmos-reason2-8b","nvidia/cosmos-reason2-8b"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 131072, 16384, 2404)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-2.5-flash-lite:batch', 'Google: Gemini 2.5 Flash Lite (batch)', '["openrouter/google/gemini-2.5-flash-lite:batch","google/gemini-2.5-flash-lite:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65535, 2405)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-2.5-flash:batch', 'Google: Gemini 2.5 Flash (batch)', '["openrouter/google/gemini-2.5-flash:batch","google/gemini-2.5-flash:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65535, 2406)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-2.5-pro:batch', 'Google: Gemini 2.5 Pro (batch)', '["openrouter/google/gemini-2.5-pro:batch","google/gemini-2.5-pro:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65536, 2407)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-3-flash-preview:batch', 'Google: Gemini 3 Flash Preview (batch)', '["openrouter/google/gemini-3-flash-preview:batch","google/gemini-3-flash-preview:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65535, 2408)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-3.1-flash-lite:batch', 'Google: Gemini 3.1 Flash Lite (batch)', '["openrouter/google/gemini-3.1-flash-lite:batch","google/gemini-3.1-flash-lite:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65536, 2409)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-3.1-pro-preview:batch', 'Google: Gemini 3.1 Pro Preview (batch)', '["openrouter/google/gemini-3.1-pro-preview:batch","google/gemini-3.1-pro-preview:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65536, 2410)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-3.5-flash-lite:batch', 'Google: Gemini 3.5 Flash Lite (batch)', '["openrouter/google/gemini-3.5-flash-lite:batch","google/gemini-3.5-flash-lite:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65536, 2411)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-3.5-flash:batch', 'Google: Gemini 3.5 Flash (batch)', '["openrouter/google/gemini-3.5-flash:batch","google/gemini-3.5-flash:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65536, 2412)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-3.6-flash:batch', 'Google: Gemini 3.6 Flash (batch)', '["openrouter/google/gemini-3.6-flash:batch","google/gemini-3.6-flash:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65536, 2413)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemma-3-4b-it', 'Gemma 3 4B IT', '["nvidia/google/gemma-3-4b-it","google/gemma-3-4b-it"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"vision":true}'::jsonb, 131072, 16384, 2414)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5-mini:batch', 'OpenAI: GPT-5 Mini (batch)', '["openrouter/openai/gpt-5-mini:batch","openai/gpt-5-mini:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 400000, 128000, 2415)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5-nano:batch', 'OpenAI: GPT-5 Nano (batch)', '["openrouter/openai/gpt-5-nano:batch","openai/gpt-5-nano:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 400000, 128000, 2416)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5:batch', 'OpenAI: GPT-5 (batch)', '["openrouter/openai/gpt-5:batch","openai/gpt-5:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 400000, 128000, 2417)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5.1:batch', 'OpenAI: GPT-5.1 (batch)', '["openrouter/openai/gpt-5.1:batch","openai/gpt-5.1:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 400000, 128000, 2418)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5.2:batch', 'OpenAI: GPT-5.2 (batch)', '["openrouter/openai/gpt-5.2:batch","openai/gpt-5.2:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 400000, 128000, 2419)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5.4-mini:batch', 'OpenAI: GPT-5.4 Mini (batch)', '["openrouter/openai/gpt-5.4-mini:batch","openai/gpt-5.4-mini:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 400000, 128000, 2420)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5.4-nano:batch', 'OpenAI: GPT-5.4 Nano (batch)', '["openrouter/openai/gpt-5.4-nano:batch","openai/gpt-5.4-nano:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 400000, 128000, 2421)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5.4:batch', 'OpenAI: GPT-5.4 (batch)', '["openrouter/openai/gpt-5.4:batch","openai/gpt-5.4:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1050000, 128000, 2422)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5.5:batch', 'OpenAI: GPT-5.5 (batch)', '["openrouter/openai/gpt-5.5:batch","openai/gpt-5.5:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1050000, 128000, 2423)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'kimi-k3-fast', 'Kimi K3 Fast', '["fireworks/accounts/fireworks/routers/kimi-k3-fast","accounts/fireworks/routers/kimi-k3-fast","moonshotai/kimi-k3-fast","vercel-ai-gateway/moonshotai/kimi-k3-fast"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 131072, 2424)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'llama-3.1-nemotron-70b-instruct', 'Llama 3.1 Nemotron 70B Instruct', '["nvidia/nvidia/llama-3.1-nemotron-70b-instruct","nvidia/llama-3.1-nemotron-70b-instruct"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true}'::jsonb, 128000, 8192, 2425)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'llama-3.1-nemotron-nano-8b-v1', 'Llama 3.1 Nemotron Nano 8B v1', '["nvidia/nvidia/llama-3.1-nemotron-nano-8b-v1","nvidia/llama-3.1-nemotron-nano-8b-v1"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true}'::jsonb, 131072, 16384, 2426)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'llama-3.1-nemotron-nano-vl-8b-v1', 'Llama 3.1 Nemotron Nano VL 8B v1', '["nvidia/nvidia/llama-3.1-nemotron-nano-vl-8b-v1","nvidia/llama-3.1-nemotron-nano-vl-8b-v1"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 32768, 16384, 2427)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'llama-3.1-nemotron-ultra-253b-v1', 'Llama 3.1 Nemotron Ultra 253B', '["nvidia/nvidia/llama-3.1-nemotron-ultra-253b-v1","nvidia/llama-3.1-nemotron-ultra-253b-v1"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true}'::jsonb, 128000, 16384, 2428)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'llama-3.3-nemotron-super-49b-v1', 'Llama 3.3 Nemotron Super 49B v1', '["nvidia/nvidia/llama-3.3-nemotron-super-49b-v1","nvidia/llama-3.3-nemotron-super-49b-v1"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true}'::jsonb, 131072, 65536, 2429)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'llama-3.3-nemotron-super-49b-v1.5', 'Llama 3.3 Nemotron Super 49B v1.5', '["nvidia/nvidia/llama-3.3-nemotron-super-49b-v1.5","nvidia/llama-3.3-nemotron-super-49b-v1.5"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true}'::jsonb, 131072, 65536, 2430)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'minimax-m3:batch', 'MiniMax: MiniMax M3 (batch)', '["openrouter/minimax/minimax-m3:batch","minimax/minimax-m3:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 524288, 4096, 2431)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'mistral-7b-instruct-v0.3', 'Mistral-7B-Instruct-v0.3', '["nvidia/mistralai/mistral-7b-instruct-v0.3","mistralai/mistral-7b-instruct-v0.3"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true}'::jsonb, 65536, 65536, 2432)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'mistral-medium-3.5-128b', 'Mistral Medium 3.5', '["nvidia/mistralai/mistral-medium-3.5-128b","mistralai/mistral-medium-3.5-128b"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 262144, 32768, 2433)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'qwen3.7-flash', 'Qwen: Qwen3.7 Flash', '["openrouter/qwen/qwen3.7-flash","alibaba/qwen3.7-flash","qwen/qwen3.7-flash","vercel-ai-gateway/alibaba/qwen3.7-flash"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1000000, 65536, 2434)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.7', 'GLM 4.7', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-oss-120b', 'GPT OSS 120B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-oss-20b', 'GPT OSS 20B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemma-4-31b', 'Gemma 4 31B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"low":null,"off":null,"high":"HIGH","medium":null,"minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"low":null,"off":null,"high":"HIGH","medium":null,"minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemma-4-26b-a4b-it', 'Gemma 4 26B A4B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"low":null,"off":null,"high":"HIGH","medium":null,"minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"low":null,"off":null,"high":"HIGH","medium":null,"minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-3-nano-30b-a3b', 'Nemotron 3 Nano 30B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-3-super-120b-a12b', 'Nemotron 3 Super 120B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-3-5-haiku-latest', 'Claude 3.5 Haiku', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'big-pickle', 'Big Pickle', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.6-27b', 'Qwen3.6 27B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-chat', 'DeepSeek Chat', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 163840,
  "max_output_tokens" = 163840;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4.1', 'GPT-4.1', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1047576,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4.1-mini', 'GPT-4.1 Mini', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1047576,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o', 'GPT-4o', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o-mini', 'GPT-4o Mini', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2.5', 'MiMo V2.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'step-3.5-flash', 'Step 3.5 Flash', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","reasoningEffort":true,"thinkingLevelMap":{"low":"low","off":null,"high":"high","medium":"medium","minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","reasoningEffort":true,"thinkingLevelMap":{"low":"low","off":null,"high":"high","medium":"medium","minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek.v3-v1:0', 'DeepSeek-V3.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 163840,
  "max_output_tokens" = 81920;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-2', 'Devstral 2', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-2512', 'Devstral 2', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-latest', 'Devstral 2', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-medium-2507', 'Devstral Medium', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-medium-latest', 'Devstral 2 (latest)', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-small-2', 'Devstral Small 2', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-small-2505', 'Devstral Small 2505', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-small-2507', 'Devstral Small', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'free', 'Free Models Router', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'fugu-ultra', 'Sakana: Fugu Ultra', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 1000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'fusion', 'OpenRouter: Fusion', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 30000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.0-flash', 'Gemini 2.0 Flash', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.0-flash-lite', 'Gemini 2.0 Flash-Lite', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-computer-use-preview-10-2025', 'Gemini 2.5 Computer Use Preview 10-2025', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-pro-preview', 'Google: Gemini 2.5 Pro Preview 06-05', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-pro-preview-05-06', 'Google: Gemini 2.5 Pro Preview 05-06', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65535;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3-pro-image', 'Google: Nano Banana Pro (Gemini 3 Pro Image)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 65536,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3-pro-preview', 'Gemini 3 Pro Preview', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.1-flash-lite-image', 'Nano Banana 2 Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 65536,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.3-codex', 'GPT-5.3 Codex', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.1-flash-live-preview', 'Gemini 3.1 Flash Live Preview', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-haiku-4-5', 'Claude Haiku 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.1-pro-preview', 'Gemini 3.1 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4', 'GPT-5.4', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 272000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4-mini', 'GPT-5.4 Mini', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'aion-2.0', 'AionLabs: Aion-2.0', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'aion-3.0', 'AionLabs: Aion-3.0', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'aion-3.0-mini', 'AionLabs: Aion-3.0-Mini', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-3-haiku', 'Anthropic: Claude 3 Haiku', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-3-opus', 'Claude Opus 3', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-3-sonnet', 'Claude Sonnet 3', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-3.5-sonnet', 'Claude Sonnet 3.5 v2', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-fable-latest', 'Anthropic: Claude Fable Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-haiku-4-5-20251001-v1:0', 'Claude Haiku 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-haiku-latest', 'Anthropic Claude Haiku Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-1', 'Claude Opus 4.1 (latest)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'MiniMax-M2.7', 'MiniMax M2.7', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-1-20250805', 'Claude Opus 4.1', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-1-20250805-v1:0', 'Claude Opus 4.1', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'MiniMax-M2.7-highspeed', 'MiniMax M2.7 HighSpeed', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'MiniMax-M3', 'MiniMax M3', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-5', 'Claude Opus 4.5 (latest)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-5-20251101', 'Claude Opus 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-fable-5', 'Claude Fable 5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","off":null,"xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","off":null,"xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-6', 'Claude Opus 4.6', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-7', 'Claude Opus 4.7', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'step-3.7-flash', 'Step 3.7 Flash', 'chat', '{"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","reasoningEffort":true,"thinkingLevelMap":{"low":"low","off":null,"high":"high","medium":"medium","minimal":null},"vision":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","reasoningEffort":true,"thinkingLevelMap":{"low":"low","off":null,"high":"high","medium":"medium","minimal":null},"vision":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-5-20251101-v1:0', 'Claude Opus 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-6-v1', 'Claude Opus 4.6', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4.7-fast', 'Anthropic: Claude Opus 4.7 (Fast)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-4', 'Claude Sonnet 4', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic"}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-5', 'Claude Opus 5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.1-pro', 'Gemini 3.1 Pro Preview', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.5', 'GLM 4.5', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 98304;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.5v', 'GLM 4.5V', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb,
  "context_window" = 66000,
  "max_output_tokens" = 16000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-reasoner', 'DeepSeek Reasoner', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4-nano', 'GPT-5.4 Nano', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4-pro', 'GPT-5.4 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":null,"xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":null,"xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.5', 'GPT-5.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh","minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh","minimal":null}}'::jsonb,
  "context_window" = 272000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-235b-a22b', 'Qwen3 235B A22B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-32b', 'Qwen3 32B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 40960;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.5-pro', 'GPT-5.5 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":null,"off":null,"xhigh":"xhigh","minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":null,"off":null,"xhigh":"xhigh","minimal":null}}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.5', 'Kimi K2.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-0309-non-reasoning', 'Grok 4.20 Non-Reasoning', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 2000000,
  "max_output_tokens" = 2000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o3', 'OpenAI o3', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-0309-reasoning', 'Grok 4.20 Reasoning', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 2000000,
  "max_output_tokens" = 2000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.3', 'Grok 4.3', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 30000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.5', 'Grok 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 500000,
  "max_output_tokens" = 500000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-build-0.1', 'Grok Build 0.1', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3-flash-preview', 'Gemini 3 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.5-flash', 'Gemini 3.5 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-8', 'Claude Opus 4.8', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-4-6', 'Claude Sonnet 4.6', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-5', 'Claude Sonnet 5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v4-flash', 'DeepSeek V4 Flash', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 384000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v4-pro', 'DeepSeek V4 Pro', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 384000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5.2', 'GLM 5.2', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":"high","medium":"high","high":"high","max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":"high","medium":"high","high":"high","max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5-turbo', 'GLM 5 Turbo', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.6', 'Kimi K2.6', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o4-mini', 'OpenAI o4-mini', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4', 'Claude Opus 4', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-pro', 'Gemini 2.5 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-flash', 'Gemini 2.5 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2', 'Kimi K2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5.1', 'GLM 5.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5v-turbo', 'GLM 5V Turbo', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2.5-pro', 'MiMo V2.5 Pro', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-5-fast', 'Claude Opus 5 (Fast)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-latest', 'Anthropic: Claude Opus Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-4-5', 'Claude Sonnet 4.5 (latest)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-4-5-20250929-v1:0', 'Claude Sonnet 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-latest', 'Anthropic Claude Sonnet Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'codestral', 'Mistral Codestral', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'codestral-2508', 'Mistral: Codestral 2508', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'codestral-latest', 'Codestral (latest)', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'command-a', 'Command A', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 8000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'command-r-08-2024', 'Cohere: Command R (08-2024)', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'command-r-plus-08-2024', 'Cohere: Command R+ (08-2024)', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deep-research-max-preview-04-2026', 'Deep Research Max Preview (Apr-21-2026)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deep-research-preview-04-2026', 'Deep Research Preview (Apr-21-2026)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-chat-v3-0324', 'DeepSeek: DeepSeek V3 0324', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 163840,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-chat-v3.1', 'DeepSeek: DeepSeek V3.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 163840,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-r1-0528', 'DeepSeek: R1 0528', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 163840,
  "max_output_tokens" = 163840;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v3.1', 'DeepSeek V3.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 163840,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v3.1-terminus', 'DeepSeek: DeepSeek V3.1 Terminus', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v3.2', 'DeepSeek V3.2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v3.2-exp', 'DeepSeek: DeepSeek V3.2 Exp', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 163840,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v3.2-thinking', 'DeepSeek V3.2 Thinking', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek.r1-v1:0', 'DeepSeek-R1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.6-flash', 'Gemini 3.6 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-pro-latest', 'Google Gemini Pro Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-robotics-er-1.6-preview', 'Gemini Robotics-ER 1.6 Preview', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemma-3-12b-it', 'Google: Gemma 3 12B', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemma-3-27b-it', 'Google: Gemma 3 27B', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.5-air', 'GLM-4.5-Air', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 98304;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.6', 'Z.ai: GLM 4.6', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.6v', 'Z.ai: GLM 4.6V', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.6v-flash', 'GLM-4.6V-Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 24000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.7-flash', 'Z.ai: GLM 4.7 Flash', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 202752,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.7-flashx', 'GLM 4.7 FlashX', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5', 'GLM-5', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 202752,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5.2-fast', 'GLM 5.2 Fast', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5p2', 'GLM 5.2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048575,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5p2-fast', 'GLM 5.2 Fast', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048575,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'google.gemma-3-27b-it', 'Google Gemma 3 27B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 202752,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'google.gemma-3-4b-it', 'Gemma 3 4B IT', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-3.5-turbo', 'OpenAI: GPT-3.5 Turbo', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 16385,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-3.5-turbo-0613', 'OpenAI: GPT-3.5 Turbo (older v0613)', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 4095,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-3.5-turbo-16k', 'OpenAI: GPT-3.5 Turbo 16k', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 16385,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4', 'GPT-4', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 8192,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4-turbo', 'GPT-4 Turbo', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4-turbo-preview', 'OpenAI: GPT-4 Turbo Preview', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4.1-nano', 'GPT-4.1 nano', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1047576,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o-2024-05-13', 'GPT-4o (2024-05-13)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o-2024-08-06', 'GPT-4o (2024-08-06)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o-2024-11-20', 'GPT-4o (2024-11-20)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o-mini-2024-07-18', 'OpenAI: GPT-4o-mini (2024-07-18)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5', 'GPT-5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5-chat-latest', 'GPT-5 Chat Latest', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5-codex', 'OpenAI: GPT-5 Codex', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5-mini', 'GPT-5 Mini', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5-nano', 'GPT-5 Nano', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5-pro', 'GPT-5 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.1', 'GPT-5.1', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.1-chat', 'OpenAI: GPT-5.1 Chat', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.1-codex', 'OpenAI: GPT-5.1-Codex', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.1-codex-max', 'OpenAI: GPT-5.1-Codex-Max', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.1-codex-mini', 'OpenAI: GPT-5.1-Codex-Mini', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.1-instant', 'GPT-5.1 Instant', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.1-thinking', 'GPT 5.1 Thinking', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.2', 'GPT-5.2', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.2-chat', 'OpenAI: GPT-5.2 Chat', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.2-chat-latest', 'GPT-5.2 Chat', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.2-codex', 'OpenAI: GPT-5.2-Codex', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.2-pro', 'GPT-5.2 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.3-chat', 'OpenAI: GPT-5.3 Chat', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.3-chat-latest', 'GPT-5.3 Chat (latest)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.3-codex-spark', 'GPT-5.3 Codex Spark', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.6-luna', 'GPT-5.6 Luna', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 272000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.6-luna-pro', 'OpenAI: GPT-5.6 Luna Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.6-sol', 'GPT-5.6 Sol', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 272000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.6-sol-pro', 'OpenAI: GPT-5.6 Sol Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.6-terra', 'GPT-5.6 Terra', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 272000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.6-terra-pro', 'OpenAI: GPT-5.6 Terra Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-audio', 'OpenAI: GPT Audio', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-audio-mini', 'OpenAI: GPT Audio Mini', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-chat-latest', 'OpenAI: GPT Chat Latest', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-latest', 'OpenAI GPT Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-mini-latest', 'OpenAI GPT Mini Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-oss-120b-1:0', 'gpt-oss-120b', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-oss-20b-1:0', 'gpt-oss-20b', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-oss-safeguard-120b', 'GPT OSS Safeguard 120B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-oss-safeguard-20b', 'OpenAI: gpt-oss-safeguard-20b', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-realtime-2.1', 'GPT-Realtime-2.1', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'granite-4.0-h-micro', 'Granite 4.0 H Micro', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131000,
  "max_output_tokens" = 131000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'granite-4.1-8b', 'IBM: Granite 4.1 8B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.1-fast-non-reasoning', 'Grok 4.1 Fast Non-Reasoning', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 1000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.1-fast-reasoning', 'Grok 4.1 Fast Reasoning', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 1000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20', 'xAI: Grok 4.20', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 2000000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-multi-agent', 'Grok 4.20 Multi-Agent', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 2000000,
  "max_output_tokens" = 2000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-multi-agent-beta', 'Grok 4.20 Multi Agent Beta', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 2000000,
  "max_output_tokens" = 2000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-non-reasoning-beta', 'Grok 4.20 Beta Non-Reasoning', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 2000000,
  "max_output_tokens" = 2000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-reasoning-beta', 'Grok 4.20 Beta Reasoning', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 2000000,
  "max_output_tokens" = 2000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-latest', 'xAI: Grok Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 500000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'hy3', 'Tencent: Hy3', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'hy3-preview', 'Tencent: Hy3 preview', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'inkling', 'Thinking Machines: Inkling', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 524288,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'interfaze-beta', 'Interfaze Beta', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jamba-large-1.7', 'AI21: Jamba Large 1.7', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jp.anthropic.claude-haiku-4-5-20251001-v1:0', 'Claude Haiku 4.5 (JP)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jp.anthropic.claude-opus-4-7', 'Claude Opus 4.7 (JP)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jp.anthropic.claude-opus-4-8', 'Claude Opus 4.8 (JP)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jp.anthropic.claude-opus-5', 'Claude Opus 5 (JP)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jp.anthropic.claude-sonnet-4-5-20250929-v1:0', 'Claude Sonnet 4.5 (JP)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jp.anthropic.claude-sonnet-4-6', 'Claude Sonnet 4.6 (JP)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jp.anthropic.claude-sonnet-5', 'Claude Sonnet 5 (JP)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'k3', 'Kimi K3', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'k3-256k', 'Kimi K3-256K', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kat-coder-air-v2.5', 'Kwaipilot: KAT-Coder-Air V2.5', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 80000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kat-coder-pro-v1', 'KAT-Coder-Pro V1', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kat-coder-pro-v2', 'Kwaipilot: KAT-Coder-Pro V2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kat-coder-pro-v2.5', 'Kwaipilot: KAT-Coder-Pro V2.5', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 80000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-for-coding', 'Kimi K2.7 Code', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-for-coding-highspeed', 'Kimi For Coding HighSpeed', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2-0905', 'MoonshotAI: Kimi K2 0905', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 100352;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2-0905-preview', 'Kimi K2 0905', 'chat', '{"tools":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Kimi-K2-Instruct', 'Kimi-K2-Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Kimi-K2-Instruct-0905', 'Kimi-K2-Instruct-0905', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2-thinking', 'Kimi K2 Thinking', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2-thinking-turbo', 'Kimi K2 Thinking Turbo', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2-turbo-preview', 'Kimi K2 Turbo', 'chat', '{"tools":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2p6', 'Kimi K2.6', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262000,
  "max_output_tokens" = 262000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2p6-fast', 'Kimi K2.6 Fast', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262000,
  "max_output_tokens" = 262000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2p6-turbo', 'Kimi K2.6 Turbo', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262000,
  "max_output_tokens" = 262000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2p7-code', 'Kimi K2.7 Code', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262000,
  "max_output_tokens" = 262000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2p7-code-fast', 'Kimi K2.7 Code Fast', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262000,
  "max_output_tokens" = 262000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k3', 'Kimi K3', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","reasoningEffort":true,"thinkingLevelMap":{"off":null,"minimal":null,"low":"low","medium":null,"high":"high","xhigh":null,"max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","reasoningEffort":true,"thinkingLevelMap":{"off":null,"minimal":null,"low":"low","medium":null,"high":"high","xhigh":null,"max":"max"}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-latest', 'MoonshotAI Kimi Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'l3.1-euryale-70b', 'Sao10K: Llama 3.1 Euryale 70B v2.2', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'labs-devstral-small-2512', 'Devstral Small 2', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'laguna-s-2.1', 'Poolside: Laguna S 2.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'laguna-xs-2.1', 'Poolside: Laguna XS 2.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Ling-2.6-1T', 'Ling 2.6 1T', 'chat', '{"tools":true,"systemPrompt":true,"thinkingFormat":"ant-ling"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true,"thinkingFormat":"ant-ling"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Ling-2.6-flash', 'Ling 2.6 Flash', 'chat', '{"tools":true,"systemPrompt":true,"thinkingFormat":"ant-ling"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true,"thinkingFormat":"ant-ling"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ling-3.0-flash', 'Ling-3.0-flash (free)', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.1-70b', 'Llama 3.1 70B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.1-70b-instruct', 'Meta: Llama 3.1 70B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.1-8b', 'Llama 3.1 8B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.1-8b-instant', 'Llama 3.1 8B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.1-8b-instruct', 'Meta: Llama 3.1 8B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.2-11b-vision-instruct', 'Llama 3.2 11b Vision Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.2-90b-vision-instruct', 'Llama-3.2-90B-Vision-Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.3-70b', 'Llama 3.3 70B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.3-70b-instruct', 'Meta: Llama 3.3 70B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.3-70b-instruct-fp8-fast', 'Llama 3.3 70B Instruct fp8 Fast', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 24000,
  "max_output_tokens" = 24000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Llama-3.3-70B-Instruct-Turbo', 'Llama 3.3 70B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.3-70b-versatile', 'Llama 3.3 70B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-4-maverick', 'Meta: Llama 4 Maverick', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-4-scout', 'Meta: Llama 4 Scout', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 327680,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-4-scout-17b-16e-instruct', 'Llama 4 Scout 17B 16E', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'longcat-2.0', 'Meituan: LongCat 2.0', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048756,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'magistral-medium', 'Magistral Medium 2509', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'magistral-medium-latest', 'Magistral Medium (latest)', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'magistral-small', 'Magistral Small', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mai-code-1-flash-picker', 'MAI-Code-1-Flash', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mercury-2', 'Inception: Mercury 2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mercury-coder-small', 'Mercury Coder Small Beta', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'meta.llama3-1-70b-instruct-v1:0', 'Llama 3.1 70B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'meta.llama3-1-8b-instruct-v1:0', 'Llama 3.1 8B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'meta.llama3-3-70b-instruct-v1:0', 'Llama 3.3 70B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'meta.llama4-maverick-17b-instruct-v1:0', 'Llama 4 Maverick 17B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'meta.llama4-scout-17b-instruct-v1:0', 'Llama 4 Scout 17B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 3500000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2-flash', 'MiMo-V2-Flash', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2-omni', 'MiMo-V2-Omni', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2-pro', 'MiMo-V2-Pro', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2.5-pro-ultraspeed', 'MiMo-V2.5-Pro-UltraSpeed', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax-m1', 'MiniMax: MiniMax M1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 40000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax-m2', 'MiniMax: MiniMax M2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 205000,
  "max_output_tokens" = 205000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax-m2.1', 'MiniMax: MiniMax M2.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax-m2.1-lightning', 'MiniMax M2.1 Lightning', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'MiniMax-M2.5', 'MiniMax-M2.5', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 196608,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax-m2.5-highspeed', 'MiniMax M2.5 High Speed', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax-m2p7', 'MiniMax-M2.7', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 196608,
  "max_output_tokens" = 196608;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax.minimax-m2', 'MiniMax M2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204608,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax.minimax-m2.1', 'MiniMax M2.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax.minimax-m2.5', 'MiniMax M2.5', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 196608,
  "max_output_tokens" = 98304;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-14b', 'Ministral 14B', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-14b-2512', 'Mistral: Ministral 3 14B 2512', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-3b', 'Ministral 3B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-3b-2512', 'Mistral: Ministral 3 3B 2512', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-3b-latest', 'Ministral 3B (latest)', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-8b', 'Ministral 8B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-8b-2512', 'Mistral: Ministral 3 8B 2512', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-8b-latest', 'Ministral 8B (latest)', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-large', 'Mistral Large', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-large-2407', 'Mistral Large 2407', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-large-2411', 'Mistral Large 2.1', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-large-2512', 'Mistral Large 3', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-large-3', 'Mistral Large 3', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-large-latest', 'Mistral Large (latest)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium', 'Mistral Medium 3.1', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium-2505', 'Mistral Medium 3', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium-2508', 'Mistral Medium 3.1', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium-2604', 'Mistral Medium 3.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium-3', 'Mistral: Mistral Medium 3', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium-3.1', 'Mistral: Mistral Medium 3.1', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium-3.5', 'Mistral Medium 3.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium-latest', 'Mistral Medium (latest)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-nemo', 'Mistral Nemo', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-saba', 'Mistral: Saba', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32768,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-small', 'Mistral Small', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32000,
  "max_output_tokens" = 4000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-small-2506', 'Mistral Small 3.2', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-small-2603', 'Mistral Small 4', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-small-3.1-24b-instruct', 'Mistral Small 3.1 24B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-small-3.2-24b-instruct', 'Mistral: Mistral Small 3.2 24B', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-small-latest', 'Mistral Small (latest)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.devstral-2-123b', 'Devstral 2 123B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.magistral-small-2509', 'Magistral Small 1.2', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 40000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.ministral-3-14b-instruct', 'Ministral 14B 3.0', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.ministral-3-3b-instruct', 'Ministral 3 3B', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.ministral-3-8b-instruct', 'Ministral 3 8B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.mistral-large-3-675b-instruct', 'Mistral Large 3', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.pixtral-large-2502-v1:0', 'Pixtral Large (25.02)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.voxtral-mini-3b-2507', 'Voxtral Mini 3B 2507', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.voxtral-small-24b-2507', 'Voxtral Small 24B 2507', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mixtral-8x22b-instruct', 'Mistral: Mixtral 8x22B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 65536,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'moonshot.kimi-k2-thinking', 'Kimi K2 Thinking', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262143,
  "max_output_tokens" = 16000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'moonshotai.kimi-k2.5', 'Kimi K2.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262143,
  "max_output_tokens" = 16000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'muse-spark-1.1', 'Meta: Muse Spark 1.1', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 1048576;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-3-120b-a12b', 'Nemotron 3 Super 120B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-3-nano-omni-30b-a3b-reasoning', 'NVIDIA: Nemotron 3 Nano Omni (free)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-3-ultra', 'Nemotron 3 Ultra Free', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-3-ultra-550b-a55b', 'NVIDIA: Nemotron 3 Ultra', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o4-mini-deep-research', 'OpenAI: o4 Mini Deep Research', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-nano-12b-v2-vl', 'NVIDIA: Nemotron Nano 12B 2 VL (free)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-nano-9b-v2', 'NVIDIA: Nemotron Nano 9B V2 (free)', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nex-n2-mini', 'Nex AGI: Nex-N2-Mini', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nex-n2-pro', 'Nex AGI: Nex-N2-Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'north-mini-code', 'Cohere: North Mini Code (free)', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-2-lite', 'Nova 2 Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 1000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-2-lite-v1', 'Amazon: Nova 2 Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65535;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-2-lite-v1:0', 'Nova 2 Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-lite', 'Nova Lite', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 300000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-lite-v1', 'Amazon: Nova Lite 1.0', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 300000,
  "max_output_tokens" = 5120;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-lite-v1:0', 'Nova Lite', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 300000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-micro', 'Nova Micro', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-micro-v1', 'Amazon: Nova Micro 1.0', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 5120;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-micro-v1:0', 'Nova Micro', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-premier-v1', 'Amazon: Nova Premier 1.0', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-pro', 'Nova Pro', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 300000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-pro-v1', 'Amazon: Nova Pro 1.0', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 300000,
  "max_output_tokens" = 5120;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-pro-v1:0', 'Nova Pro', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 300000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nvidia-nemotron-nano-9b-v2', 'nvidia-nemotron-nano-9b-v2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nvidia.nemotron-nano-12b-v2', 'NVIDIA Nemotron Nano 12B v2 VL BF16', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nvidia.nemotron-nano-3-30b', 'NVIDIA Nemotron Nano 3 30B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nvidia.nemotron-super-3-120b', 'NVIDIA Nemotron 3 Super 120B A12B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o1', 'o1', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o1-pro', 'o1-pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o3-deep-research', 'OpenAI: o3 Deep Research', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o3-mini', 'o3-mini', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o3-mini-high', 'OpenAI: o3 Mini High', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o3-pro', 'o3-pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o4-mini-high', 'OpenAI: o4 Mini High', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'open-mistral-7b', 'Mistral 7B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 8000,
  "max_output_tokens" = 8000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'open-mistral-nemo', 'Open Mistral Nemo', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'open-mixtral-8x22b', 'Mixtral 8x22B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 64000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'open-mixtral-8x7b', 'Mixtral 8x7B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'pixtral-12b', 'Pixtral 12B', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'pixtral-large-latest', 'Pixtral Large (latest)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-2.5-72b-instruct', 'Qwen2.5 72B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32768,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-2.5-7b-instruct', 'Qwen: Qwen2.5 7B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32768,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-3-14b', 'Qwen3-14B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 40960,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-3-235b', 'Qwen3 235B A22B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-3-30b', 'Qwen3-30B-A3B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 40960,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-3-32b', 'Qwen 3 32B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-3.6-max-preview', 'Qwen 3.6 Max Preview', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 240000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-plus', 'Qwen: Qwen-Plus', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-plus-2025-07-28', 'Qwen: Qwen Plus 0728', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-plus-2025-07-28:thinking', 'Qwen: Qwen Plus 0728 (thinking)', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen.qwen3-235b-a22b-2507-v1:0', 'Qwen3 235B A22B 2507', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen.qwen3-32b-v1:0', 'Qwen3 32B (dense)', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 16384,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen.qwen3-coder-30b-a3b-v1:0', 'Qwen3 Coder 30B A3B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen.qwen3-coder-480b-a35b-v1:0', 'Qwen3 Coder 480B A35B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen.qwen3-coder-next', 'Qwen3 Coder Next', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen.qwen3-next-80b-a3b', 'Qwen/Qwen3-Next-80B-A3B-Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262000,
  "max_output_tokens" = 262000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen.qwen3-vl-235b-a22b', 'Qwen/Qwen3-VL-235B-A22B-Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262000,
  "max_output_tokens" = 262000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Qwen2.5-7B-Instruct-Turbo', 'Qwen 2.5 7B Instruct Turbo', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32768,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-14b', 'Qwen: Qwen3 14B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-235b-a22b-2507', 'Qwen: Qwen3 235B A22B Instruct 2507', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-235b-a22b-thinking', 'Qwen3 VL 235B A22B Thinking', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-235b-a22b-thinking-2507', 'Qwen: Qwen3 235B A22B Thinking 2507', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-30b-a3b', 'Qwen: Qwen3 30B A3B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 40960,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-30b-a3b-fp8', 'Qwen3 30B A3b fp8', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32768,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-30b-a3b-instruct-2507', 'Qwen: Qwen3 30B A3B Instruct 2507', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-30b-a3b-thinking-2507', 'Qwen: Qwen3 30B A3B Thinking 2507', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 81920,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-8b', 'Qwen: Qwen3 8B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-coder', 'Qwen: Qwen3 Coder 480B A35B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-coder-30b-a3b', 'Qwen 3 Coder 30B A3B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-coder-30b-a3b-instruct', 'Qwen: Qwen3 Coder 30B A3B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Qwen3-Coder-480B-A35B-Instruct', 'Qwen3-Coder-480B-A35B-Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 66536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-coder-flash', 'Qwen: Qwen3 Coder Flash', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-coder-next', 'Qwen: Qwen3 Coder Next', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-coder-plus', 'Qwen: Qwen3 Coder Plus', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-max', 'Qwen: Qwen3 Max', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-max-preview', 'Qwen3 Max Preview', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-max-thinking', 'Qwen: Qwen3 Max Thinking', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-next-80b-a3b-instruct', 'Qwen: Qwen3 Next 80B A3B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-next-80b-a3b-thinking', 'Qwen: Qwen3 Next 80B A3B Thinking', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-235b-a22b-instruct', 'Qwen: Qwen3 VL 235B A22B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 129024;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-235b-a22b-thinking', 'Qwen: Qwen3 VL 235B A22B Thinking', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-30b-a3b-instruct', 'Qwen: Qwen3 VL 30B A3B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-30b-a3b-thinking', 'Qwen: Qwen3 VL 30B A3B Thinking', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-32b-instruct', 'Qwen: Qwen3 VL 32B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-8b-instruct', 'Qwen: Qwen3 VL 8B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-8b-thinking', 'Qwen: Qwen3 VL 8B Thinking', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-instruct', 'Qwen3 VL 235B A22B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 129024;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-thinking', 'Qwen3 VL 235B A22B Thinking', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-122b-a10b', 'Qwen: Qwen3.5-122B-A10B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-27b', 'Qwen: Qwen3.5-27B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-35b-a3b', 'Qwen: Qwen3.5-35B-A3B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-397b-a17b', 'Qwen: Qwen3.5 397B A17B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-9b', 'Qwen: Qwen3.5-9B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-flash', 'Qwen 3.5 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-flash-02-23', 'Qwen: Qwen3.5-Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-plus', 'Qwen 3.5 Plus', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-plus-02-15', 'Qwen: Qwen3.5 Plus 2026-02-15', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-plus-20260420', 'Qwen: Qwen3.5 Plus 2026-04-20', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.6-35b-a3b', 'Qwen: Qwen3.6 35B A3B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.6-flash', 'Qwen3.6 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.6-max-preview', 'Qwen: Qwen3.6 Max Preview', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.6-plus', 'Qwen3.6 Plus', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.7-max', 'Qwen3.7 Max', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.7-plus', 'Qwen3.7 Plus', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.8-max-preview', 'Qwen3.8 Max Preview', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3p7-plus', 'Qwen 3.7 Plus', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'reka-edge', 'Reka Edge', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 16384,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'relace-search', 'Relace: Relace Search', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Ring-2.6-1T', 'Ring 2.6 1T', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"ant-ling","thinkingLevelMap":{"off":null,"minimal":null,"low":null,"medium":null,"high":"high","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"ant-ling","thinkingLevelMap":{"off":null,"minimal":null,"low":null,"medium":null,"high":"high","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'seed-1.6', 'ByteDance Seed: Seed 1.6', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'seed-1.6-flash', 'ByteDance Seed: Seed 1.6 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'seed-1.8', 'Bytedance Seed 1.8', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'seed-2.0-lite', 'ByteDance Seed: Seed-2.0-Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'seed-2.0-mini', 'ByteDance Seed: Seed-2.0-Mini', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'solar-pro-3', 'Upstage: Solar Pro 3', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'trinity-large-thinking', 'Arcee AI: Trinity Large Thinking', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'trinity-mini', 'Trinity Mini', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'unslopnemo-12b', 'TheDrummer: UnslopNemo 12B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32768,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'virtuoso-large', 'Arcee AI: Virtuoso Large', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'voxtral-small-24b-2507', 'Mistral: Voxtral Small 24B 2507', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'writer.palmyra-x4-v1:0', 'Palmyra X4', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 122880,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'writer.palmyra-x5-v1:0', 'Palmyra X5', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1040000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'xai.grok-4.3', 'Grok 4.3', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'zai.glm-4.7-flash', 'GLM-4.7-Flash', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'zai.glm-5', 'GLM-5', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 202752,
  "max_output_tokens" = 101376;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.7-code', 'Kimi K2.7 Code', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.7-code-highspeed', 'Kimi K2.7 Code HighSpeed', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
