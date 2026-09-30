import { IsIn } from 'class-validator';
import { CardDisplayPolicy } from '@prisma/client';
import { fa } from '../../../i18n/fa';

const CARD_DISPLAY_POLICIES = [
  'THRESHOLD',
  'PERCENTAGE',
  'EQUAL',
] as const satisfies readonly CardDisplayPolicy[];

export class UpdateCardPolicyDto {
  @IsIn(CARD_DISPLAY_POLICIES, { message: fa.validation.required })
  policy: CardDisplayPolicy;
}
