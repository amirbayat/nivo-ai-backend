import { Module } from '@nestjs/common'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { PrismaModule } from '../../prisma/prisma.module'
import { RedisModule } from '../../redis/redis.module'
import { TicketsModule } from '../tickets/tickets.module'

@Module({
  imports: [PrismaModule, RedisModule, TicketsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
