-- Model catalog sync generated from a reviewed local snapshot.
-- source-sha256: d6240c1930ea357be047ea7488805e57d06e1d7dc274900723baf86d0146df54

UPDATE "model_catalog"
SET
  "capabilities" = ("capabilities" - 'vision'),
  "updated_at" = now()
WHERE "canonical_model_id" = 'glm-5.2'
  AND (
    "capabilities" IS DISTINCT FROM ("capabilities" - 'vision')
  );
--> statement-breakpoint
UPDATE "model_catalog"
SET
  "capabilities" = (((("capabilities" - 'reasoning') - 'reasoningEffort') - 'thinkingFormat') - 'thinkingLevelMap'),
  "updated_at" = now()
WHERE "canonical_model_id" = 'kimi-k2'
  AND (
    "capabilities" IS DISTINCT FROM (((("capabilities" - 'reasoning') - 'reasoningEffort') - 'thinkingFormat') - 'thinkingLevelMap')
  );
