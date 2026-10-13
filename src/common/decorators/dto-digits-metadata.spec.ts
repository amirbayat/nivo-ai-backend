import 'reflect-metadata';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
// storage داخلی class-transformer تایپ عمومی ندارد
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
const { defaultMetadataStorage } = require('class-transformer/cjs/storage');
import { TransformationType } from 'class-transformer';
import { getMetadataStorage } from 'class-validator';

// PRD-nivo-sales-unified.md تسک 0.14(۳) — تست متادیتا: هر فیلد DTO که اعتبارسنجی عددی/رقمی
// دارد (IsInt/IsNumber/IsNumberString/Matches با \d یا [0-9]) باید @EnDigits/@ToNumber (یا هر
// Transform دیگری که ارقام را نرمال می‌کند) داشته باشد، وگرنه ارقام فارسی رد می‌شوند.
// فیلدی که عمداً نباید نرمال شود در EXEMPT با دلیل ثبت شود.
const EXEMPT: Record<string, string> = {
  // 'ClassName.field': 'دلیل'
};

function listDtoFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listDtoFiles(p));
    else if (name.endsWith('.dto.ts')) out.push(p);
  }
  return out;
}

const NUMERIC_VALIDATORS = new Set([
  'isInt',
  'isNumber',
  'isNumberString',
  'isPositive',
  'min',
  'max',
]);

describe('DTO digit normalization metadata [0.14]', () => {
  const files = listDtoFiles(join(__dirname, '..', '..'));

  it('همه‌ی فیلدهای عددی/رقمی DTOها نرمال‌ساز ارقام دارند', () => {
    const storage = getMetadataStorage();
    const missing: string[] = [];
    for (const file of files) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(file) as Record<string, unknown>;
      for (const exp of Object.values(mod)) {
        if (typeof exp !== 'function') continue;
        const metas = storage.getTargetValidationMetadatas(
          exp as never,
          undefined as never,
          false,
          false,
        );
        const byProp = new Map<string, typeof metas>();
        for (const m of metas) {
          byProp.set(m.propertyName, [
            ...(byProp.get(m.propertyName) ?? []),
            m,
          ]);
        }
        for (const [prop, ms] of byProp) {
          const numeric = ms.some((m) => {
            const type = String(m.name ?? m.type ?? '');
            if (NUMERIC_VALIDATORS.has(type)) return true;
            if (type === 'matches') {
              const re = String(m.constraints?.[0] ?? '');
              return /\\d|\[0-9\]/.test(re);
            }
            return false;
          });
          if (!numeric) continue;
          const hasTransform =
            defaultMetadataStorage.findTransformMetadatas(
              exp as never,
              prop,
              TransformationType.PLAIN_TO_CLASS,
            ).length > 0;
          const key = `${(exp as { name: string }).name}.${prop}`;
          if (!hasTransform && !EXEMPT[key])
            missing.push(`${key}  (${file.split('/src/')[1]})`);
        }
      }
    }
    expect(missing.sort()).toEqual([]);
  });
});
