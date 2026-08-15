-- Model catalog sync generated from a reviewed local snapshot.
-- source-sha256: 79b54bc0f47849731407d170883de412d1e6b823ceed1d10b7203d0ddc277d70

INSERT INTO "model_catalog" ("canonical_model_id", "name", "model_type", "capabilities", "enabled", "context_window", "max_output_tokens")
VALUES ('gemini-3.7-flash', 'Gemini 3.7 Flash', 'chat', '{"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"low":"low","medium":"medium","high":"high"},"tools":true,"vision":true}'::jsonb, true, 1048576, 65536)
ON CONFLICT ("canonical_model_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "model_catalog" ("canonical_model_id", "name", "model_type", "capabilities", "enabled", "context_window", "max_output_tokens")
VALUES ('glm-5.3', 'GLM-5.3', 'chat', '{"systemPrompt":true,"tools":true}'::jsonb, true, 1000000, 131072)
ON CONFLICT ("canonical_model_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "model_catalog" ("canonical_model_id", "name", "model_type", "capabilities", "enabled", "context_window")
VALUES ('grok-4.6', 'Grok 4.6', 'chat', '{"systemPrompt":true,"tools":true,"vision":true}'::jsonb, true, 500000)
ON CONFLICT ("canonical_model_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "model_catalog" ("canonical_model_id", "name", "model_type", "capabilities", "enabled")
VALUES ('qwen3.8-max', 'Qwen3.8 Max', 'chat', '{"systemPrompt":true,"tools":true}'::jsonb, true)
ON CONFLICT ("canonical_model_id") DO NOTHING;
