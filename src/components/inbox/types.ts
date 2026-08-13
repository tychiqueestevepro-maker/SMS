import type { InboxConversationDto } from "@/lib/inbox/types";

export type InboxStageDto = {
  id: string;
  name: string;
};

export type InboxConversationViewDto = InboxConversationDto & {
  isSuppressed: boolean;
  phoneNumberAvailable: boolean;
  phoneNumberStatus: "pending" | "ready";
  pipelineStageId: string;
  sequenceStoppedOnReply: boolean;
  campaignContext?: { name: string; stepOrder: number } | null;
};

export type InboxPageData = {
  effectiveCredits: number;
  messagingAvailable: boolean;
  conversations: InboxConversationViewDto[];
  safetyCapReached: boolean;
  safetyCapCredits: number;
  stages: InboxStageDto[];
  workspaceId: string | null;
};

export type InboxActionResult = {
  ok: boolean;
  message: string;
  code?: string;
  canRetryWithNewRequest?: boolean;
};
