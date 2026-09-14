import { Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { fa } from '../../i18n/fa';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto/api-key.dto';

// docs/PRD-daily-content-prompt-agent.md بخش ۴ — کلید خام فقط همین یک‌بار در پاسخ create
// برمی‌گردد و دیگر جایی ذخیره نمی‌شود؛ فقط هش (همان الگوی RefreshToken.tokenHash) می‌ماند.
@Injectable()
export class ContentAgentApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.contentAgentApiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  }

  async create(dto: CreateApiKeyDto): Promise<{ id: string; rawKey: string }> {
    const rawKey = `nivo_agent_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const created = await this.prisma.contentAgentApiKey.create({
      data: { label: dto.label, keyHash },
    });
    return { id: created.id, rawKey };
  }

  async update(id: string, dto: UpdateApiKeyDto) {
    const existing = await this.prisma.contentAgentApiKey.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException(fa.errors.notFound);
    return this.prisma.contentAgentApiKey.update({
      where: { id },
      data: { isActive: dto.isActive },
      select: {
        id: true,
        label: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  }
}
