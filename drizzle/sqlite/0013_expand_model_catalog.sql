INSERT INTO `model_catalog` (`id`, `name`, `canonical_model_id`, `aliases`, `model_type`, `capabilities`, `sort_order`) VALUES
('catalog-gpt-5-chat', 'GPT-5 Chat', 'gpt-5-chat', '["openai/gpt-5-chat"]', 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}', 20),
('catalog-ling-flash-2', 'Ling Flash 2.0', 'ling-flash-2.0', '["inclusionai/ling-flash-2.0"]', 'chat', '{"systemPrompt":true}', 21),
('catalog-mimo-v2-5', 'MiMo V2.5', 'mimo-v2.5', '["xiaomi/mimo-v2.5"]', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}', 22),
('catalog-mimo-v2-5-pro', 'MiMo V2.5 Pro', 'mimo-v2.5-pro', '["xiaomi/mimo-v2.5-pro"]', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}', 23),
('catalog-step-3-7-flash', 'Step 3.7 Flash', 'step-3.7-flash', '["stepfun/step-3.7-flash"]', 'chat', '{"reasoning":true,"systemPrompt":true}', 24),
('catalog-gpt-4-1', 'GPT-4.1', 'gpt-4.1', '["openai/gpt-4.1"]', 'chat', '{"vision":true,"tools":true,"systemPrompt":true}', 30),
('catalog-gpt-4-1-mini', 'GPT-4.1 Mini', 'gpt-4.1-mini', '["openai/gpt-4.1-mini"]', 'chat', '{"vision":true,"tools":true,"systemPrompt":true}', 31),
('catalog-gpt-4o', 'GPT-4o', 'gpt-4o', '["openai/gpt-4o"]', 'chat', '{"vision":true,"tools":true,"systemPrompt":true}', 32),
('catalog-gpt-4o-mini', 'GPT-4o Mini', 'gpt-4o-mini', '["openai/gpt-4o-mini"]', 'chat', '{"vision":true,"tools":true,"systemPrompt":true}', 33),
('catalog-o3', 'OpenAI o3', 'o3', '["openai/o3"]', 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}', 34),
('catalog-o4-mini', 'OpenAI o4-mini', 'o4-mini', '["openai/o4-mini"]', 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}', 35),
('catalog-claude-sonnet-4', 'Claude Sonnet 4', 'claude-sonnet-4', '["anthropic/claude-sonnet-4","claude-sonnet-4-20250514"]', 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}', 40),
('catalog-claude-opus-4', 'Claude Opus 4', 'claude-opus-4', '["anthropic/claude-opus-4","claude-opus-4-20250514"]', 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}', 41),
('catalog-claude-3-5-haiku', 'Claude 3.5 Haiku', 'claude-3-5-haiku-latest', '["anthropic/claude-3.5-haiku","claude-3-5-haiku-20241022"]', 'chat', '{"vision":true,"tools":true,"systemPrompt":true}', 42),
('catalog-gemini-2-5-pro', 'Gemini 2.5 Pro', 'gemini-2.5-pro', '["google/gemini-2.5-pro"]', 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}', 50),
('catalog-gemini-2-5-flash', 'Gemini 2.5 Flash', 'gemini-2.5-flash', '["google/gemini-2.5-flash"]', 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}', 51),
('catalog-deepseek-chat', 'DeepSeek Chat', 'deepseek-chat', '["deepseek/deepseek-chat","deepseek-v3"]', 'chat', '{"tools":true,"systemPrompt":true}', 60),
('catalog-deepseek-reasoner', 'DeepSeek Reasoner', 'deepseek-reasoner', '["deepseek/deepseek-reasoner","deepseek-r1"]', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}', 61),
('catalog-qwen3-235b-a22b', 'Qwen3 235B A22B', 'qwen3-235b-a22b', '["qwen/qwen3-235b-a22b","qwen3-235b-a22b-instruct-2507"]', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}', 70),
('catalog-qwen3-32b', 'Qwen3 32B', 'qwen3-32b', '["qwen/qwen3-32b"]', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}', 71),
('catalog-qwen2-5-vl-72b', 'Qwen2.5 VL 72B', 'qwen2.5-vl-72b-instruct', '["qwen/qwen2.5-vl-72b-instruct"]', 'chat', '{"vision":true,"tools":true,"systemPrompt":true}', 72),
('catalog-glm-4-5', 'GLM 4.5', 'glm-4.5', '["zai/glm-4.5","zhipu/glm-4.5"]', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}', 80),
('catalog-glm-4-5v', 'GLM 4.5V', 'glm-4.5v', '["zai/glm-4.5v","zhipu/glm-4.5v"]', 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}', 81),
('catalog-kimi-k2', 'Kimi K2', 'kimi-k2', '["moonshot/kimi-k2","kimi-k2-0711-preview"]', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}', 90),
('catalog-moonshot-v1-8k', 'Moonshot V1 8K', 'moonshot-v1-8k', '["moonshot/moonshot-v1-8k"]', 'chat', '{"tools":true,"systemPrompt":true}', 91),
('catalog-gpt-image-1', 'GPT Image 1', 'gpt-image-1', '["openai/gpt-image-1"]', 'image', '{"imageGeneration":true}', 200),
('catalog-dall-e-3', 'DALL-E 3', 'dall-e-3', '["openai/dall-e-3"]', 'image', '{"imageGeneration":true}', 201),
('catalog-flux-1-1-pro', 'FLUX 1.1 Pro', 'flux-1.1-pro', '["black-forest-labs/flux-1.1-pro"]', 'image', '{"imageGeneration":true}', 202),
('catalog-cogview-4', 'CogView 4', 'cogview-4', '["zai/cogview-4","zhipu/cogview-4"]', 'image', '{"imageGeneration":true}', 203),
('catalog-text-embedding-3-small', 'Text Embedding 3 Small', 'text-embedding-3-small', '["openai/text-embedding-3-small"]', 'embedding', '{}', 300),
('catalog-text-embedding-3-large', 'Text Embedding 3 Large', 'text-embedding-3-large', '["openai/text-embedding-3-large"]', 'embedding', '{}', 301),
('catalog-bge-m3', 'BGE M3', 'bge-m3', '["baai/bge-m3"]', 'embedding', '{}', 302),
('catalog-bge-reranker-v2-m3', 'BGE Reranker V2 M3', 'bge-reranker-v2-m3', '["baai/bge-reranker-v2-m3"]', 'rerank', '{}', 400),
('catalog-rerank-v3-5', 'Rerank V3.5', 'rerank-v3.5', '["cohere/rerank-v3.5"]', 'rerank', '{}', 401),
('catalog-whisper-1', 'Whisper 1', 'whisper-1', '["openai/whisper-1"]', 'audio', '{}', 500),
('catalog-gpt-4o-mini-transcribe', 'GPT-4o Mini Transcribe', 'gpt-4o-mini-transcribe', '["openai/gpt-4o-mini-transcribe"]', 'audio', '{}', 501),
('catalog-tts-1', 'TTS 1', 'tts-1', '["openai/tts-1"]', 'audio', '{}', 502);
--> statement-breakpoint
UPDATE `models`
SET `catalog_id` = (
	SELECT `catalog`.`id`
	FROM `model_catalog` AS `catalog`
	WHERE lower(`catalog`.`canonical_model_id`) = lower(`models`.`name`)
		OR EXISTS (
			SELECT 1 FROM json_each(`catalog`.`aliases`) AS `alias`
			WHERE lower(`alias`.`value`) = lower(`models`.`name`)
		)
	ORDER BY `catalog`.`sort_order`, `catalog`.`id`
	LIMIT 1
)
WHERE `catalog_id` LIKE 'catalog-%-generic'
	AND EXISTS (
		SELECT 1
		FROM `model_catalog` AS `catalog`
		WHERE lower(`catalog`.`canonical_model_id`) = lower(`models`.`name`)
			OR EXISTS (
				SELECT 1 FROM json_each(`catalog`.`aliases`) AS `alias`
				WHERE lower(`alias`.`value`) = lower(`models`.`name`)
			)
	);
