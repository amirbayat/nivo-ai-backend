import { FeedbackVote } from '@prisma/client';
export declare class SubmitMessageFeedbackDto {
    vote: FeedbackVote;
    comment?: string;
}
