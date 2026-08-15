import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { AdminCreativeService } from './admin-creative.service'
import { CreateCreativePromptDto } from './dto/create-creative-prompt.dto'
import { UpdateCreativePromptDto } from './dto/update-creative-prompt.dto'
import { UpdateCreditConfigDto } from './dto/update-credit-config.dto'
import { CreateCreditPackageDto } from './dto/create-credit-package.dto'
import { UpdateCreditPackageDto } from './dto/update-credit-package.dto'
import { ReviewPromptRequestDto } from './dto/review-prompt-request.dto'
import { UploadExampleImageDto } from './dto/upload-example-image.dto'
import { CreateCreativeCategoryDto } from './dto/create-creative-category.dto'
import { UpdateCreativeCategoryDto } from './dto/update-creative-category.dto'

@Controller('admin/creative')
@UseGuards(JwtGuard, AdminGuard)
export class AdminCreativeController {
  constructor(private readonly adminCreativeService: AdminCreativeService) {}

  @Get('prompts')
  getPrompts() {
    return this.adminCreativeService.getPrompts()
  }

  // آپلود «عکس نمونه» یک سبک — قبل از ساخت/ویرایش پرامپت صدا زده می‌شود؛ URL برگشتی
  // در فیلد exampleImageUrl فرم (createPrompt/updatePrompt) استفاده می‌شود
  @Post('prompts/example-image')
  uploadExampleImage(@Body() dto: UploadExampleImageDto) {
    return this.adminCreativeService.uploadExampleImage(dto.image)
  }

  @Get('prompts/:id')
  getPrompt(@Param('id') id: string) {
    return this.adminCreativeService.getPrompt(id)
  }

  @Post('prompts')
  createPrompt(@Body() dto: CreateCreativePromptDto) {
    return this.adminCreativeService.createPrompt(dto)
  }

  @Patch('prompts/:id')
  updatePrompt(@Param('id') id: string, @Body() dto: UpdateCreativePromptDto) {
    return this.adminCreativeService.updatePrompt(id, dto)
  }

  @Delete('prompts/:id')
  deletePrompt(@Param('id') id: string) {
    return this.adminCreativeService.deletePrompt(id)
  }

  @Get('credit-config')
  getCreditConfig() {
    return this.adminCreativeService.getCreditConfig()
  }

  @Patch('credit-config')
  updateCreditConfig(@Body() dto: UpdateCreditConfigDto) {
    return this.adminCreativeService.updateCreditConfig(dto)
  }

  @Get('credit-packages')
  getCreditPackages() {
    return this.adminCreativeService.getCreditPackages()
  }

  @Post('credit-packages')
  createCreditPackage(@Body() dto: CreateCreditPackageDto) {
    return this.adminCreativeService.createCreditPackage(dto)
  }

  @Patch('credit-packages/:id')
  updateCreditPackage(@Param('id') id: string, @Body() dto: UpdateCreditPackageDto) {
    return this.adminCreativeService.updateCreditPackage(id, dto)
  }

  @Delete('credit-packages/:id')
  deleteCreditPackage(@Param('id') id: string) {
    return this.adminCreativeService.deleteCreditPackage(id)
  }

  @Get('categories')
  getCategories() {
    return this.adminCreativeService.getCategories()
  }

  @Post('categories')
  createCategory(@Body() dto: CreateCreativeCategoryDto) {
    return this.adminCreativeService.createCategory(dto)
  }

  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCreativeCategoryDto) {
    return this.adminCreativeService.updateCategory(id, dto)
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.adminCreativeService.deleteCategory(id)
  }

  @Get('prompt-requests')
  getPromptRequests(@Query('reviewed') reviewed?: string) {
    return this.adminCreativeService.getPromptRequests(reviewed)
  }

  @Patch('prompt-requests/:id')
  reviewPromptRequest(@Param('id') id: string, @Body() dto: ReviewPromptRequestDto) {
    return this.adminCreativeService.reviewPromptRequest(id, dto)
  }
}
