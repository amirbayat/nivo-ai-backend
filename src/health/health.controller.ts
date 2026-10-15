import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { isShuttingDown } from '../common/shutdown-state';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    // readiness: در حال خاموشی ناسالم تا ingress ترافیک تازه نفرستد
    if (isShuttingDown()) throw new ServiceUnavailableException('shutting down');
    try {
      await Promise.all([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()]);
      return { status: 'ok' };
    } catch (err) {
      throw new ServiceUnavailableException(
        err instanceof Error ? err.message : 'dependency check failed',
      );
    }
  }
}
