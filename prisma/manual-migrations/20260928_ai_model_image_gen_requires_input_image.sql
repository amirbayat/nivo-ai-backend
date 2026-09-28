-- رفع ارور OpenRouter "Recraft: input_references must have between 1 and 10 items" —
-- بعضی مدل‌های مسیر /images (مثل recraft-v4-styles-pro) بدون عکس ورودی اصلاً کار نمی‌کنند.
-- این فلگ به بک‌اند اجازه می‌دهد قبل از فراخوانی provider، این حالت را با یک خطای فارسی روشن
-- رد کند به‌جای فرستادن یک درخواست محکوم‌به‌شکست.
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "imageGenRequiresInputImage" BOOLEAN NOT NULL DEFAULT false;
