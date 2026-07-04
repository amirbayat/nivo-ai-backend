import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

@Processor('token-flush')
export class TokenFlushProcessor {
  private readonly logger = new Logger(TokenFlushProcessor.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  @Process('flush')
  async handleFlush() {
    const today = new Date().toISOString().slice(0, 10);
    const date = new Date(today);

    const [freeKeys, dpKeys, reqKeys, costKeys] = await Promise.all([
      this.scanKeys(`token:free:*:${today}`),
      this.scanKeys(`token:dailypaid:*:${today}`),
      this.scanKeys(`token:req:*:${today}`),
      this.scanKeys(`cost:daily:*:${today}`),
    ]);

    if (
      !freeKeys.length &&
      !dpKeys.length &&
      !reqKeys.length &&
      !costKeys.length
    )
      return;

    // fetch all values in one round-trip batch
    const allKeys = [...freeKeys, ...dpKeys, ...reqKeys, ...costKeys];
    const values = await Promise.all(allKeys.map((k) => this.redis.get(k)));

    // build userId → aggregated usage map
    type Row = {
      freeTokensUsed: number;
      paidTokensUsed: number;
      requestsCount: number;
      costRial: number;
    };
    const userMap = new Map<string, Row>();
    const row = (id: string): Row => {
      if (!userMap.has(id))
        userMap.set(id, {
          freeTokensUsed: 0,
          paidTokensUsed: 0,
          requestsCount: 0,
          costRial: 0,
        });
      return userMap.get(id)!;
    };

    // key formats: token:free:{userId}:{date}
    //              token:dailypaid:{userId}:{date}
    //              token:req:{userId}:{date}
    //              cost:daily:{userId}:{date}
    // userId is always at index 2
    const o1 = 0;
    const o2 = freeKeys.length;
    const o3 = o2 + dpKeys.length;
    const o4 = o3 + reqKeys.length;

    freeKeys.forEach((k, i) => {
      row(k.split(':')[2]).freeTokensUsed = Number(values[o1 + i]) || 0;
    });
    dpKeys.forEach((k, i) => {
      row(k.split(':')[2]).paidTokensUsed = Number(values[o2 + i]) || 0;
    });
    reqKeys.forEach((k, i) => {
      row(k.split(':')[2]).requestsCount = Number(values[o3 + i]) || 0;
    });
    costKeys.forEach((k, i) => {
      row(k.split(':')[2]).costRial = Number(values[o4 + i]) || 0;
    });

    await Promise.all(
      Array.from(userMap.entries()).map(([userId, data]) =>
        this.prisma.dailyUsage.upsert({
          where: { userId_date: { userId, date } },
          create: { userId, date, ...data },
          update: data,
        }),
      ),
    );

    this.logger.log(`Token flush: synced ${userMap.size} users for ${today}`);
  }

  private scanKeys(pattern: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const keys: string[] = [];
      const stream = this.redis.scanStream({ match: pattern, count: 100 });
      stream.on('data', (batch: string[]) => keys.push(...batch));
      stream.on('end', () => resolve(keys));
      stream.on('error', reject);
    });
  }
}
