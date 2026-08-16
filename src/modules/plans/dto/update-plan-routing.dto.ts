import { IsArray, IsOptional, IsString } from 'class-validator';

export interface RoutingStepInput {
  order: number;
  thresholdPct: number;
  models: string[];
  reasoningEffort?: string | null;
}

export class UpdatePlanRoutingDto {
  @IsOptional()
  @IsString()
  simpleModel?: string | null;

  @IsArray({ message: 'استپ‌ها باید آرایه باشند' })
  steps: RoutingStepInput[];
}
