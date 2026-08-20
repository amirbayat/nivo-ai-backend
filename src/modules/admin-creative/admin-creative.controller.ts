import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CreativePromptReviewStatus, CreativePromptSourceType } from '@prisma/client';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { parseDateRange } from '../usage-analytics/usage-analytics.service';
import { AdminCreativeService } from './admin-creative.service';
import { CreateCreativePromptDto } from './dto/create-creative-prompt.dto';
import { UpdateCreativePromptDto } from './dto/update-creative-prompt.dto';
import { UpdateCreditConfigDto } from './dto/update-credit-config.dto';
import { CreateCreditPackageDto } from './dto/create-credit-package.dto';
import { UpdateCreditPackageDto } from './dto/update-credit-package.dto';
import { ReviewPromptRequestDto } from './dto/review-prompt-request.dto';
import { UploadExampleImageDto } from './dto/upload-example-image.dto';
import { CreateCreativeCategoryDto } from './dto/create-creative-category.dto';
import { UpdateCreativeCategoryDto } from './dto/update-creative-category.dto';

@Controller('admin/creative')
@UseGuards(JwtGuard, AdminGuard)
export class AdminCreativeController {
  constructor(private readonly adminCreativeService: AdminCreativeService) {}

  @Get('prompts')
  getPrompts(
    @Query('sourceType') sourceType?: CreativePromptSourceType,
    @Query('reviewStatus') reviewStatus?: CreativePromptReviewStatus,
  ) {
    return this.adminCreativeService.getPrompts(sourceType, reviewStatus);
  }

  // برای بج تعداد در تب «پیشنهادهای کاربران»
  @Get('prompts/pending-submissions-count')
  countPendingSubmissions() {
    return this.adminCreativeService.countPendingSubmissions();
  }

  // آپلود «عکس نمونه» یک سبک — قبل از ساخت/ویرایش پرامپت صدا زده می‌شود؛ URL برگشتی
  // در فیلد exampleImageUrl فرم (createPrompt/updatePrompt) استفاده می‌شود
  @Post('prompts/example-image')
  uploadExampleImage(@Body() dto: UploadExampleImageDto) {
    return this.adminCreativeService.uploadExampleImage(dto.image);
  }

  @Get('prompts/:id')
  getPrompt(@Param('id') id: string) {
    return this.adminCreativeService.getPrompt(id);
  }

  @Post('prompts')
  createPrompt(@Body() dto: CreateCreativePromptDto) {
    return this.adminCreativeService.createPrompt(dto);
  }

  @Patch('prompts/:id')
  updatePrompt(@Param('id') id: string, @Body() dto: UpdateCreativePromptDto) {
    return this.adminCreativeService.updatePrompt(id, dto);
  }

  @Delete('prompts/:id')
  deletePrompt(@Param('id') id: string) {
    return this.adminCreativeService.deletePrompt(id);
  }

  // انتشار نهایی پیشنهاد «تبدیل عکس به پرامپت» — قبلش هر ویرایشی با PATCH prompts/:id معمولی انجام می‌شود
  @Patch('prompts/:id/approve')
  approvePrompt(@Param('id') id: string) {
    return this.adminCreativeService.approvePrompt(id);
  }

  @Patch('prompts/:id/reject')
  rejectPrompt(@Param('id') id: string) {
    return this.adminCreativeService.rejectPrompt(id);
  }

  // عکس اصلی که کاربر برای این پیشنهاد آپلود کرده — پشت AdminGuard، بدون فیلتر isActive
  @Get('prompts/:id/source-image')
  async getPromptSourceImage(@Param('id') id: string, @Res() res: Response) {
    const { buffer, mimeType } =
      await this.adminCreativeService.getPromptSourceImage(id);
    res.setHeader('Content-Type', mimeType);
    res.send(buffer);
  }

  @Get('credit-config')
  getCreditConfig() {
    return this.adminCreativeService.getCreditConfig();
  }

  @Patch('credit-config')
  updateCreditConfig(@Body() dto: UpdateCreditConfigDto) {
    return this.adminCreativeService.updateCreditConfig(dto);
  }

  @Get('credit-packages')
  getCreditPackages() {
    return this.adminCreativeService.getCreditPackages();
  }

  @Post('credit-packages')
  createCreditPackage(@Body() dto: CreateCreditPackageDto) {
    return this.adminCreativeService.createCreditPackage(dto);
  }

  @Patch('credit-packages/:id')
  updateCreditPackage(
    @Param('id') id: string,
    @Body() dto: UpdateCreditPackageDto,
  ) {
    return this.adminCreativeService.updateCreditPackage(id, dto);
  }

  @Delete('credit-packages/:id')
  deleteCreditPackage(@Param('id') id: string) {
    return this.adminCreativeService.deleteCreditPackage(id);
  }

  @Get('categories')
  getCategories() {
    return this.adminCreativeService.getCategories();
  }

  @Post('categories')
  createCategory(@Body() dto: CreateCreativeCategoryDto) {
    return this.adminCreativeService.createCategory(dto);
  }

  @Patch('categories/:id')
  updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCreativeCategoryDto,
  ) {
    return this.adminCreativeService.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.adminCreativeService.deleteCategory(id);
  }

  // گزارش نیوو (فروخته/مصرف‌شده/margin) — docs/PRD-admin-credit-reports.md فاز ۱
  @Get('credits-report')
  getCreditsReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.adminCreativeService.getCreditsReport(parseDateRange(from, to));
  }

  @Get('prompt-requests')
  getPromptRequests(@Query('reviewed') reviewed?: string) {
    return this.adminCreativeService.getPromptRequests(reviewed);
  }

  @Patch('prompt-requests/:id')
  reviewPromptRequest(
    @Param('id') id: string,
    @Body() dto: ReviewPromptRequestDto,
  ) {
    return this.adminCreativeService.reviewPromptRequest(id, dto);
  }
}
