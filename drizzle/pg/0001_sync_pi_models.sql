-- 同步 pi 模型配置到 model_catalog(由 scripts/sync-pi-models.ts 生成,幂等 upsert)
-- 不改 schema;仅对齐主流 chat 模型的 reasoning/thinkingLevelMap/reasoningEffort/vision/context_window/max_output_tokens

INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gpt-4.1', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1047576,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gpt-4.1-mini', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1047576,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o-mini', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2.5', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null},"vision":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null},"vision":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'claude-haiku-4-5', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.1-pro-preview', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.3-codex', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 272000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4-mini', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4-nano', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4-pro', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":null,"xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":null,"xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.5', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh","minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh","minimal":null}}'::jsonb,
  "context_window" = 272000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.5-pro', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":null,"off":null,"xhigh":"xhigh","minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":null,"off":null,"xhigh":"xhigh","minimal":null}}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-0309-non-reasoning', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 30000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-0309-reasoning', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 30000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'grok-4.3', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 30000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'grok-4.5', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 500000,
  "max_output_tokens" = 500000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'grok-build-0.1', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gemini-3-flash-preview', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.1-flash-lite', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.5-flash', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'glm-4.7', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.7-code', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"off":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"off":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.7-code-highspeed', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"off":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"off":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'MiniMax-M2.7', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'MiniMax-M2.7-highspeed', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'MiniMax-M3', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'claude-fable-5', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","off":null,"xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","off":null,"xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-6', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-7', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-8', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-4-6', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-5', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v4-flash', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 384000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v4-pro', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 384000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'glm-5.2', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":"high","medium":"high","high":"high","max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":"high","medium":"high","high":"high","max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'glm-5-turbo', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.5', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.6', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'o3', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'o4-mini', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-pro', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-flash', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'glm-5.1', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'glm-5v-turbo', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2.5-pro', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
