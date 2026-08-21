import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CreativeOutputType, CreativeSegment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { mimeTypeForExt } from '../../common/validators/chat-image.validator';
import { fa } from '../../i18n/fa';
import { AnonIdentityService } from '../anon-chat/anon-identity.service';
import { DiscoveryGenerationService } from './discovery-generation.service';
import { DiscoveryAnonService } from './discovery-anon.service';
import { UploadDiscoveryImageDto } from './dto/upload-input-image.dto';
import { GenerateAnonCreativeDto } from './dto/generate-anon-creative.dto';

// مسیر عمومی (بدون JwtGuard) — کاتالوگ/دسته‌بندی‌ها + عکس نمونه‌ی سبک‌ها + امتحان رایگان
// یک‌باره‌ی تولید برای کاربر مهمان (anon/*، مالکیت/محدودیت از طریق هدر X-Anon-Session-Id + IP
// دقیقاً هم‌الگوی anon-chat.controller.ts).
@Controller('v2/discovery')
export class DiscoveryPublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly discoveryService: DiscoveryGenerationService,
    private readonly identityService: AnonIdentityService,
    private readonly discoveryAnonService: DiscoveryAnonService,
  ) {}

  @Get('catalog')
  catalog(
    @Query('outputType') outputType?: CreativeOutputType,
    @Query('segment') segment?: CreativeSegment,
    @Query('trending') trending?: string,
    @Query('categoryId') categoryId?: string,
    @Query('sort') sort?: 'newest' | 'cheapest' | 'priciest' | 'sortOrder',
  ) {
    return this.discoveryService.listCatalog({
      outputType,
      segment,
      trending: trending === 'true',
      categoryId,
      sort,
    });
  }

  // یک آیتم کاتالوگ با id — برای دیپ‌لینک عمومی (مثلاً nivoai.ir/studio?id=...) که کاربر مهمان
  // هم باید بتواند قبل از لاگین آن را ببیند (StudioLinkPage فرانت)
  @Get('catalog/:id')
  catalogItem(@Param('id') id: string) {
    return this.discoveryService.getCatalogItem(id);
  }

  @Get('categories')
  categories() {
    return this.discoveryService.listCategories();
  }

  // این‌ها در DiscoverPage با <img src=...> ساده (بدون هدر Authorization) نمایش داده می‌شوند،
  // پس باید مستقیم قابل fetch باشند؛ برخلاف DiscoveryController.getImage (خروجی تولید کاربر)
  // که پشت JwtGuard + چک مالکیت است. برای این‌که این مسیر عمومی به یک presigned‌URL عمومی برای
  // *هر* کلید MinIO تبدیل نشود (بایگانی چت/گالری کاربر هم توی همون bucket است)، کلید فقط وقتی
  // سرو می‌شود که واقعاً به‌عنوان exampleImageUrl یک سبک فعال ثبت شده باشد — همون الگوی
  // ArticlesController (عمومی) در برابر ArticlesAdminController (guarded).
  @Get('example-images/:key')
  async getExampleImage(@Param('key') key: string, @Res() res: Response) {
    const prompt = await this.prisma.creativePrompt.findFirst({
      where: { exampleImageUrl: { contains: key }, isActive: true },
      select: { id: true },
    });
    if (!prompt) throw new NotFoundException(fa.errors.notFound);

    const ext = key.split('.').pop() ?? 'png';
    const buffer = await this.storage.downloadImage(key);
    res.setHeader('Content-Type', mimeTypeForExt(ext));
    res.send(buffer);
  }

  @Get('anon/status')
  async anonStatus(
    @Headers('x-anon-session-id') clientToken: string,
    @Req() req: Request,
  ) {
    const context = await this.identityService.resolveContext(
      getClientIp(req),
      clientToken,
    );
    return this.discoveryAnonService.getStatus(context.identity);
  }

  // قبل از anon/generate برای سبک‌های requiresUserImage=true صدا زده می‌شود — همون
  // uploadInputImage موجود (وابسته به userId نیست)، فقط برای معتبر بودن session/identity
  @Post('anon/upload-image')
  async anonUploadImage(
    @Headers('x-anon-session-id') clientToken: string,
    @Body() dto: UploadDiscoveryImageDto,
    @Req() req: Request,
  ) {
    await this.identityService.resolveContext(getClientIp(req), clientToken);
    return this.discoveryService.uploadInputImage(dto.image);
  }

  @Post('anon/generate')
  async anonGenerate(
    @Headers('x-anon-session-id') clientToken: string,
    @Body() dto: GenerateAnonCreativeDto,
    @Req() req: Request,
  ) {
    const context = await this.identityService.resolveContext(
      getClientIp(req),
      clientToken,
    );
    return this.discoveryAnonService.generate(context, dto);
  }
}

// همان الگوی دقیق anon-chat.controller.ts/sales.controller.ts
function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
    req.socket.remoteAddress ??
    'unknown'
  );
}
