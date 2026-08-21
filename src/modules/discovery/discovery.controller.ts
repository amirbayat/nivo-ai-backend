import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { DiscoveryGenerationService } from './discovery-generation.service';
import { GenerateCreativeDto } from './dto/generate-creative.dto';
import { CreatePromptRequestDto } from './dto/create-prompt-request.dto';
import { UploadDiscoveryImageDto } from './dto/upload-input-image.dto';
import { ExtractPromptDto } from './dto/extract-prompt.dto';

// v2 — دیسکاوری (کاتالوگ سبک‌های آماده + تولید + گالری + درخواست فیچر)، بخش ۵.۳/۵.۴/۵.۵/۵.۹/۵.۱۰
@Controller('v2/discovery')
@UseGuards(JwtGuard)
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryGenerationService) {}

  // catalog/categories به DiscoveryPublicController منتقل شدند — کاربر مهمان هم باید بتواند
  // استودیو محتوا را قبل از ثبت‌نام اکسپلور کند
  @Get('gallery')
  gallery(
    @CurrentUser() user: JwtPayload,
    @Query('projectId') projectId?: string,
  ) {
    return this.discoveryService.gallery(user.sub, projectId);
  }

  // فرانت با axios (هدر Authorization واقعی) + responseType:'blob' صدا می‌زند —
  // useAuthedImageUrl موجود در فرانت را عیناً برای این مسیر هم استفاده می‌کنیم
  @Get('images/:key')
  async getImage(
    @CurrentUser() user: JwtPayload,
    @Param('key') key: string,
    @Res() res: Response,
  ) {
    const { buffer, mimeType } = await this.discoveryService.getImage(
      user.sub,
      key,
    );
    res.setHeader('Content-Type', mimeType);
    res.send(buffer);
  }

  // قبل از generate برای سبک‌های requiresUserImage=true صدا زده می‌شود — کلید MinIO برگشتی
  // داخل GenerateCreativeDto.inputImageKeys فرستاده می‌شود
  @Post('upload-image')
  uploadImage(@Body() dto: UploadDiscoveryImageDto) {
    return this.discoveryService.uploadInputImage(dto.image);
  }

  @Post('generate')
  generate(@CurrentUser() user: JwtPayload, @Body() dto: GenerateCreativeDto) {
    return this.discoveryService.generate(user.sub, dto);
  }

  @Post('requests')
  createRequest(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePromptRequestDto,
  ) {
    return this.discoveryService.createPromptRequest(user.sub, dto);
  }

  // مدل‌های vision-capable قابل‌انتخاب برای «تبدیل عکس به پرامپت» + هزینه‌ی تخمینی هرکدام
  // و دو حالت خودکار (بهترین نتیجه/مصرف بهینه) — انتخابگر مدل فرانت از این استفاده می‌کند
  @Get('prompt-extractions/models')
  extractionModels() {
    return this.discoveryService.getExtractionModelOptions();
  }

  // «تبدیل عکس به پرامپت» — کارت بزرگ بالای صفحه‌ی استودیو؛ imageKey از upload-image بالا می‌آید
  @Post('prompt-extractions')
  extractPrompt(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ExtractPromptDto,
  ) {
    return this.discoveryService.extractPromptFromImage(user.sub, dto);
  }

  // تاریخچه‌ی استخراج‌های قبلی خود کاربر — برای استفاده‌ی دوباره از یک پرامپت قبلاً استخراج‌شده
  @Get('prompt-extractions/history')
  extractionHistory(@CurrentUser() user: JwtPayload) {
    return this.discoveryService.listMyExtractions(user.sub);
  }

  @Get('projects/:projectId/customizations')
  projectCustomizations(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
  ) {
    return this.discoveryService.listProjectCustomizations(user.sub, projectId);
  }
}
