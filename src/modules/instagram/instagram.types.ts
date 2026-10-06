// docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۴.۳ — شکل‌های best-effort بر اساس مستندات
// Instagram Messaging API/Webhooks (مشترک با ساختار Messenger Platform). چون هنوز App واقعی در
// Meta Developer ساخته نشده (سوال باز بخش ۶ — فروشگاه پایلوت)، این تایپ‌ها قبل از اولین تست
// واقعی روی sandbox باید verify شوند — دقیقاً همون احتیاطی که برای is_user_follow_business
// (بخش ۴.۵) رعایت شد.

export interface InstagramWebhookPayload {
  object: string;
  entry: InstagramWebhookEntry[];
}

export interface InstagramWebhookEntry {
  id: string; // instagramBusinessId صاحب این entry
  time: number;
  changes?: InstagramCommentChange[];
  messaging?: InstagramMessagingEvent[];
}

export interface InstagramCommentChange {
  field: 'comments';
  value: {
    id: string; // comment id
    text?: string;
    from?: { id: string; username?: string };
    media: { id: string; media_product_type?: string };
  };
}

export interface InstagramMessagingEvent {
  sender: { id: string }; // PSID
  recipient: { id: string }; // instagramBusinessId
  timestamp?: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    // ریپلای به استوری (شامل استیکر سوال) — طبق مستندات، reply_to.story پر می‌شود
    reply_to?: { story?: { id: string; url?: string } };
    attachments?: { type: string; payload?: Record<string, unknown> }[];
  };
}

export type ResolvedTriggerEvent =
  | {
      kind: 'COMMENT';
      storeInstagramBusinessId: string;
      commentId: string;
      mediaId: string;
      text: string;
    }
  | {
      kind: 'STORY_REPLY';
      storeInstagramBusinessId: string;
      senderPsid: string;
      storyId?: string;
      text: string;
    }
  | {
      kind: 'STORY_MENTION';
      storeInstagramBusinessId: string;
      senderPsid: string;
      text: string;
    }
  | {
      kind: 'DM';
      storeInstagramBusinessId: string;
      senderPsid: string;
      text: string;
    };
