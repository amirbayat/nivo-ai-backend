import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { verifyKieWebhookSignature } from '../../common/services/kie-webhook-signature.util';
import { SalesAgentVoiceProcessor } from '../../queue/processors/sales-agent-voice.processor';

// شکل دقیق بدنه‌ی webhook مسیر عمومی jobs/createTask (که TTS از آن استفاده می‌کند، نه
// endpoint اختصاصی Veo/Runway) مستند/تست‌شده نیست — عمداً هیچ فیلدی غیر از taskId از بدنه
// اعتماد نمی‌شود؛ taskId فقط یک «الان دوباره چک کن» است، نتیجه‌ی واقعی با همون pollTask
// قابل‌اعتماد (jobs/recordInfo) که در حالت عادی هم استفاده می‌شود گرفته می‌شود.
interface KieWebhookBody {
  data?: { taskId?: string; task_id?: string };
  taskId?: string;
  task_id?: string;
}

function extractTaskId(body: KieWebhookBody): string | null {
  return (
    body.data?.taskId ??
    body.data?.task_id ??
    body.taskId ??
    body.task_id ??
    null
  );
}

// فقط یک fast-path/safety-net اضافه‌ست، نه جایگزین polling (که در sales-agent-voice.processor.ts
// همچنان بدون تغییر روی هر job فعال اجرا می‌شود) — همون معماری video-edit-webhook.service.ts.
// سه حالت:
//   ۱) event هنوز در حال polling فعال است (payload.voicePending=true) → کاری نکن، رقابت با
//      poll loop فعال یعنی ریسک کسر دوباره‌ی اعتبار
//   ۲) event از قبل voiceKey دارد → قبلاً از مسیر عادی تمام شده، no-op
//   ۳) event نهایی شده بود ولی FAILED (نه voicePending، نه voiceKey) → تنها حالتی که این
//      سرویس واقعاً تلاش می‌کند بازیابی کند (دوباره pollTask می‌زند)
@Injectable()
export class SalesAgentVoiceWebhookService {
  private readonly logger = new Logger(SalesAgentVoiceWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly processor: SalesAgentVoiceProcessor,
  ) {}

  async handleKieCallback(
    body: unknown,
    timestampHeader: string | undefined,
    signatureHeader: string | undefined,
  ): Promise<void> {
    this.logger.log(
      `sales-agent-voice kie webhook: received raw body=${JSON.stringify(body)} timestamp=${timestampHeader ?? 'missing'} hasSignature=${!!signatureHeader}`,
    );

    const taskId = extractTaskId(body ?? {});
    if (!taskId) {
      this.logger.warn(
        'sales-agent-voice kie webhook: payload بدون taskId قابل‌تشخیص — نادیده گرفته شد',
      );
      return;
    }

    const secret = this.config.get<string>('KIE_WEBHOOK_HMAC_KEY');
    if (!secret) {
      this.logger.warn(
        `sales-agent-voice kie webhook: KIE_WEBHOOK_HMAC_KEY ست نشده — callback برای taskId=${taskId} نادیده گرفته شد (polling همچنان فعال است)`,
      );
      return;
    }
    if (
      !verifyKieWebhookSignature(
        taskId,
        timestampHeader,
        signatureHeader,
        secret,
      )
    ) {
      throw new UnauthorizedException('امضای webhook نامعتبر است');
    }

    // kieTaskId روی payload خودِ AGENT_REPLY event نوشته شده (sales-agent-voice.processor.ts
    // persistTaskTracking، درست بعد از createTask) — همون JSON path query که Prisma/Postgres
    // پشتیبانی می‌کند
    const event = await this.prisma.conversationEvent.findFirst({
      where: { payload: { path: ['kieTaskId'], equals: taskId } },
    });
    if (!event) {
      this.logger.log(
        `sales-agent-voice kie webhook: هیچ eventی با kieTaskId=${taskId} پیدا نشد (ممکن است مربوط به فیچر دیگری از همین اکانت Kie باشد)`,
      );
      return;
    }

    const payload = event.payload as Prisma.InputJsonObject & {
      voicePending?: boolean;
      voiceKey?: string;
      voiceTraceEventId?: string;
    };
    if (payload.voiceKey) {
      this.logger.log(
        `sales-agent-voice kie webhook: event=${event.id} از قبل voiceKey دارد — no-op`,
      );
      return;
    }
    if (payload.voicePending) {
      this.logger.log(
        `sales-agent-voice kie webhook: event=${event.id} هنوز voicePending=true — poll loop فعال خودش نتیجه رو می‌گیرد، دست نمی‌زنیم`,
      );
      return;
    }

    this.logger.log(
      `sales-agent-voice kie webhook: event=${event.id} قبلاً FAILED نهایی شده بود — تلاش برای بازیابی با pollTask`,
    );
    await this.processor.recoverFromWebhook(
      event.id,
      event.conversationId,
      taskId,
      payload.voiceTraceEventId,
    );
  }
}
