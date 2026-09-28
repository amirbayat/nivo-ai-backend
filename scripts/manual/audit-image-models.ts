// اسکریپت یک‌بارمصرف read-only: چک می‌کند کدام مدل‌های عکس OpenRouter در دیتابیس (AiModel)
// فلگ imageGenUseDirectApi اشتباه دارند — یعنی با has_chat_completions واقعی کاتالوگ زنده‌ی
// OpenRouter (GET /api/v1/models، بدون نیاز به کلید) مغایرت دارند. فقط می‌خواند، هیچ رکوردی را
// تغییر نمی‌دهد — تصحیح واقعی باید دستی از پنل ادمین انجام شود (docs/PRD-image-gen-pricing-and-
// credit-fix.md §۱۱ — Muse Image/Seedream/Krea/Riverflow/Flux.2 هیچ‌وقت تک‌به‌تک تست نشدند).

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter });

interface OpenRouterModel {
  id: string;
  architecture?: {
    output_modalities?: string[];
  };
  // فیلد واقعی کاتالوگ برای تشخیص chat/completions-capable بودن
  has_chat_completions?: boolean;
}

async function fetchOpenRouterCatalog(): Promise<Map<string, OpenRouterModel>> {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) {
    throw new Error(`OpenRouter /models ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: OpenRouterModel[] };
  const map = new Map<string, OpenRouterModel>();
  for (const m of json.data ?? []) map.set(m.id, m);
  return map;
}

async function main() {
  const catalog = await fetchOpenRouterCatalog();
  console.log(`OpenRouter catalog: ${catalog.size} مدل خوانده شد`);

  const imageModels = await prisma.aiModel.findMany({
    where: { modelType: 'IMAGE_GEN' },
    select: { name: true, displayName: true, imageGenUseDirectApi: true },
    orderBy: { name: 'asc' },
  });
  console.log(`AiModel (IMAGE_GEN): ${imageModels.length} ردیف در دیتابیس`);

  const mismatches: Array<{
    name: string;
    displayName: string;
    dbUseDirectApi: boolean;
    openrouterHasChatCompletions: boolean | 'unknown';
  }> = [];

  for (const model of imageModels) {
    const entry = catalog.get(model.name);
    if (!entry) {
      console.warn(`⚠️  ${model.name} در کاتالوگ OpenRouter پیدا نشد — اسلاگ ممکن است اشتباه/منسوخ باشد`);
      continue;
    }
    const hasChatCompletions = entry.has_chat_completions ?? null;
    if (hasChatCompletions === null) {
      console.warn(`⚠️  ${model.name}: OpenRouter فیلد has_chat_completions را برنگرداند`);
      continue;
    }
    // imageGenUseDirectApi=true یعنی مسیر /images (باید has_chat_completions=false باشد)
    // imageGenUseDirectApi=false یعنی مسیر /chat/completions (باید has_chat_completions=true باشد)
    const expectedUseDirectApi = !hasChatCompletions;
    if (expectedUseDirectApi !== model.imageGenUseDirectApi) {
      mismatches.push({
        name: model.name,
        displayName: model.displayName,
        dbUseDirectApi: model.imageGenUseDirectApi,
        openrouterHasChatCompletions: hasChatCompletions,
      });
    }
  }

  if (mismatches.length === 0) {
    console.log('✅ هیچ مغایرتی پیدا نشد — همه‌ی فلگ‌های imageGenUseDirectApi با کاتالوگ زنده‌ی OpenRouter هم‌خوانی دارند');
    return;
  }

  console.log(`\n❌ ${mismatches.length} مدل با فلگ اشتباه imageGenUseDirectApi:\n`);
  for (const m of mismatches) {
    console.log(
      `  ${m.name} (${m.displayName}) — دیتابیس: imageGenUseDirectApi=${m.dbUseDirectApi} | ` +
        `OpenRouter: has_chat_completions=${m.openrouterHasChatCompletions} → باید imageGenUseDirectApi=${!m.openrouterHasChatCompletions} باشد`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
