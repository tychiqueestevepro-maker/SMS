import type {
  MessageDirection,
  PhoneNumberStatus,
  ProductDeliveryStatus,
} from "../messaging/types";

export interface InboxContactSource {
  id: string;
  phoneE164: string;
  firstName: string;
  lastName: string;
  company: string | null;
  jobTitle: string | null;
  notes: string | null;
  deletedAt: string | null;
  isSuppressed: boolean;
  hasUnreadMessages: boolean;
}

export interface InboundContactResolution {
  kind: "existing" | "create_minimal";
  phoneE164: string;
  contactId: string | null;
  displayLabel: string;
  readOnly: boolean;
  deletedContact: boolean;
  isSuppressed: boolean;
  shouldRestoreContact: false;
  resumeCampaigns: false;
  createContact:
    | {
        firstName: "";
        lastName: "";
        company: "";
        phoneE164: string;
        pipelineStageId: string;
      }
    | null;
}

export interface InboxPhoneNumberSource {
  id: string;
  phoneNumber: string;
  status: PhoneNumberStatus;
}

export interface InboxMessageSource {
  id: string;
  contactId: string;
  phoneNumberId: string;
  direction: MessageDirection;
  body: string;
  occurredAt: string;
  deliveryStatus: ProductDeliveryStatus;
  campaignId?: string | null;
  stepOrder?: number | null;
  providerMessageId?: string | null;
  providerErrorCode?: string | null;
}

export interface InboxMessageDto {
  id: string;
  direction: MessageDirection;
  body: string;
  occurredAt: string;
  deliveryStatus: ProductDeliveryStatus;
  campaignId?: string | null;
  stepOrder?: number | null;
}

export interface InboxConversationDto {
  id: string;
  contactId: string;
  phoneNumberId: string;
  contactLabel: string;
  contactCompany: string;
  contactJobTitle: string;
  contactNotes: string;
  contactPhoneNumber: string;
  phoneNumber: string;
  deletedContact: boolean;
  readOnly: boolean;
  hasUnreadMessages: boolean;
  lastMessageAt: string;
  messages: InboxMessageDto[];
}

export interface InboundReplySource {
  contactId: string;
  phoneNumberId: string;
  receivedAt: string;
}

export interface CampaignOutboundForReply {
  id: string;
  contactId: string;
  phoneNumberId: string;
  campaignId: string | null;
  campaignRecipientId: string | null;
  dispatchState:
    | "pending"
    | "reserved"
    | "accepted"
    | "failed"
    | "dispatch_unknown";
  deliveryState: "sent" | "delivered" | "failed" | null;
  acceptedAt: string | null;
}

export interface ReplyCampaignAssociation {
  outboundMessageId: string;
  campaignId: string;
  campaignRecipientId: string;
}

export type InboxRecipientState =
  | "active"
  | "replied"
  | "opted_out"
  | "deleted"
  | "failed"
  | "finished"
  | "stopped";

export interface InboxCampaignRecipient {
  id: string;
  state: InboxRecipientState;
  nextSendAt: string | null;
  stoppedAt: string | null;
}

export interface StopRecipientForReplyResult {
  recipient: InboxCampaignRecipient;
  changed: boolean;
  resumeCampaigns: false;
}

export type ConsentCommand = "opt_out" | "opt_in" | null;
export type SuppressionMutation = "none" | "upsert" | "remove";

export interface ConsentEvaluation {
  command: ConsentCommand;
  keyword: string | null;
  recognized: boolean;
  confirmationRequired: boolean;
  suppressionMutation: SuppressionMutation;
  isSuppressedAfter: boolean;
  stopActiveRecipients: boolean;
  resumeCampaigns: false;
}

export interface ManualMessageInput {
  body: string;
  contact: Pick<InboxContactSource, "deletedAt" | "isSuppressed"> | null;
  phoneNumber: Pick<InboxPhoneNumberSource, "status"> | null;
}

export interface ManualMessageDecision {
  allowed: boolean;
  error: { code: string; message: string } | null;
}
