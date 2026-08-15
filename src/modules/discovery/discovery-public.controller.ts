import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common'
import type { Response } from 'express'
import { PrismaService } from '../../prisma/prisma.service'
import { StorageService } from '../../storage/storage.service'
import { mimeTypeForExt } from '../../common/validators/chat-image.validator'
import { fa } from '../../i18n/fa'

// مسیر عمومی (بدون JwtGuard) فقط برای «عکس نمونه»ی سبک‌ها (CreativePrompt.exampleImageUrl) —
// این‌ها در DiscoverPage با <img src=...> ساده (بدون هدر Authorization) نمایش داده می‌شوند،
// پس باید مستقیم قابل fetch باشند؛ برخلاف DiscoveryController.getImage (خروجی تولید کاربر)
// که پشت JwtGuard + چک مالکیت است. برای این‌که این مسیر عمومی به یک presigned‌URL عمومی برای
// *هر* کلید MinIO تبدیل نشود (بایگانی چت/گالری کاربر هم توی همون bucket است)، کلید فقط وقتی
// سرو می‌شود که واقعاً به‌عنوان exampleImageUrl یک سبک فعال ثبت شده باشد — همون الگوی
// ArticlesController (عمومی) در برابر ArticlesAdminController (guarded).
@Controller('v2/discovery')
export class DiscoveryPublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get('example-images/:key')
  async getExampleImage(@Param('key') key: string, @Res() res: Response) {
    const prompt = await this.prisma.creativePrompt.findFirst({
      where: { exampleImageUrl: { contains: key }, isActive: true },
      select: { id: true },
    })
    if (!prompt) throw new NotFoundException(fa.errors.notFound)

    const ext = key.split('.').pop() ?? 'png'
    const buffer = await this.storage.downloadImage(key)
    res.setHeader('Content-Type', mimeTypeForExt(ext))
    res.send(buffer)
  }
}
