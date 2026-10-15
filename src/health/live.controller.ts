import { Controller, Get } from '@nestjs/common';

// R1.3 — liveness بدون هیچ وابستگی (DB/Redis)؛ readiness همان /health است
@Controller('live')
export class LiveController {
  @Get()
  live() {
    return { status: 'ok' };
  }
}
