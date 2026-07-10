-- پایگاه دانش فروش برای بازیابی معنایی (RAG) — docs/PRD-sales-kb-rag-and-plan-context.md بخش الف.
-- فقط CREATE (بدون DROP/ALTER روی جدول موجود) — ایمن برای اجرا روی پروداکشن.
-- بعد از اجرا، ادمین می‌تواند از تب «پایگاه دانش» در /admin/sales-bot نمونه اضافه/آپلود کند.

-- CreateEnum
CREATE TYPE "SalesKbKind" AS ENUM ('EXAMPLE', 'OBJECTION', 'FAQ', 'PERSONA_GUIDANCE');

-- CreateTable
CREATE TABLE "sales_kb_entries" (
    "id" TEXT NOT NULL,
    "kind" "SalesKbKind" NOT NULL,
    "label" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "userMessage" TEXT NOT NULL,
    "assistantReply" TEXT NOT NULL,
    "note" TEXT,
    "embedding" JSONB,
    "embeddingModel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_kb_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_kb_entries_kind_idx" ON "sales_kb_entries"("kind");

