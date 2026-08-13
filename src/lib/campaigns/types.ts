import type { DeliveryState, DispatchState } from "../messaging/types";

export const CAMPAIGN_TEMPLATE_VARIABLES = [
  "first_name",
  "last_name",
  "company",
] as const;

export type CampaignTemplateVariable =
  (typeof CAMPAIGN_TEMPLATE_VARIABLES)[number];

export interface CampaignTemplateValues {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
}

export interface CampaignStepDraft {
  body: string;
  /** Null/zero for step one; an integer from 1 through 365 thereafter. */
  waitDaysAfterPrevious?: number | null;
}

export type CampaignValidationIssueCode =
  | "step_count"
  | "empty_message"
  | "invalid_wait"
  | "unsupported_variable"
  | "malformed_variable";

export interface CampaignValidationIssue {
  code: CampaignValidationIssueCode;
  stepIndex: number | null;
  variable?: string;
}

export interface CampaignValidationResult {
  valid: boolean;
  issues: CampaignValidationIssue[];
}

export interface SendWindow {
  timeZone: string;
  start: string;
  end: string;
}

export type CampaignRecipientState =
  | "active"
  | "stopped"
  | "finished";

export interface CampaignRecipientSchedule {
  id: string;
  state: CampaignRecipientState;
  nextSendAt: string | null;
}

export interface CampaignRecipientCandidate extends CampaignTemplateValues {
  contactId: string;
  deletedAt: string | null;
  isSuppressed: boolean;
  hasActiveSequence: boolean;
}

export type RecipientIneligibilityReason =
  | "duplicate_selection"
  | "deleted"
  | "opted_out"
  | "active_sequence"
  | "unsupported_country";

export interface IneligibleRecipient {
  contactId: string;
  reason: RecipientIneligibilityReason;
}

export interface RecipientEligibilityResult {
  eligible: CampaignRecipientCandidate[];
  skipped: IneligibleRecipient[];
  counts: {
    selected: number;
    eligible: number;
    skipped: number;
    duplicateSelection: number;
    deleted: number;
    optedOut: number;
    activeSequence: number;
    unsupportedCountry: number;
  };
}

export interface CampaignLaunchThresholds {
  recipientCount: number;
  overageCredits: number;
}

export interface RecipientCreditEstimate {
  contactId: string;
  renderedMessage: string;
  smsCredits: number;
}

export interface FirstStepCreditEstimate {
  totalSmsCredits: number;
  recipients: RecipientCreditEstimate[];
}

export interface CampaignLaunchAssessment {
  eligibleRecipientCount: number;
  estimatedFirstStepCredits: number;
  currentEffectiveUsageCredits: number;
  includedCredits: number;
  includedCreditsRemaining: number;
  estimatedNewOverageCredits: number;
  projectedUsageCredits: number;
  requiresConfirmation: boolean;
  reasons: Array<"large_volume" | "possible_overage">;
  unsupportedCountryCount: number;
}

export interface CampaignStatisticsRecipient {
  id: string;
  state: CampaignRecipientState;
  hasPendingStep: boolean;
  repliedAt: string | null;
}

export interface CampaignStatisticsOutboundMessage {
  campaignRecipientId: string;
  dispatchState: DispatchState;
  deliveryState: DeliveryState;
  acceptedAt: string | null;
}

export interface CampaignStatistics {
  replies: number;
  sentRecipients: number;
  replyRate: number;
  remaining: number;
}
