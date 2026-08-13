import type { CampaignLaunchAssessment, CampaignRecipientCandidate, CampaignStatistics } from "@/lib/campaigns/types";

export type CampaignClientStatus = "draft" | "active" | "paused" | "finished";

export type CampaignStepDto = {
  id?: string;
  body: string;
  waitDaysAfterPrevious: number | null;
};

export type CampaignContactOption = CampaignRecipientCandidate & {
  name: string;
  company: string;
  phoneNumber: string;
};

export type CampaignPhoneOption = {
  id: string;
  phoneNumber: string;
  status: "pending" | "ready";
  label?: string | null;
  countryCode?: string | null;
  inUse?: boolean;
};

export type CampaignListItemDto = {
  id: string;
  name: string;
  status: CampaignClientStatus;
  createdAt: string;
  updatedAt: string;
  recipientCount: number;
  statistics: CampaignStatistics;
  phoneNumberId?: string | null;
  recentActivity?: string | null;
  creatorName?: string | null;
};

export type CampaignActivityPointDto = {
  date: string;
  label: string;
  sent: number;
  replies: number;
  replyRate: number;
};

export type CampaignResponseStatus = "replied" | "opted_out" | "pending" | "sent";

export type CampaignResponseMessageDto = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  timestamp: string;
  status?: string;
};

export type CampaignResponseConversationDto = {
  contactId: string;
  contactName: string;
  company?: string;
  phone: string;
  status: CampaignResponseStatus;
  lastMessageBody: string;
  lastMessageTime: string;
  optedOut: boolean;
  messages: CampaignResponseMessageDto[];
};

export type CampaignActiveMonitoringDto = {
  startedAt: string | null;
  timezone: string;
  sendWindowStart: string;
  sendWindowEnd: string;
  dripIntervalMinutes: number;
  sequenceName: string;
  sendingNumber?: CampaignPhoneOption | null;
  metrics: {
    messagesSent: number;
    totalRecipients: number;
    repliesCount: number;
    replyRate: number;
    remainingCount: number;
    optedOutCount: number;
    completionPercent: number;
    estimatedCompletionDate: string | null;
  };
  activityOverTime: CampaignActivityPointDto[];
  details: {
    sequenceName: string;
    fromNumber: string;
    recipientsCount: number;
    sendingDays: number[];
    avgTimeToReply: string;
    bouncedCount: number;
    lastActivity: string;
  };
  responses: CampaignResponseConversationDto[];
};

export type CampaignEditorDto = {
  id: string | null;
  name: string;
  messagingAvailable: boolean;
  status: CampaignClientStatus;
  phoneNumberId: string | null;
  selectedContactIds: string[];
  steps: CampaignStepDto[];
  contacts: CampaignContactOption[];
  phoneNumbers: CampaignPhoneOption[];
  statistics: CampaignStatistics;
  safetyCapReached: boolean;
  timezone: string;
  sendWindowStart: string;
  sendWindowEnd: string;
  sendingDays: number[];
  dripIntervalMinutes: number;
  activeMonitoring?: CampaignActiveMonitoringDto | null;
};

export type CampaignDraftPayload = {
  campaignId: string | null;
  name: string;
  phoneNumberId: string | null;
  contactIds: string[];
  steps: CampaignStepDto[];
  timezone: string;
  sendWindowStart: string;
  sendWindowEnd: string;
  sendingDays: number[];
  dripIntervalMinutes: number;
};

export type CampaignActionResult = {
  ok: boolean;
  message: string;
  campaignId?: string;
  status?: CampaignClientStatus;
  code?:
    | "CONFIRM_LARGE_CAMPAIGN"
    | "MESSAGING_UNAVAILABLE"
    | "NO_READY_NUMBER"
    | "NO_ELIGIBLE_RECIPIENTS"
    | "SAFETY_CAP_REACHED";
  assessment?: CampaignLaunchAssessment;
  confirmationKey?: string;
};
