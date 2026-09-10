import { BadRequestException } from '@nestjs/common';
import type { FieldCondition, InputFieldsSchema, KieField } from './input-fields.schema';

// لایه‌ی عمومی معماری data-driven — طرف‌مقابل input-fields.schema.ts (که فقط شکل توصیفی
// مدل را تعریف می‌کند). این فایل سه چیز را عمومی (نه هاردکد به‌ازای هر مدل) پیاده می‌کند:
//   ۱) evaluateCondition — یک زبان مشترک برای visibleWhen/requiredWhen/allowedOnlyWhen/...
//   ۲) validateInputValues — جایگزین بخش model-domain فعلی validateAgainstMode
//   ۳) buildGenericKiePayload — جایگزین ۵ تابع buildXInput دستی در video-edit.processor.ts
// دیسپچر (video-edit.service.ts/video-edit.processor.ts) تصمیم می‌گیرد کِی این‌ها صدا زده
// شوند: فقط وقتی KieVideoModel.inputFields غیر-null است؛ در غیر این صورت مسیر قدیمی دست‌نخورده باقی می‌ماند.

// شکل مقداری که فرانت به ازای هر field.key در valuesJson می‌فرستد — به نوع فیلد بستگی دارد:
//   text/enum          → string
//   boolean            → boolean
//   number/duration    → number (duration: وقتی sentinel/omit فعال نشده)
//   image/audio        → string (کلید MinIO از آپلود قبلی)
//   imageArray/audioArray → string[]
//   video              → { key: string; windowStartSec?: number; windowEndSec?: number }
//   videoArray         → string[] (کلید‌های MinIO؛ بدون پنجره‌ی جداگانه)
//   elementGroup       → { name: string; imageKey?: string; videoKey?: string; audioKey?: string }[]
//   shotGroup          → { prompt: string; durationSec?: number }[]
//   derivedBoolean     → هرگز از کاربر نمی‌آید، همیشه محاسبه می‌شود
export type FieldValues = Record<string, unknown>;

export interface VideoFieldSubmission {
  key: string;
  windowStartSec?: number;
  windowEndSec?: number;
}

export interface ElementMemberSubmission {
  name: string;
  imageKey?: string;
  videoKey?: string;
  audioKey?: string;
}

export interface ShotSubmission {
  prompt: string;
  durationSec?: number;
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function evaluateCondition(
  condition: FieldCondition,
  values: FieldValues,
): boolean {
  switch (condition.kind) {
    case 'fieldPresent':
      return isPresent(values[condition.fieldKey!]);
    case 'fieldAbsent':
      return !isPresent(values[condition.fieldKey!]);
    case 'fieldEquals':
      return values[condition.fieldKey!] === condition.value;
    case 'and':
      return (condition.all ?? []).every((c) => evaluateCondition(c, values));
    case 'or':
      return (condition.any ?? []).some((c) => evaluateCondition(c, values));
    default:
      return false;
  }
}

function isFieldVisible(field: KieField, values: FieldValues): boolean {
  return !field.visibleWhen || evaluateCondition(field.visibleWhen, values);
}

function isFieldRequired(field: KieField, values: FieldValues): boolean {
  if (field.required) return true;
  return !!field.requiredWhen && evaluateCondition(field.requiredWhen, values);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// تعمیم pickClosestFixedDuration فعلی video-edit.processor.ts — برای هر فیلد duration با
// mode:fixedList و snapToNearestAllowed:true (نه فقط Wan V2V)
function pickClosest(options: number[], target: number): number {
  if (!options.length) return target;
  return options.reduce((closest, v) =>
    Math.abs(v - target) < Math.abs(closest - target) ? v : closest,
  );
}

// ============================== Validation ==============================

// جایگزین عمومی بخش model-domain فعلی VideoEditService.validateAgainstMode. چک‌های
// امنیتی/فرمت فایل (magic bytes، حجم) در video-edit.service.ts زیرلایه‌ی این باقی می‌مانند —
// اینجا فقط قوانین «کدام فیلد لازم/مجاز است» طبق خودِ inputFields JSON بررسی می‌شود.
export function validateInputValues(
  schema: InputFieldsSchema,
  values: FieldValues,
): void {
  for (const field of schema.fields) {
    if (field.type === 'derivedBoolean') continue;
    const visible = isFieldVisible(field, values);
    const raw = values[field.key];

    if (!visible) {
      if (isPresent(raw)) {
        throw new BadRequestException(
          `فیلد «${field.label}» در این حالت مجاز نیست`,
        );
      }
      continue;
    }

    if (field.allowedOnlyWhen && isPresent(raw) && !evaluateCondition(field.allowedOnlyWhen, values)) {
      throw new BadRequestException(`فیلد «${field.label}» در این حالت مجاز نیست`);
    }

    const required = isFieldRequired(field, values);
    if (required && !isPresent(raw)) {
      throw new BadRequestException(`فیلد «${field.label}» اجباری است`);
    }
    if (!isPresent(raw)) continue;

    switch (field.type) {
      case 'number': {
        const n = raw as number;
        if (typeof n !== 'number' || Number.isNaN(n)) {
          throw new BadRequestException(`فیلد «${field.label}» باید عدد باشد`);
        }
        if (field.min != null && n < field.min) {
          throw new BadRequestException(`فیلد «${field.label}» نباید کمتر از ${field.min} باشد`);
        }
        if (field.max != null && n > field.max) {
          throw new BadRequestException(`فیلد «${field.label}» نباید بیشتر از ${field.max} باشد`);
        }
        break;
      }
      case 'enum': {
        const allowed = field.options.map((o) => o.value);
        if (!allowed.includes(String(raw))) {
          throw new BadRequestException(`مقدار فیلد «${field.label}» نامعتبر است`);
        }
        break;
      }
      case 'imageArray': {
        const arr = raw as string[];
        if (field.minCount != null && arr.length < field.minCount) {
          throw new BadRequestException(`فیلد «${field.label}» به حداقل ${field.minCount} مورد نیاز دارد`);
        }
        if (field.maxCount != null && arr.length > field.maxCount) {
          throw new BadRequestException(`فیلد «${field.label}» حداکثر ${field.maxCount} مورد می‌پذیرد`);
        }
        break;
      }
      case 'video': {
        const v = raw as VideoFieldSubmission;
        if (!v.key) throw new BadRequestException(`فیلد «${field.label}» نامعتبر است`);
        if (field.trim?.enabled) {
          if (v.windowStartSec == null || v.windowEndSec == null) {
            throw new BadRequestException(`پنجره‌ی شروع/پایان فیلد «${field.label}» اجباری است`);
          }
          const width = v.windowEndSec - v.windowStartSec;
          if (width <= 0) {
            throw new BadRequestException(`پنجره‌ی فیلد «${field.label}» نامعتبر است`);
          }
          if (width > field.trim.maxWindowSec) {
            throw new BadRequestException(
              `پنجره‌ی فیلد «${field.label}» نباید بیشتر از ${field.trim.maxWindowSec} ثانیه باشد`,
            );
          }
        }
        break;
      }
      case 'elementGroup': {
        const arr = raw as ElementMemberSubmission[];
        if (arr.length < field.minCount) {
          throw new BadRequestException(`فیلد «${field.label}» به حداقل ${field.minCount} عنصر نیاز دارد`);
        }
        if (arr.length > field.maxCount) {
          throw new BadRequestException(`فیلد «${field.label}» حداکثر ${field.maxCount} عنصر می‌پذیرد`);
        }
        for (const member of arr) {
          if (!member.name) {
            throw new BadRequestException(`نام همه‌ی عناصر «${field.label}» اجباری است`);
          }
        }
        break;
      }
      case 'shotGroup': {
        const arr = raw as ShotSubmission[];
        if (arr.length < field.minShots) {
          throw new BadRequestException(`فیلد «${field.label}» به حداقل ${field.minShots} شات نیاز دارد`);
        }
        if (arr.length > field.maxShots) {
          throw new BadRequestException(`فیلد «${field.label}» حداکثر ${field.maxShots} شات می‌پذیرد`);
        }
        for (const shot of arr) {
          if (!shot.prompt) {
            throw new BadRequestException('پرامپت همه‌ی شات‌ها اجباری است');
          }
        }
        break;
      }
      default:
        break;
    }
  }

  for (const group of schema.exclusivityGroups ?? []) {
    const presentCount = group.fieldKeys.filter((k) => isPresent(values[k])).length;
    if (group.atLeastOneRequired && presentCount === 0) {
      throw new BadRequestException('حداقل یکی از فیلدهای این گروه باید پر شود');
    }
    if (group.atMostOne && presentCount > 1) {
      throw new BadRequestException('فقط یکی از فیلدهای این گروه می‌تواند پر شود');
    }
  }
}

// ========================= Duration resolution =========================

// معادل عمومی فرض فعلی preflight (video-edit.service.ts: dto.videoKey ? window : config
// fixed) — برای مدل‌های data-driven، duration از خودِ schema/values به‌دست می‌آید، نه از
// VideoEditConfig سراسری (هر مدل default خودش را در inputFields دارد).
export function resolveEffectiveDurationSec(
  schema: InputFieldsSchema,
  values: FieldValues,
  fallbackReferenceDurationSec?: number,
): number {
  const durationField = schema.fields.find((f) => f.type === 'duration');
  if (!durationField) return fallbackReferenceDurationSec ?? 4;

  if (durationField.autoSentinel && evaluateCondition(durationField.autoSentinel.triggerWhen, values)) {
    return fallbackReferenceDurationSec ?? durationField.default;
  }
  if (durationField.omitWhen && evaluateCondition(durationField.omitWhen, values)) {
    return fallbackReferenceDurationSec ?? durationField.default;
  }
  const raw = values[durationField.key];
  return typeof raw === 'number' ? raw : durationField.default;
}

// ============================== Payload build ==============================

export interface MediaUploader {
  uploadOne(storageKey: string): Promise<string>;
  uploadMany(storageKeys: string[]): Promise<string[]>;
}

// جایگزین عمومی ۵ تابع buildXInput دستی — برای مدل‌هایی که KieVideoModel.inputFields
// غیر-null دارند. آپلود فایل موقت به Kie (uploader) دقیقاً همان uploadRef/uploadRefs فعلی
// video-edit.processor.ts است، فقط پشت یک اینترفیس عمومی تا این فایل به Storage/KieProvider
// وابسته نباشد.
export async function buildGenericKiePayload(
  schema: InputFieldsSchema,
  values: FieldValues,
  uploader: MediaUploader,
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {};

  for (const field of schema.fields) {
    if (field.type === 'derivedBoolean') continue;
    if (!isFieldVisible(field, values)) continue;

    const raw = values[field.key];
    const omitWhenEmpty = field.omitWhenEmpty ?? true;
    if (!isPresent(raw) && field.type !== 'duration') {
      if (omitWhenEmpty) continue;
    }

    switch (field.type) {
      case 'text':
      case 'boolean': {
        if (!isPresent(raw)) continue;
        payload[field.kieField] = raw;
        break;
      }
      case 'number': {
        if (!isPresent(raw)) continue;
        payload[field.kieField] = raw;
        break;
      }
      case 'enum': {
        if (!isPresent(raw)) continue;
        payload[field.kieField] =
          field.wireValueType === 'number' ? Number(raw) : String(raw);
        break;
      }
      case 'duration': {
        let value: number;
        if (field.autoSentinel && evaluateCondition(field.autoSentinel.triggerWhen, values)) {
          value = field.autoSentinel.value;
        } else if (field.omitWhen && evaluateCondition(field.omitWhen, values)) {
          continue; // مثل Omni: duration وقتی ویدیو داده شده کلاً حذف می‌شود
        } else {
          value = typeof raw === 'number' ? raw : field.default;
          if (field.mode === 'fixedList' && field.fixedOptions?.length && field.snapToNearestAllowed) {
            value = pickClosest(field.fixedOptions, value);
          } else if (field.mode === 'freeRange' && field.range) {
            value = clamp(value, field.range.min, field.range.max);
          }
        }
        payload[field.kieField] = field.wireValueType === 'string' ? String(value) : value;
        break;
      }
      case 'image':
      case 'audio': {
        if (!isPresent(raw)) continue;
        payload[field.kieField] = await uploader.uploadOne(raw as string);
        break;
      }
      case 'imageArray':
      case 'audioArray': {
        if (!isPresent(raw)) continue;
        payload[field.kieField] = await uploader.uploadMany(raw as string[]);
        break;
      }
      case 'video': {
        if (!isPresent(raw)) continue;
        const v = raw as VideoFieldSubmission;
        const url = await uploader.uploadOne(v.key);
        if (field.wireShape === 'objectWithWindow' && field.objectWindowKeys) {
          const keys = field.objectWindowKeys;
          payload[field.kieField] = [
            {
              [keys.url]: url,
              [keys.start]: v.windowStartSec ?? 0,
              [keys.end]: v.windowEndSec ?? field.trim?.maxWindowSec ?? 8,
            },
          ];
        } else if (field.wireShape === 'arrayOfUrl') {
          payload[field.kieField] = [url];
        } else {
          payload[field.kieField] = url;
        }
        break;
      }
      case 'videoArray': {
        if (!isPresent(raw)) continue;
        const keys = raw as string[];
        payload[field.kieField] = await uploader.uploadMany(keys);
        break;
      }
      case 'elementGroup': {
        if (!isPresent(raw)) continue;
        const members = raw as ElementMemberSubmission[];
        payload[field.kieField] = await Promise.all(
          members.map(async (m) => {
            const item: Record<string, unknown> = { [field.nameKieField]: m.name };
            if (m.imageKey) item.image = await uploader.uploadOne(m.imageKey);
            if (m.videoKey) item.video = await uploader.uploadOne(m.videoKey);
            if (m.audioKey) item.audio = await uploader.uploadOne(m.audioKey);
            return item;
          }),
        );
        break;
      }
      case 'shotGroup': {
        if (!isPresent(raw)) continue;
        const shots = raw as ShotSubmission[];
        payload[field.kieField] = shots.map((s) => {
          const item: Record<string, unknown> = {
            [field.wireBehavior.itemPromptKey]: s.prompt,
          };
          if (field.wireBehavior.itemDurationKey && s.durationSec != null) {
            item[field.wireBehavior.itemDurationKey] = s.durationSec;
          }
          return item;
        });
        break;
      }
      default:
        break;
    }
  }

  // derivedBoolean بعد از همه‌ی فیلدهای واقعی محاسبه می‌شود — چون به طول یک آرایه‌ی دیگر
  // (مثلاً shots) وابسته است، نه به یک مقدار مستقیم کاربر
  for (const field of schema.fields) {
    if (field.type !== 'derivedBoolean') continue;
    if (!isFieldVisible(field, values)) continue;
    const source = values[field.derivedFromFieldKey];
    const length = Array.isArray(source) ? source.length : 0;
    payload[field.kieField] = length > field.threshold;
  }

  return payload;
}
