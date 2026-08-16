import { Module } from '@nestjs/common';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';
import { PlanRoutingController } from './plan-routing.controller';
import { ModelRouterModule } from '../model-router/model-router.module';

@Module({
  imports: [ModelRouterModule],
  controllers: [PlansController, PlanRoutingController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
