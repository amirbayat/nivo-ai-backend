-- Kling 3.0 Motion Control: Kie rejects mode=std/pro ("not within the range of allowed options").
-- Official enum is 720p | 1080p (docs.kie.ai/market/kling/motion-control-v3 example + kie.ai playground).
--
-- This is a DATA fix on kie_video_models.inputFields, not a schema change.
-- Re-running prisma/seeds/kie-video-models.seed.ts will NOT update existing rows
-- (that seed upserts with update: {} so admin/panel edits survive).
--
-- Production (Hamravesh Postgres): run this SQL yourself, then no backend redeploy is required
-- because the video-edit form reads inputFields from DB. Optional equivalent without SQL:
-- admin panel → kie-video-models → Kling 3.0 Motion Control → edit the mode enum options.
--
-- Idempotent: no-op if this row is already on 720p/1080p.

BEGIN;

UPDATE "kie_video_models"
SET
  "inputFields" = jsonb_set(
    "inputFields"::jsonb,
    '{fields}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'key' = 'mode' THEN
            jsonb_set(
              elem,
              '{options}',
              '[{"value":"720p","label":"720p"},{"value":"1080p","label":"1080p"}]'::jsonb
            )
          ELSE elem
        END
        ORDER BY ord
      )
      FROM jsonb_array_elements("inputFields"::jsonb->'fields') WITH ORDINALITY AS t(elem, ord)
    )
  ),
  "pricingNote" = replace(
    COALESCE("pricingNote", ''),
    'mode(std=720p/pro=1080p)',
    'mode(720p/1080p)'
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE slug = 'kling-3.0/motion-control'
  AND "inputFields" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("inputFields"::jsonb->'fields') AS f
    WHERE f->>'key' = 'mode'
      AND f->'options' @> '[{"value":"std"}]'::jsonb
  );

COMMIT;
