import type { ProviderFailureDetails } from "../../messaging/errors";
import type {
  DeliveryState,
  ProviderMessageStatus,
} from "../../messaging/types";

export interface InboundSmsWebhookEvent {
  kind: "inbound";
  eventId: string;
  providerMessageId: string;
  fromPhoneNumber: string;
  toPhoneNumber: string;
  body: string;
  occurredAt: string;
  /** Derived only from a signed provider consent signal by the adapter. */
  confirmedConsent: "opt_out" | "opt_in" | "help" | null;
}

export interface SmsStatusWebhookEvent {
  kind: "status";
  eventId: string;
  providerMessageId: string;
  status: ProviderMessageStatus;
  occurredAt: string;
  /** Internal technical code retained for support; never included in client DTOs. */
  providerErrorCode: string | null;
}

export type NormalizedSmsWebhookEvent =
  | InboundSmsWebhookEvent
  | SmsStatusWebhookEvent;

/** Internal server input. Signature parameters and normalized details never leave the backend. */
export interface SmsWebhookRequest {
  requestUrl: string;
  signature: string;
  signatureParameters: Readonly<Record<string, string>>;
  event: NormalizedSmsWebhookEvent;
}

export interface SmsWebhookRoutingKey {
  kind: "inbound_number" | "outbound_message";
  value: string;
}

export interface ResolvedSmsWebhookContext {
  workspaceId: string;
  phoneNumberId: string;
  messageId: string | null;
  campaignId: string | null;
  campaignRecipientId: string | null;
  contactId: string | null;
}

export interface WebhookContact {
  id: string;
  phoneE164: string;
  deletedAt: string | null;
}

export interface WebhookReplyAssociation {
  outboundMessageId: string;
  campaignId: string;
  campaignRecipientId: string;
}

export interface InboundUsageRecord {
  direction: "inbound";
  numSegments: number | null;
  providerCostMicroUsd: number | null;
  includedSegments: 0;
  overageSegments: 0;
  customerBillableAmountMicroUsd: 0;
}

export interface InsertInboundMessageInput {
  eventId: string;
  providerMessageId: string;
  contactId: string;
  phoneNumberId: string;
  body: string;
  receivedAt: string;
  usage: InboundUsageRecord;
}

export interface InsertedInboundMessage {
  id: string;
}

export interface CreateMinimalContactInput {
  phoneE164: string;
  pipelineStageId: string;
  firstName: "";
  lastName: "";
  company: "";
}

export interface FindReplyAssociationInput {
  contactId: string;
  phoneNumberId: string;
  receivedAt: string;
}

export interface ReconcileOutboundUsageInput {
  providerMessageId: string;
  actualSegments: number | null;
  providerCostMicroUsd: number | null;
  observedAt: string;
}

export interface ApplyDeliveryStatusInput {
  providerMessageId: string;
  providerStatus: ProviderMessageStatus;
  deliveryState: DeliveryState;
  occurredAt: string;
}

export interface WebhookUsageObservation {
  actualSegments: number | null;
  providerCostMicroUsd: number | null;
}

export type WebhookSuppressionAction =
  | "none"
  | "upsert_and_stop"
  | "remove_without_resume";

export interface NormalizedWebhookConsent {
  command: "opt_out" | "opt_in" | null;
  keyword: string | null;
  suppressionAction: WebhookSuppressionAction;
  stopForReplyWhenAssociated: boolean;
  resumeCampaigns: false;
}

export interface VerifiedInboundSmsWebhookMutation {
  kind: "inbound";
  expectedContext: ResolvedSmsWebhookContext;
  event: InboundSmsWebhookEvent;
  consent: NormalizedWebhookConsent;
  usage: InboundUsageRecord;
}

export interface VerifiedStatusSmsWebhookMutation {
  kind: "status";
  expectedContext: ResolvedSmsWebhookContext;
  event: SmsStatusWebhookEvent;
  deliveryState: DeliveryState;
  usage: WebhookUsageObservation;
}

export type VerifiedSmsWebhookMutation =
  | VerifiedInboundSmsWebhookMutation
  | VerifiedStatusSmsWebhookMutation;

export interface SmsWebhookAcknowledgement {
  received: true;
}

export type SmsWebhookInternalEventName =
  | "signature_rejected"
  | "signature_verification_failed"
  | "usage_lookup_failed"
  | "invalid_usage_response"
  | "processing_failed";

export interface SmsWebhookInternalEvent {
  event: SmsWebhookInternalEventName;
  workspaceId: string | null;
  providerMessageId: string | null;
  failure: ProviderFailureDetails | null;
  timestamp: string;
}

export type SmsWebhookInternalReporter = (
  event: SmsWebhookInternalEvent,
) => void | Promise<void>;
