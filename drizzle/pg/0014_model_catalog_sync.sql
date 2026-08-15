-- Model catalog sync generated from a reviewed local snapshot.
-- source-sha256: 79b54bc0f47849731407d170883de412d1e6b823ceed1d10b7203d0ddc277d70

UPDATE "model_catalog"
SET
  "capabilities" = ("capabilities" || '{"thinkingLevelMap":{"high":"high","low":"low","max":"max","medium":null,"minimal":null}}'::jsonb),
  "updated_at" = now()
WHERE "canonical_model_id" = 'deepseek-v4-flash'
  AND (
    "capabilities" IS DISTINCT FROM ("capabilities" || '{"thinkingLevelMap":{"high":"high","low":"low","max":"max","medium":null,"minimal":null}}'::jsonb)
  );
--> statement-breakpoint
UPDATE "model_catalog"
SET
  "context_window" = 202752,
  "max_output_tokens" = 128000,
  "updated_at" = now()
WHERE "canonical_model_id" = 'glm-5.1'
  AND (
    "context_window" IS DISTINCT FROM 202752
    OR "max_output_tokens" IS DISTINCT FROM 128000
  );
