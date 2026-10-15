import { IsBoolean } from 'class-validator';

export class LeadCaptureOnlyDto {
  @IsBoolean()
  enabled!: boolean;
}
