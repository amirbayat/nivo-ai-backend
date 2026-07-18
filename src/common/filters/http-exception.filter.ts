import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { LiveStatsService } from '../../modules/live-stats/live-stats.service'

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  // با APP_FILTER (به‌جای `new AllExceptionsFilter()` دستی در main.ts) رجیستر می‌شود تا این
  // تزریق کار کند — docs/PRD-admin-notifications-and-mobile.md بخش ۴/۸ (SYSTEM_ERROR_SPIKE)
  constructor(private readonly liveStats: LiveStatsService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'خطای داخلی سرور'

    if (status >= 500) {
      this.logger.error(exception)
      this.liveStats.recordServerError().catch((err) => this.logger.error('recordServerError failed', err))
    }

    const body =
      typeof message === 'string'
        ? { statusCode: status, message, path: request.url }
        : { statusCode: status, ...(message as object), path: request.url }

    response.status(status).json(body)
  }
}
