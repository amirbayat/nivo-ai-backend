-- R1.1: admin audit log. Additive and idempotent. Safe to run before deploy.
CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id"         TEXT         NOT NULL,
  "adminId"    TEXT         NOT NULL,
  "action"     TEXT         NOT NULL,
  "targetType" TEXT         NOT NULL,
  "targetId"   TEXT         NOT NULL,
  "before"     JSONB,
  "after"      JSONB,
  "reason"     TEXT         NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "admin_audit_logs_targetType_targetId_createdAt_idx"
  ON "admin_audit_logs" ("targetType", "targetId", "createdAt");
CREATE INDEX IF NOT EXISTS "admin_audit_logs_adminId_createdAt_idx"
  ON "admin_audit_logs" ("adminId", "createdAt");

-- Verify (expect 1 row):
-- SELECT to_regclass('admin_audit_logs');
