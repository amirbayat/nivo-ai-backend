-- تصمیم محصول: همه‌ی سبک‌های تولید عکس استودیو یکسان ۱۶ نیوو، و فعلاً فقط مدل gpt-image-2
-- preferredModel روی همه‌ی این ردیف‌ها ست می‌شود تا صرف‌نظر از استخر AiModel نوع IMAGE_GEN
-- (که ممکن است مدل‌های دیگری هم برای تولید عکس چت معمولی داشته باشد)، استودیو همیشه دقیقاً
-- همین مدل را استفاده کند (discovery-generation.service.ts resolveModel — preferredModel
-- همیشه اولویت دارد). پیش‌نیاز: ردیف AiModel با name='openai/gpt-image-2'، modelType=IMAGE_GEN
-- و isActive=true باید از قبل در پنل ادمین (Models) ساخته شده باشد، وگرنه resolveModel به‌طور
-- خاموش به ارزان‌ترین/اولین مدل فعال دیگر IMAGE_GEN برمی‌گردد.
UPDATE "creative_prompts" SET
  "creditCost" = 16,
  "preferredModel" = 'openai/gpt-image-2'
WHERE "outputType" = 'IMAGE';
