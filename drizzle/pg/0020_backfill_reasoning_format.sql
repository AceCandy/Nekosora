-- 0015 扩展型号与 0013 存量型号中,部分 reasoning=true 的模型缺 thinkingFormat,
-- 导致 applyReasoningToCompatibleBody / buildReasoningProviderOptions 早返回,
-- 推理档位(含 off)完全不向上游发送参数,出现"显示关但仍在思考"。
-- 按 alias 前缀映射的上游协议,幂等回填 thinkingFormat。仅 PG。
UPDATE "model_catalog"
SET "capabilities" = jsonb_set("capabilities", '{thinkingFormat}', '"openrouter"'::jsonb)
WHERE "canonical_model_id" IN ('step-3.7-flash', 'mimo-v2.5', 'mimo-v2.5-pro', 'qwen3-235b-a22b', 'qwen3-32b');

UPDATE "model_catalog"
SET "capabilities" = jsonb_set("capabilities", '{thinkingFormat}', '"openai"'::jsonb)
WHERE "canonical_model_id" IN ('gpt-5-chat', 'o3', 'o4-mini');

UPDATE "model_catalog"
SET "capabilities" = jsonb_set("capabilities", '{thinkingFormat}', '"anthropic"'::jsonb)
WHERE "canonical_model_id" IN ('claude-sonnet-4', 'claude-opus-4');

UPDATE "model_catalog"
SET "capabilities" = jsonb_set("capabilities", '{thinkingFormat}', '"google"'::jsonb)
WHERE "canonical_model_id" IN ('gemini-2.5-pro', 'gemini-2.5-flash');

UPDATE "model_catalog"
SET "capabilities" = jsonb_set("capabilities", '{thinkingFormat}', '"zai"'::jsonb)
WHERE "canonical_model_id" IN ('glm-4.5', 'glm-4.5v');

UPDATE "model_catalog"
SET "capabilities" = jsonb_set("capabilities", '{thinkingFormat}', '"deepseek"'::jsonb)
WHERE "canonical_model_id" IN ('kimi-k2', 'deepseek-reasoner');
