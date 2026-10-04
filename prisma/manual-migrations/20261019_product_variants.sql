-- docs/PRD-product-display-focus-and-variations.md §۴ (فاز ۱، §۴.۴) — سیستم عمومی واریانت
-- محصول (سایز/رنگ/حالت برگزاری). additive محض: محصول بدون این جدول‌ها (اکثریت امروز)
-- دست‌نخورده می‌ماند. optionValues روی jsonb است (نوع پیش‌فرض Prisma برای Json روی Postgres)
-- که از عملگر تساوی/مرتب‌سازی کامل پشتیبانی می‌کند، پس unique index ترکیبی زیر معتبر است.

CREATE TABLE "product_option_types" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "product_option_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_option_values" (
    "id" TEXT NOT NULL,
    "optionTypeId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "optionValues" JSONB NOT NULL,
    "priceOverride" INTEGER,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "sku" TEXT,
    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_option_types_productId_idx" ON "product_option_types"("productId");

CREATE INDEX "product_option_values_optionTypeId_idx" ON "product_option_values"("optionTypeId");

CREATE INDEX "product_variants_productId_idx" ON "product_variants"("productId");

CREATE UNIQUE INDEX "product_variants_productId_optionValues_key" ON "product_variants"("productId", "optionValues");

ALTER TABLE "product_option_types" ADD CONSTRAINT "product_option_types_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_optionTypeId_fkey" FOREIGN KEY ("optionTypeId") REFERENCES "product_option_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
