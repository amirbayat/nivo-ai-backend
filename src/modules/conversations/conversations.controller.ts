import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
import { fa } from '../../i18n/fa';

@Controller('conversations')
@UseGuards(JwtGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateConversationDto) {
    return this.conversationsService.create(user.sub, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListConversationsDto,
  ) {
    return this.conversationsService.findAll(user.sub, query);
  }

  // «انتخاب از تولیدات قبلی» (استودیو ویدیو) — باید قبل از ':id' ثبت شود وگرنه Nest 'images'
  // را به‌عنوان مقدار پارامتر :id تفسیر می‌کند
  @Get('images/mine')
  listMyImages(
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Math.min(Number(limit) || 30, 100) : 30;
    return this.conversationsService.listMyImages(
      user.sub,
      cursor,
      parsedLimit,
    );
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.conversationsService.findOne(id, user.sub);
  }

  // فرانت این مسیر را با axios (هدر Authorization واقعی) و responseType:'blob' صدا می‌زند —
  // نه با <img src="...">‌ خام، چون تگ img نمی‌تواند هدر بفرستد؛ همین یعنی برخلاف presigned
  // URL قبلی، این لینک بدون توکن واقعی کاربر برای کس دیگری قابل استفاده نیست.
  // SkipThrottle: یک گالری با چند ده عکس یعنی چند ده درخواست همزمان به همین مسیر — این‌ها
  // را نباید با سقف سراسری چت/API (rate-limit.module.ts) اشتراک گذاشت وگرنه لود گالری به
  // تنهایی کاربر را throttle می‌کند؛ چون filename یک UUID تصادفی و immutable است، هیچ افشای
  // اطلاعاتی هم از حذف محدودیت اینجا نیست (مالکیت هنوز در getImage چک می‌شود).
  @SkipThrottle()
  @Get(':id/images/:filename')
  async getImage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const { buffer, mimeType } = await this.conversationsService.getImage(
      id,
      filename,
      user.sub,
    );
    res.setHeader('Content-Type', mimeType);
    // filename یک کلید تصادفی UUID است (storage.service.ts uploadImage) — محتوایش هیچ‌وقت
    // عوض نمی‌شود، پس مرورگر می‌تواند برای همیشه کش کند و از فچ دوباره در بار بعدی صرف‌نظر کند
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(buffer);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    const conversation = await this.conversationsService.update(
      id,
      user.sub,
      dto,
    );
    return { message: fa.conversations.updated, conversation };
  }

  @Delete(':id')
  @HttpCode(204)
  archive(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.conversationsService.archive(id, user.sub);
  }
}
