-- docs/PRD-image-gen-usd-estimate.md
-- Job stores provider USD; catalog converts to نیوو at read time.
-- Idempotent. Does not drop estimatedImageGenCreditCost (later migration).
ALTER TABLE "ai_models"
  ADD COLUMN IF NOT EXISTS "estimatedImageGenCostUsd" DOUBLE PRECISION;
