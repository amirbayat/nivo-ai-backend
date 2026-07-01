import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator'
import { TicketsService } from './tickets.service'
import { CreateTicketDto } from './dto/create-ticket.dto'
import { CreateReplyDto } from './dto/create-reply.dto'

@Controller('tickets')
@UseGuards(JwtGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateTicketDto) {
    return this.ticketsService.create(user.sub, dto)
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.ticketsService.findByUser(user.sub)
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ticketsService.findOneByUser(user.sub, id)
  }

  @Post(':id/reply')
  addReply(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateReplyDto,
  ) {
    return this.ticketsService.addUserReply(user.sub, id, dto.body)
  }
}
