INSERT INTO "model_catalog" ("id", "name", "canonical_model_id", "aliases", "model_type", "capabilities", "sort_order") VALUES
('catalog-gpt-5-chat', 'GPT-5 Chat', 'gpt-5-chat', '["openai/gpt-5-chat"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 20),
('catalog-ling-flash-2', 'Ling Flash 2.0', 'ling-flash-2.0', '["inclusionai/ling-flash-2.0"]'::jsonb, 'chat', '{"systemPrompt":true}'::jsonb, 21),
('catalog-mimo-v2-5', 'MiMo V2.5', 'mimo-v2.5', '["xiaomi/mimo-v2.5"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 22),
('catalog-mimo-v2-5-pro', 'MiMo V2.5 Pro', 'mimo-v2.5-pro', '["xiaomi/mimo-v2.5-pro"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 23),
('catalog-step-3-7-flash', 'Step 3.7 Flash', 'step-3.7-flash', '["stepfun/step-3.7-flash"]'::jsonb, 'chat', '{"reasoning":true,"systemPrompt":true}'::jsonb, 24),
('catalog-gpt-4-1', 'GPT-4.1', 'gpt-4.1', '["openai/gpt-4.1"]'::jsonb, 'chat', '{"vision":true,"tools":true,"systemPrompt":true}'::jsonb, 30),
('catalog-gpt-4-1-mini', 'GPT-4.1 Mini', 'gpt-4.1-mini', '["openai/gpt-4.1-mini"]'::jsonb, 'chat', '{"vision":true,"tools":true,"systemPrompt":true}'::jsonb, 31),
('catalog-gpt-4o', 'GPT-4o', 'gpt-4o', '["openai/gpt-4o"]'::jsonb, 'chat', '{"vision":true,"tools":true,"systemPrompt":true}'::jsonb, 32),
('catalog-gpt-4o-mini', 'GPT-4o Mini', 'gpt-4o-mini', '["openai/gpt-4o-mini"]'::jsonb, 'chat', '{"vision":true,"tools":true,"systemPrompt":true}'::jsonb, 33),
('catalog-o3', 'OpenAI o3', 'o3', '["openai/o3"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 34),
('catalog-o4-mini', 'OpenAI o4-mini', 'o4-mini', '["openai/o4-mini"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 35),
('catalog-claude-sonnet-4', 'Claude Sonnet 4', 'claude-sonnet-4', '["anthropic/claude-sonnet-4","claude-sonnet-4-20250514"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 40),
('catalog-claude-opus-4', 'Claude Opus 4', 'claude-opus-4', '["anthropic/claude-opus-4","claude-opus-4-20250514"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 41),
('catalog-claude-3-5-haiku', 'Claude 3.5 Haiku', 'claude-3-5-haiku-latest', '["anthropic/claude-3.5-haiku","claude-3-5-haiku-20241022"]'::jsonb, 'chat', '{"vision":true,"tools":true,"systemPrompt":true}'::jsonb, 42),
('catalog-gemini-2-5-pro', 'Gemini 2.5 Pro', 'gemini-2.5-pro', '["google/gemini-2.5-pro"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 50),
('catalog-gemini-2-5-flash', 'Gemini 2.5 Flash', 'gemini-2.5-flash', '["google/gemini-2.5-flash"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 51),
('catalog-deepseek-chat', 'DeepSeek Chat', 'deepseek-chat', '["deepseek/deepseek-chat","deepseek-v3"]'::jsonb, 'chat', '{"tools":true,"systemPrompt":true}'::jsonb, 60),
('catalog-deepseek-reasoner', 'DeepSeek Reasoner', 'deepseek-reasoner', '["deepseek/deepseek-reasoner","deepseek-r1"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 61),
('catalog-qwen3-235b-a22b', 'Qwen3 235B A22B', 'qwen3-235b-a22b', '["qwen/qwen3-235b-a22b","qwen3-235b-a22b-instruct-2507"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 70),
('catalog-qwen3-32b', 'Qwen3 32B', 'qwen3-32b', '["qwen/qwen3-32b"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 71),
('catalog-qwen2-5-vl-72b', 'Qwen2.5 VL 72B', 'qwen2.5-vl-72b-instruct', '["qwen/qwen2.5-vl-72b-instruct"]'::jsonb, 'chat', '{"vision":true,"tools":true,"systemPrompt":true}'::jsonb, 72),
('catalog-glm-4-5', 'GLM 4.5', 'glm-4.5', '["zai/glm-4.5","zhipu/glm-4.5"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 80),
('catalog-glm-4-5v', 'GLM 4.5V', 'glm-4.5v', '["zai/glm-4.5v","zhipu/glm-4.5v"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 81),
('catalog-kimi-k2', 'Kimi K2', 'kimi-k2', '["moonshot/kimi-k2","kimi-k2-0711-preview"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 90),
('catalog-moonshot-v1-8k', 'Moonshot V1 8K', 'moonshot-v1-8k', '["moonshot/moonshot-v1-8k"]'::jsonb, 'chat', '{"tools":true,"systemPrompt":true}'::jsonb, 91),
('catalog-gpt-image-1', 'GPT Image 1', 'gpt-image-1', '["openai/gpt-image-1"]'::jsonb, 'image', '{"imageGeneration":true}'::jsonb, 200),
('catalog-dall-e-3', 'DALL-E 3', 'dall-e-3', '["openai/dall-e-3"]'::jsonb, 'image', '{"imageGeneration":true}'::jsonb, 201),
('catalog-flux-1-1-pro', 'FLUX 1.1 Pro', 'flux-1.1-pro', '["black-forest-labs/flux-1.1-pro"]'::jsonb, 'image', '{"imageGeneration":true}'::jsonb, 202),
('catalog-cogview-4', 'CogView 4', 'cogview-4', '["zai/cogview-4","zhipu/cogview-4"]'::jsonb, 'image', '{"imageGeneration":true}'::jsonb, 203),
('catalog-text-embedding-3-small', 'Text Embedding 3 Small', 'text-embedding-3-small', '["openai/text-embedding-3-small"]'::jsonb, 'embedding', '{}'::jsonb, 300),
('catalog-text-embedding-3-large', 'Text Embedding 3 Large', 'text-embedding-3-large', '["openai/text-embedding-3-large"]'::jsonb, 'embedding', '{}'::jsonb, 301),
('catalog-bge-m3', 'BGE M3', 'bge-m3', '["baai/bge-m3"]'::jsonb, 'embedding', '{}'::jsonb, 302),
('catalog-bge-reranker-v2-m3', 'BGE Reranker V2 M3', 'bge-reranker-v2-m3', '["baai/bge-reranker-v2-m3"]'::jsonb, 'rerank', '{}'::jsonb, 400),
('catalog-rerank-v3-5', 'Rerank V3.5', 'rerank-v3.5', '["cohere/rerank-v3.5"]'::jsonb, 'rerank', '{}'::jsonb, 401),
('catalog-whisper-1', 'Whisper 1', 'whisper-1', '["openai/whisper-1"]'::jsonb, 'audio', '{}'::jsonb, 500),
('catalog-gpt-4o-mini-transcribe', 'GPT-4o Mini Transcribe', 'gpt-4o-mini-transcribe', '["openai/gpt-4o-mini-transcribe"]'::jsonb, 'audio', '{}'::jsonb, 501),
('catalog-tts-1', 'TTS 1', 'tts-1', '["openai/tts-1"]'::jsonb, 'audio', '{}'::jsonb, 502);
--> statement-breakpoint
UPDATE "models" AS "model"
SET "catalog_id" = "catalog"."id"
FROM "model_catalog" AS "catalog"
WHERE "model"."catalog_id" LIKE 'catalog-%-generic'
	AND (
		lower("catalog"."canonical_model_id") = lower("model"."name")
		OR EXISTS (
			SELECT 1 FROM jsonb_array_elements_text("catalog"."aliases") AS "alias"("value")
			WHERE lower("alias"."value") = lower("model"."name")
		)
	);
