import type { ProviderFailureDetails } from "../messaging/errors";
import type { DispatchState, SendMessageInput } from "../messaging/types";

export interface DispatchCorrelation {
  workspaceId: string;
  campaignId: string;
  campaignRecipientId: string;
  contactId: string;
  messageId: string;
}

export interface DispatchClaim extends DispatchCorrelation {
  claimToken: string;
  reservationId: string;
  estimatedSegments: number;
}

export interface FinalDispatchValidationSnapshot {
  campaignActive: boolean;
  recipientActive: boolean;
  contactActive: boolean;
  suppressed: boolean;
  workspaceAuthorized: boolean;
  phoneNumberReady: boolean;
  reservationValid: boolean;
  actualOutboundSegments: number;
  reservedOutboundSegments: number;
  safetyCapSegments: number;
}

export type FinalValidationFailureReason =
  | "campaign_inactive"
  | "recipient_inactive"
  | "contact_inactive"
  | "suppressed"
  | "workspace_unauthorized"
  | "phone_number_not_ready"
  | "outside_send_window"
  | "reservation_invalid"
  | "safety_cap_reached";

export interface FinalValidationAccepted {
  ok: true;
  /** Authoritative values read during the final locked validation. */
  sendInput: SendMessageInput;
}

export interface FinalValidationRejected {
  ok: false;
  reason: FinalValidationFailureReason;
  /** The repository atomically releases any still-cancelable estimate. */
  reservationReleased: boolean;
  recipientStopped: boolean;
}

export type FinalValidationResult =
  | FinalValidationAccepted
  | FinalValidationRejected;

export type DispatchUnknownReason =
  | "provider_result_ambiguous"
  | "post_provider_persistence_failed";

export type DispatchRunResult =
  | { outcome: "idle" }
  | {
      outcome: "blocked";
      messageId: string;
      reason: FinalValidationFailureReason;
    }
  | {
      outcome: "accepted";
      messageId: string;
      providerMessageId: string;
    }
  | {
      outcome: "known_failed";
      messageId: string;
      failureKind: ProviderFailureDetails["kind"];
    }
  | {
      outcome: "dispatch_unknown";
      messageId: string;
      reason: DispatchUnknownReason;
    };

export interface ReconciliationClaim {
  workspaceId: string;
  campaignId: string | null;
  campaignRecipientId: string | null;
  contactId: string;
  messageId: string;
  reconciliationToken: string;
  reservationId: string;
  providerMessageId: string;
  /** Immutable billing attribution assigned when the outbound was accepted. */
  billingPeriodId: string;
  usagePosition: number;
}

export type ReconciliationDeferralReason =
  | "segments_pending"
  | "segments_lookup_failed"
  | "invalid_provider_response";

export type ReconciliationRunResult =
  | { outcome: "idle" }
  | {
      outcome: "deferred";
      messageId: string;
      reason: ReconciliationDeferralReason;
    }
  | {
      outcome: "reconciled";
      messageId: string;
      actualSegments: number;
      providerCostPending: boolean;
    };

export type DispatchLogEventName =
  | "dispatch_claimed"
  | "dispatch_validation_rejected"
  | "provider_send_started"
  | "provider_send_accepted"
  | "provider_send_known_failed"
  | "dispatch_unknown"
  | "dispatch_transition_persistence_failed"
  | "reconciliation_claimed"
  | "reconciliation_deferred"
  | "reconciliation_completed"
  | "reconciliation_provider_lookup_failed";

export interface DispatchLogEvent {
  workspace_id: string | null;
  campaign_id: string | null;
  campaign_recipient_id: string | null;
  contact_id: string | null;
  message_id: string | null;
  provider_message_id: string | null;
  dispatch_state: DispatchState | null;
  event: DispatchLogEventName;
  timestamp: string;
  validation_reason?: FinalValidationFailureReason;
  unknown_reason?: DispatchUnknownReason;
  provider_failure_kind?: ProviderFailureDetails["kind"];
  provider_code?: string | null;
}

export type DispatchLogger = (
  event: DispatchLogEvent,
) => void | Promise<void>;
