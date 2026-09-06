import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { KieVideoModelsService } from './kie-video-models.service';
import { UpsertKieVideoModelDto } from './dto/upsert-kie-video-model.dto';

// «همه‌ی این مدل‌ها رو می‌خوام» (کاربر) → کاتالوگ ادمین‌قابل‌مدیریت، نه هاردکد یک مدل.
// افزودن مدل بیست‌ویکم Kie.ai یعنی یک POST از همین پنل، نه دیپلوی کد تازه.
@Controller('admin/kie-video-models')
@UseGuards(JwtGuard, AdminGuard)
export class KieVideoModelsAdminController {
  constructor(private readonly models: KieVideoModelsService) {}

  @Get()
  listAll() {
    return this.models.listAll();
  }

  @Post()
  create(@Body() dto: UpsertKieVideoModelDto) {
    if (!dto.slug || !dto.displayName || !dto.category) {
      throw new BadRequestException('slug/displayName/category اجباری‌اند');
    }
    return this.models.create({
      slug: dto.slug,
      displayName: dto.displayName,
      category: dto.category,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
      supportsImages: dto.supportsImages ?? false,
      maxImages: dto.maxImages ?? null,
      supportsVideo: dto.supportsVideo ?? false,
      maxVideoDurationSec: dto.maxVideoDurationSec ?? null,
      maxVideoWindowSec: dto.maxVideoWindowSec ?? null,
      supportsAspectRatio: dto.supportsAspectRatio ?? true,
      supportsDuration: dto.supportsDuration ?? true,
      resolutions: dto.resolutions ?? ['720p'],
      pricePerSecondUsdConfirmed: dto.pricePerSecondUsdConfirmed ?? null,
      pricingNote: dto.pricingNote ?? null,
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpsertKieVideoModelDto) {
    return this.models.update(id, dto);
  }

  // soft-delete (غیرفعال‌سازی) — بخش کامنت kie-video-models.service.ts/delete
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.models.delete(id);
  }
}
