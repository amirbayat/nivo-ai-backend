import { IsIn, IsObject, IsOptional } from 'class-validator';
import { SHOP_UI_EVENT_NAMES, type ShopUiEventName } from '../../../common/analytics/product-event.service';

// docs/PRD-buyer-chat-redesign.md B5 — POST v2/chat/:conversationId/ui-events
export class UiEventDto {
  @IsIn([...SHOP_UI_EVENT_NAMES])
  name!: ShopUiEventName;

  @IsOptional()
  @IsObject()
  props?: Record<string, unknown>;
}
