import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

// شکل داده‌محور ورودی هر مدل ویدیوی Kie.ai — جایگزین تدریجی enum پنج‌مقداری KieInputSchema +
// ۵ تابع buildXInput دستی در video-edit.processor.ts (هندآف docs/RESEARCH-kie-video-models-catalog.md
// بخش ۰.۲). null روی KieVideoModel.inputFields یعنی «هنوز معماری قدیمی»؛ یک شیء معتبر طبق این
// schema یعنی «پردازشگر از generic payload-builder و فرانت از فرم‌رندرر عمومی استفاده کند».
//
// طراحی نهایی این شکل حاصل یک نشست تحقیق/طراحی جدا بود (بررسی همه‌ی الگوهای فیلد در ۷۱ مدل
// واقعی Kie.ai) — جزئیات/مثال هر نوع در پلن پیاده‌سازی همین فیچر مستند شده.

const fieldKey = z.string().min(1);

interface FieldConditionShape {
  kind: 'fieldPresent' | 'fieldAbsent' | 'fieldEquals' | 'and' | 'or';
  fieldKey?: string;
  value?: string | number | boolean;
  all?: FieldConditionShape[];
  any?: FieldConditionShape[];
}

// شرط قابل‌استفاده‌ی مجدد برای visibleWhen/requiredWhen/allowedOnlyWhen/autoSentinel.triggerWhen/omitWhen —
// همه یک زبان مشترک دارند تا هم بک‌اند (validation/payload-builder) و هم فرانت (نمایش/الزام فیلد)
// دقیقاً یک منطق را evaluate کنند، نه دو پیاده‌سازی موازی
export const FieldConditionSchema: z.ZodType<FieldConditionShape> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal('fieldPresent'), fieldKey }),
    z.object({ kind: z.literal('fieldAbsent'), fieldKey }),
    z.object({
      kind: z.literal('fieldEquals'),
      fieldKey,
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
    z.object({ kind: z.literal('and'), all: z.array(FieldConditionSchema).min(1) }),
    z.object({ kind: z.literal('or'), any: z.array(FieldConditionSchema).min(1) }),
  ]),
);

const baseFieldShape = {
  key: fieldKey, // internal id، پایدار حتی اگر Kie بعداً اسم فیلدش را عوض کند
  kieField: fieldKey, // اسم دقیق فیلد سمت Kie (مثلاً "last_frame_url")
  label: z.string().min(1),
  helpText: z.string().optional(),
  required: z.boolean(),
  order: z.number(),
  uiGroup: z.string().optional(),
  visibleWhen: FieldConditionSchema.optional(),
  requiredWhen: FieldConditionSchema.optional(),
  allowedOnlyWhen: FieldConditionSchema.optional(),
  omitWhenEmpty: z.boolean().optional(),
};

const TextFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('text'),
  multiline: z.boolean(),
  maxLength: z.number().int().positive().optional(),
  placeholder: z.string().optional(),
  semantic: z.enum(['mainPrompt', 'shotPrompt', 'characterDescription', 'generic']).optional(),
});

const BooleanFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('boolean'),
  default: z.boolean(),
  semantic: z.enum(['audioOutputToggle', 'generic']).optional(),
});

const NumberFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('number'),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  wireValueType: z.enum(['number', 'string']).optional(),
});

const optionSchema = z.object({ value: z.string(), label: z.string() });

const EnumFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('enum'),
  options: z.array(optionSchema).min(1),
  wireValueType: z.enum(['string', 'number']).optional(),
  semantic: z.enum(['aspectRatio', 'resolution', 'generic']).optional(),
  // Kling: رزولوشن‌های بالا به mode+aspect_ratio وابسته‌اند — به‌عنوان داده، نه کد
  optionsDependOn: z
    .object({
      fieldKeys: z.array(fieldKey).min(1),
      optionsByKey: z.record(z.string(), z.array(optionSchema)),
    })
    .optional(),
});

// تعمیم سنتینل‌های «مدت خودکار» (Seedance: duration:-1 یعنی هم‌طول ویدیوی مرجع؛
// wan/2-7-videoedit: duration:0 یعنی طول کامل ورودی؛ Omni: duration اصلاً omit می‌شود)
const DurationFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('duration'),
  mode: z.enum(['fixedList', 'freeRange']),
  fixedOptions: z.array(z.number()).optional(),
  snapToNearestAllowed: z.boolean().optional(), // تعمیم pickClosestFixedDuration فعلی
  range: z.object({ min: z.number(), max: z.number() }).optional(),
  wireValueType: z.enum(['number', 'string']),
  default: z.number(),
  autoSentinel: z.object({ value: z.number(), triggerWhen: FieldConditionSchema }).optional(),
  omitWhen: FieldConditionSchema.optional(),
});

const mediaBaseShape = {
  ...baseFieldShape,
  accept: z.array(z.string()).min(1),
  maxFileSizeBytes: z.number().int().positive().optional(),
  role: z.string().optional(), // برچسب معنایی: firstFrame/lastFrame/referenceImage/sourceVideoToEdit/avatarPhoto/motionVideo/...
};

const ImageFieldSchema = z.object({
  ...mediaBaseShape,
  type: z.enum(['image', 'imageArray']),
  maxCount: z.number().int().positive().optional(),
  minCount: z.number().int().nonnegative().optional(),
});

const objectWindowKeysSchema = z.object({ url: z.string().min(1), start: z.string().min(1), end: z.string().min(1) });

const VideoFieldSchema = z.object({
  ...mediaBaseShape,
  type: z.enum(['video', 'videoArray']),
  maxDurationSec: z.number().positive().optional(), // حداکثر طول کل فایل مبدأ آپلودی
  wireShape: z.enum(['scalarUrl', 'arrayOfUrl', 'objectWithWindow']),
  objectWindowKeys: objectWindowKeysSchema.optional(), // فقط برای wireShape=objectWithWindow (الگوی Omni: video_list:[{url,start,ends}])
  trim: z.object({ enabled: z.boolean(), maxWindowSec: z.number().positive() }).optional(),
});

const AudioFieldSchema = z.object({
  ...mediaBaseShape,
  type: z.enum(['audio', 'audioArray']),
  audioRole: z.enum(['reference', 'drivingRequired', 'drivingOptional']),
  maxDurationSec: z.number().positive().optional(),
  maxCount: z.number().int().positive().optional(),
});

// عضو یک elementGroup دقیقاً یکی از عکس/ویدیو/صدا را می‌گیرد (نه لزوماً همه)؛ فیلدهای هر کدام
// نسخه‌ی سبک‌شده‌ی همون media field است (بدون key/kieField/type مستقل، چون این‌ها زیرِ یک
// فیلد گروهی واحدند، نه فیلدهای مستقل با kieField خودشان)
const memberMediaShape = z
  .object({
    accept: z.array(z.string()).min(1),
    maxFileSizeBytes: z.number().int().positive(),
    maxDurationSec: z.number().positive(),
    minCount: z.number().int().nonnegative(),
    maxCount: z.number().int().positive(),
    wireShape: z.enum(['scalarUrl', 'arrayOfUrl', 'objectWithWindow']),
    audioRole: z.enum(['reference', 'drivingRequired', 'drivingOptional']),
  })
  .partial();

// Kling element-lock: کاراکتر/شیء ثابتی که با تگ "@name" داخل متن شات‌ها رفرنس می‌شود
const ElementGroupFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('elementGroup'),
  minCount: z.number().int().nonnegative(),
  maxCount: z.number().int().positive(),
  nameKieField: z.string().min(1),
  memberShape: z.object({
    imageField: memberMediaShape.optional(),
    videoField: memberMediaShape.optional(),
    audioField: memberMediaShape.optional(),
  }),
});

// Kling چندشات: چند {prompt, duration} که مدل خودش پشت‌سرهم رندر و یک ویدیوی پیوسته برمی‌گرداند —
// هیچ orchestration سمت نیوو نیست، فقط یک فیلد تکرارشونده در همون یک createTask
const ShotGroupFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('shotGroup'),
  minShots: z.number().int().positive(),
  maxShots: z.number().int().positive(),
  shotPromptField: z.object({
    multiline: z.boolean().optional(),
    maxLength: z.number().int().positive().optional(),
    required: z.boolean().optional(),
  }),
  shotDurationField: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      wireValueType: z.enum(['number', 'string']).optional(),
    })
    .optional(),
  wireBehavior: z.object({
    itemPromptKey: z.string().min(1),
    itemDurationKey: z.string().min(1).optional(),
  }),
  linkedElementFieldKey: fieldKey.optional(), // کدوم ElementGroupField لیست آتوکامپلیت @name را تامین می‌کند
});

// فیلد محاسبه‌شده که هرگز از کاربر پرسیده/رندر نمی‌شود (مثلاً multi_shots = shots.length > 1)
const DerivedBooleanFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('derivedBoolean'),
  derivedFromFieldKey: fieldKey,
  predicate: z.literal('arrayLengthGreaterThan'),
  threshold: z.number(),
});

export const KieFieldSchema = z.union([
  TextFieldSchema,
  BooleanFieldSchema,
  NumberFieldSchema,
  EnumFieldSchema,
  DurationFieldSchema,
  ImageFieldSchema,
  VideoFieldSchema,
  AudioFieldSchema,
  ElementGroupFieldSchema,
  ShotGroupFieldSchema,
  DerivedBooleanFieldSchema,
]);

const ExclusivityGroupSchema = z.object({
  id: z.string().min(1),
  fieldKeys: z.array(fieldKey).min(2),
  atLeastOneRequired: z.boolean(),
  atMostOne: z.boolean(),
});

const UiGroupSchema = z.object({ id: z.string().min(1), label: z.string().min(1), order: z.number() });

export const InputFieldsSchemaZod = z.object({
  version: z.literal(1),
  fields: z.array(KieFieldSchema).min(1),
  exclusivityGroups: z.array(ExclusivityGroupSchema).optional(),
  uiGroups: z.array(UiGroupSchema).optional(),
});

export type FieldCondition = FieldConditionShape;
export type KieField = z.infer<typeof KieFieldSchema>;
export type InputFieldsSchema = z.infer<typeof InputFieldsSchemaZod>;

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('؛ ');
}

// اعتبارسنجی کامل ساختاری، شامل چک تکراری‌نبودن key بین فیلدها (چون key هم شناسه‌ی داخلی
// state فرانت است هم کلید valuesJson سمت بک‌اند — تصادم اینجا باعث بی‌صداشدن یک فیلد می‌شود)
export function keepAspectRatioVisibleWithVideo(
  schema: InputFieldsSchema,
): InputFieldsSchema {
  const videoKeys = new Set(
    schema.fields
      .filter((f) => f.type === 'video' || f.type === 'videoArray')
      .map((f) => f.key),
  );
  if (videoKeys.size === 0) return schema;

  let changed = false;
  const fields = schema.fields.map((field) => {
    if (field.type !== 'enum' || field.semantic !== 'aspectRatio') return field;
    const hideVisible = hidesWhenVideoAbsent(field.visibleWhen, videoKeys);
    const hideAllowed = hidesWhenVideoAbsent(field.allowedOnlyWhen, videoKeys);
    if (!hideVisible && !hideAllowed) return field;
    changed = true;
    const next = { ...field };
    if (hideVisible) delete next.visibleWhen;
    if (hideAllowed) delete next.allowedOnlyWhen;
    return next;
  });
  return changed ? { ...schema, fields } : schema;
}

function hidesWhenVideoAbsent(
  condition: FieldCondition | undefined,
  videoKeys: Set<string>,
): boolean {
  if (!condition) return false;
  if (condition.kind === 'fieldAbsent') {
    return !!condition.fieldKey && videoKeys.has(condition.fieldKey);
  }
  if (condition.kind === 'and') {
    return (condition.all ?? []).some((c) => hidesWhenVideoAbsent(c, videoKeys));
  }
  if (condition.kind === 'or') {
    return (condition.any ?? []).every((c) => hidesWhenVideoAbsent(c, videoKeys));
  }
  return false;
}

export function parseInputFields(raw: unknown): InputFieldsSchema {
  const result = InputFieldsSchemaZod.safeParse(raw);
  if (!result.success) {
    throw new BadRequestException(`inputFields نامعتبر: ${formatZodError(result.error)}`);
  }
  const keys = result.data.fields.map((f) => f.key);
  const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  if (dupes.length > 0) {
    throw new BadRequestException(`inputFields نامعتبر: کلید(های) تکراری در fields: ${dupes.join('، ')}`);
  }
  return keepAspectRatioVisibleWithVideo(result.data);
}

// نسخه‌ی نرم برای مسیر ایمپورت اکسل — خطا را throw نمی‌کند، برای گزارش row-level برمی‌گرداند
export function safeParseInputFields(raw: unknown): { data?: InputFieldsSchema; error?: string } {
  try {
    return { data: parseInputFields(raw) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'inputFields نامعتبر' };
  }
}
