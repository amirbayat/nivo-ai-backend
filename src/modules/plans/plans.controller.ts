import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { fa } from '../../i18n/fa';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  findAll() {
    return this.plansService.findAll();
  }

  @Get('admin')
  @UseGuards(JwtGuard, AdminGuard)
  findAllAdmin() {
    return this.plansService.findAllAdmin();
  }

  @Get('model-catalog')
  findModelCatalog() {
    return this.plansService.findModelCatalog();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.plansService.findOne(id);
  }

  @Post()
  @UseGuards(JwtGuard, AdminGuard)
  async create(@Body() dto: CreatePlanDto) {
    const plan = await this.plansService.create(dto);
    return { message: fa.plans.created, plan };
  }

  @Patch(':id')
  @UseGuards(JwtGuard, AdminGuard)
  async update(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    const plan = await this.plansService.update(id, dto);
    return { message: fa.plans.updated, plan };
  }

  @Delete(':id')
  @UseGuards(JwtGuard, AdminGuard)
  async remove(@Param('id') id: string) {
    await this.plansService.remove(id);
    return { message: fa.plans.deleted };
  }
}
