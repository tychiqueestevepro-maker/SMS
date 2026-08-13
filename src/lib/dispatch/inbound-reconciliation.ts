import { getProviderFailureDetails } from "../messaging/errors";
import type { SmsProvider } from "../messaging/provider";

export interface InboundReconciliationClaim {
  attemptCount: number;
  billingPeriodId: string;
  messageId: string;
  providerMessageId: string;
  reconciliationToken: string;
  workspaceId: string;
}

export interface InboundReconciliationRepository {
  claimNext(input: {
    now: string;
    workerId: string;
  }): Promise<InboundReconciliationClaim | null>;
  complete(input: {
    actualSegments: number | null;
    claim: InboundReconciliationClaim;
    providerCostMicroUsd: number | null;
    providerCostPending: boolean;
    reconciledAt: string;
  }): Promise<void>;
  defer(input: {
    claim: InboundReconciliationClaim;
    deferredAt: string;
    errorCode: string;
    nextAttemptAt: string;
  }): Promise<void>;
}

export type InboundReconciliationResult =
  | { outcome: "idle" }
  | {
      outcome: "deferred";
      messageId: string;
      reason: string;
    }
  | {
      outcome: "reconciled";
      messageId: string;
      actualSegments: number | null;
      providerCostPending: boolean;
    };

export interface InboundReconciliationLogEvent {
  event:
    | "inbound_reconciliation_claimed"
    | "inbound_reconciliation_deferred"
    | "inbound_reconciliation_completed"
    | "inbound_reconciliation_lookup_failed";
  workspace_id: string;
  message_id: string;
  provider_message_id: string;
  timestamp: string;
  failure_kind?: string;
  provider_code?: string | null;
  reason?: string;
}

export interface InboundReconcilerOptions {
  workerId: string;
  now?: () => Date;
  logger?: (
    event: InboundReconciliationLogEvent,
  ) => void | Promise<void>;
}

function positiveInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

function safeCost(value: number | null): boolean {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

/** Fills inbound provider cost/segments without ever adding customer usage. */
export class InboundMessageReconciler {
  private readonly now: () => Date;

  constructor(
    private readonly repository: InboundReconciliationRepository,
    private readonly provider: SmsProvider,
    private readonly options: InboundReconcilerOptions,
  ) {
    if (!options.workerId.trim()) throw new RangeError("Worker ID is required.");
    this.now = options.now ?? (() => new Date());
  }

  async runOnce(): Promise<InboundReconciliationResult> {
    const claim = await this.repository.claimNext({
      workerId: this.options.workerId,
      now: this.timestamp(),
    });
    if (!claim) return { outcome: "idle" };
    await this.log(claim, { event: "inbound_reconciliation_claimed" });

    let actualSegments: number | null = null;
    let segmentLookupFailed = false;
    try {
      const result = await this.provider.getActualSegments({
        workspaceId: claim.workspaceId,
        providerMessageId: claim.providerMessageId,
      });
      if (
        result.providerMessageId !== claim.providerMessageId ||
        (result.numSegments !== null && !positiveInteger(result.numSegments))
      ) {
        return this.defer(claim, "invalid_segments_response");
      }
      actualSegments = result.numSegments;
    } catch (error) {
      segmentLookupFailed = true;
      const failure = getProviderFailureDetails(error, "getActualSegments");
      await this.log(claim, {
        event: "inbound_reconciliation_lookup_failed",
        failure_kind: failure.kind,
        provider_code: failure.providerCode,
        reason: "segments_lookup_failed",
      });
    }

    let providerCostMicroUsd: number | null = null;
    let providerCostPending = true;
    let costLookupFailed = false;
    try {
      const result = await this.provider.getMessageCost({
        workspaceId: claim.workspaceId,
        providerMessageId: claim.providerMessageId,
      });
      if (
        result.providerMessageId !== claim.providerMessageId ||
        !safeCost(result.amountMicroUsd)
      ) {
        return this.defer(claim, "invalid_cost_response");
      }
      providerCostMicroUsd = result.amountMicroUsd;
      providerCostPending = result.amountMicroUsd === null;
    } catch (error) {
      costLookupFailed = true;
      const failure = getProviderFailureDetails(error, "getMessageCost");
      await this.log(claim, {
        event: "inbound_reconciliation_lookup_failed",
        failure_kind: failure.kind,
        provider_code: failure.providerCode,
        reason: "cost_lookup_failed",
      });
    }

    if (segmentLookupFailed && costLookupFailed) {
      return this.defer(claim, "provider_lookup_failed");
    }

    await this.repository.complete({
      actualSegments,
      claim,
      providerCostMicroUsd,
      providerCostPending,
      reconciledAt: this.timestamp(),
    });
    await this.log(claim, { event: "inbound_reconciliation_completed" });
    return {
      outcome: "reconciled",
      messageId: claim.messageId,
      actualSegments,
      providerCostPending,
    };
  }

  private async defer(
    claim: InboundReconciliationClaim,
    reason: string,
  ): Promise<InboundReconciliationResult> {
    const deferredAt = this.now();
    const delayMinutes = Math.min(
      24 * 60,
      5 * 2 ** Math.min(Math.max(claim.attemptCount - 1, 0), 8),
    );
    const nextAttemptAt = new Date(
      deferredAt.getTime() + delayMinutes * 60_000,
    );
    await this.repository.defer({
      claim,
      deferredAt: deferredAt.toISOString(),
      errorCode: reason,
      nextAttemptAt: nextAttemptAt.toISOString(),
    });
    await this.log(claim, {
      event: "inbound_reconciliation_deferred",
      reason,
    });
    return { outcome: "deferred", messageId: claim.messageId, reason };
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private async log(
    claim: InboundReconciliationClaim,
    fields: Omit<
      InboundReconciliationLogEvent,
      "workspace_id" | "message_id" | "provider_message_id" | "timestamp"
    >,
  ): Promise<void> {
    if (!this.options.logger) return;
    try {
      await this.options.logger({
        workspace_id: claim.workspaceId,
        message_id: claim.messageId,
        provider_message_id: claim.providerMessageId,
        timestamp: this.timestamp(),
        ...fields,
      });
    } catch {
      // Observability cannot change reconciliation behavior.
    }
  }
}
