import { IsIn, IsOptional } from 'class-validator';

// گزینه‌ی رزولوشن خروجی (HD/Full HD/4K) — فقط اگر از ابعاد واقعی سورس کوچک‌تر باشد اعمال
// می‌شود (caption-studio.service.ts/startRender)، وگرنه نادیده گرفته می‌شود
export class StartRenderDto {
  @IsOptional()
  @IsIn([720, 1080, 2160])
  targetHeight?: number;
}
