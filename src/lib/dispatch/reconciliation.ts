import { getProviderFailureDetails } from "../messaging/errors";
import type { SmsProvider } from "../messaging/provider";
import type { DeliveryState, ProviderMessageStatus } from "../messaging/types";
import { correlationLogFields, writeDispatchLog } from "./logging";
import type { DispatchRepository } from "./repository";
import type {
  DispatchLogger,
  ReconciliationClaim,
  ReconciliationDeferralReason,
  ReconciliationRunResult,
} from "./types";

export interface DispatchReconcilerOptions {
  workerId: string;
  now?: () => Date;
  logger?: DispatchLogger;
}

function validPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function deliveryState(
  status: ProviderMessageStatus,
): Exclude<DeliveryState, null> | null {
  if (status === "sent") return "sent";
  if (status === "delivered") return "delivered";
  if (status === "failed") return "failed";
  return null;
}

/** Reconciles real usage without ever issuing a second send. */
export class DispatchReconciler {
  private readonly now: () => Date;

  constructor(
    private readonly repository: DispatchRepository,
    private readonly provider: SmsProvider,
    private readonly options: DispatchReconcilerOptions,
  ) {
    if (!options.workerId.trim()) throw new RangeError("Worker ID is required.");
    this.now = options.now ?? (() => new Date());
  }

  async runOnce(): Promise<ReconciliationRunResult> {
    const claim = await this.repository.claimNextReconciliation({
      workerId: this.options.workerId,
      now: this.timestamp(),
    });
    if (!claim) return { outcome: "idle" };

    await this.log(claim, "reconciliation_claimed", "accepted");
    await this.reconcileDeliveryState(claim);

    const costObservation = await this.reconcileProviderCost(claim);
    let segmentsResult;
    try {
      segmentsResult = await this.provider.getActualSegments({
        workspaceId: claim.workspaceId,
        providerMessageId: claim.providerMessageId,
      });
    } catch (error) {
      const failure = getProviderFailureDetails(error, "getActualSegments");
      await this.log(
        claim,
        "reconciliation_provider_lookup_failed",
        "accepted",
        failure.kind,
        failure.providerCode,
      );
      return this.defer(claim, "segments_lookup_failed");
    }

    if (segmentsResult.numSegments === null) {
      return this.defer(claim, "segments_pending");
    }
    if (
      segmentsResult.providerMessageId !== claim.providerMessageId ||
      !validPositiveInteger(segmentsResult.numSegments)
    ) {
      return this.defer(claim, "invalid_provider_response");
    }

    await this.repository.completeReconciliation({
      claim,
      actualSegments: segmentsResult.numSegments,
      providerCostMicroUsd: costObservation.providerCostMicroUsd,
      providerCostPending: costObservation.providerCostPending,
      reconciledAt: this.timestamp(),
    });
    await this.log(claim, "reconciliation_completed", "accepted");
    return {
      outcome: "reconciled",
      messageId: claim.messageId,
      actualSegments: segmentsResult.numSegments,
      providerCostPending: costObservation.providerCostPending,
    };
  }

  private async reconcileProviderCost(claim: ReconciliationClaim): Promise<{
    providerCostMicroUsd: number | null;
    providerCostPending: boolean;
  }> {
    let providerCostMicroUsd: number | null = null;
    let providerCostPending = true;
    try {
      const cost = await this.provider.getMessageCost({
        workspaceId: claim.workspaceId,
        providerMessageId: claim.providerMessageId,
      });
      if (
        cost.providerMessageId !== claim.providerMessageId ||
        (cost.amountMicroUsd !== null &&
          (!Number.isSafeInteger(cost.amountMicroUsd) || cost.amountMicroUsd < 0))
      ) {
        return { providerCostMicroUsd: null, providerCostPending: true };
      }
      providerCostMicroUsd = cost.amountMicroUsd;
      providerCostPending = cost.amountMicroUsd === null;
    } catch (error) {
      const failure = getProviderFailureDetails(error, "getMessageCost");
      await this.log(
        claim,
        "reconciliation_provider_lookup_failed",
        "accepted",
        failure.kind,
        failure.providerCode,
      );
      return { providerCostMicroUsd: null, providerCostPending: true };
    }

    await this.repository.recordReconciledProviderCost({
      claim,
      providerCostMicroUsd,
      providerCostPending,
      observedAt: this.timestamp(),
    });
    return { providerCostMicroUsd, providerCostPending };
  }

  private async reconcileDeliveryState(
    claim: ReconciliationClaim,
  ): Promise<void> {
    try {
      const result = await this.provider.getMessageStatus({
        workspaceId: claim.workspaceId,
        providerMessageId: claim.providerMessageId,
      });
      const observedState = deliveryState(result.status);
      if (
        result.providerMessageId !== claim.providerMessageId ||
        !Number.isFinite(Date.parse(result.updatedAt)) ||
        observedState === null
      ) {
        return;
      }
      await this.repository.recordReconciledDeliveryState({
        claim,
        deliveryState: observedState,
        observedAt: result.updatedAt,
      });
    } catch (error) {
      const failure = getProviderFailureDetails(error, "getMessageStatus");
      await this.log(
        claim,
        "reconciliation_provider_lookup_failed",
        "accepted",
        failure.kind,
        failure.providerCode,
      );
      // Delivery observation is independent from cost and usage reconciliation.
    }
  }

  private async defer(
    claim: ReconciliationClaim,
    reason: ReconciliationDeferralReason,
  ): Promise<ReconciliationRunResult> {
    await this.repository.deferReconciliation({
      claim,
      reason,
      deferredAt: this.timestamp(),
    });
    await this.log(claim, "reconciliation_deferred", "accepted");
    return { outcome: "deferred", messageId: claim.messageId, reason };
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private log(
    claim: ReconciliationClaim,
    event: Parameters<typeof writeDispatchLog>[1]["event"],
    dispatchState: Parameters<typeof writeDispatchLog>[1]["dispatch_state"],
    providerFailureKind?: Parameters<
      typeof writeDispatchLog
    >[1]["provider_failure_kind"],
    providerCode?: string | null,
  ): Promise<void> {
    return writeDispatchLog(this.options.logger, {
      ...correlationLogFields(claim),
      provider_message_id: claim.providerMessageId,
      dispatch_state: dispatchState,
      event,
      timestamp: this.timestamp(),
      provider_failure_kind: providerFailureKind,
      provider_code: providerCode,
    });
  }
}
