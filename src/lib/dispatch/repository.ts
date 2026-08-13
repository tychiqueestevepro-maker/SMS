import type { ProviderFailureDetails } from "../messaging/errors";
import type { SendMessageResult } from "../messaging/types";
import type { DeliveryState } from "../messaging/types";
import type {
  DispatchClaim,
  DispatchUnknownReason,
  FinalValidationResult,
  ReconciliationClaim,
  ReconciliationDeferralReason,
} from "./types";

export interface ClaimDispatchInput {
  workerId: string;
  now: string;
}

export interface FinalValidateDispatchInput {
  claim: DispatchClaim;
  now: string;
}

export interface MarkAcceptedInput {
  claim: DispatchClaim;
  result: SendMessageResult;
  persistedAt: string;
}

export interface MarkKnownFailureInput {
  claim: DispatchClaim;
  failure: ProviderFailureDetails;
  failedAt: string;
}

export interface MarkDispatchUnknownInput {
  claim: DispatchClaim;
  reason: DispatchUnknownReason;
  providerMessageId: string | null;
  failure: ProviderFailureDetails | null;
  markedAt: string;
}

export interface ClaimReconciliationInput {
  workerId: string;
  now: string;
}

export interface CompleteReconciliationInput {
  claim: ReconciliationClaim;
  actualSegments: number;
  providerCostMicroUsd: number | null;
  providerCostPending: boolean;
  reconciledAt: string;
}

export interface DeferReconciliationInput {
  claim: ReconciliationClaim;
  reason: ReconciliationDeferralReason;
  deferredAt: string;
}

export interface RecordReconciledDeliveryStateInput {
  claim: ReconciliationClaim;
  deliveryState: Exclude<DeliveryState, null>;
  observedAt: string;
}

export interface RecordReconciledProviderCostInput {
  claim: ReconciliationClaim;
  providerCostMicroUsd: number | null;
  providerCostPending: boolean;
  observedAt: string;
}

/**
 * Persistence boundary for the dispatch workers.
 *
 * `claimAndReserveNext` must be one DB transaction using `FOR UPDATE SKIP
 * LOCKED`, create/retain the unique message reservation, and increment reserved
 * usage exactly once. `(campaign_recipient_id, step_order)` remains unique.
 *
 * `finalValidateAndBeginProviderAttempt` must lock the current rows, recheck
 * campaign, recipient, contact, suppression, workspace authorization, Ready
 * number, effective safety-cap usage, and reservation validity. On success it
 * durably marks this claim as the only authorized provider attempt before
 * returning. On rejection it atomically releases any cancelable reservation
 * and applies the appropriate stop/defer disposition.
 *
 * Terminal transition methods are idempotent. `dispatch_unknown` is terminal,
 * stops the recipient, retains the reservation for reconciliation, and is never
 * claimable again. Accepted reservations remain reserved until real segments
 * are reconciled. Known pre-accept failures release their reservations.
 */
export interface DispatchRepository {
  claimAndReserveNext(input: ClaimDispatchInput): Promise<DispatchClaim | null>;

  finalValidateAndBeginProviderAttempt(
    input: FinalValidateDispatchInput,
  ): Promise<FinalValidationResult>;

  markAccepted(input: MarkAcceptedInput): Promise<void>;

  markKnownFailureAndRelease(input: MarkKnownFailureInput): Promise<void>;

  markDispatchUnknownAndStop(input: MarkDispatchUnknownInput): Promise<void>;

  claimNextReconciliation(
    input: ClaimReconciliationInput,
  ): Promise<ReconciliationClaim | null>;

  /** Persists callback-equivalent state observed by polling the accepted send. */
  recordReconciledDeliveryState(
    input: RecordReconciledDeliveryStateInput,
  ): Promise<void>;

  /** Cost observation is independent from segment availability/customer usage. */
  recordReconciledProviderCost(
    input: RecordReconciledProviderCostInput,
  ): Promise<void>;

  /**
   * Transactionally removes the original estimate and adds actual segments
   * once, preserving billingPeriodId and usagePosition. Replays must not double
   * count. A missing cost may remain separately reconcilable.
   */
  completeReconciliation(input: CompleteReconciliationInput): Promise<void>;

  deferReconciliation(input: DeferReconciliationInput): Promise<void>;
}
