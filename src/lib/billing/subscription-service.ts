import "server-only";

import type { BillingGateway } from "./gateway";
import { BillingProviderError, ProductBillingError } from "./gateway";
import type { BillingRuntimeRepository } from "./runtime-repository";

export class BillingSubscriptionService {
  private readonly now: () => Date;
  private readonly reportInternalEvent?: (input: {
    details?: Readonly<Record<string, unknown>>;
    event:
      | "billing_cancellation_scheduled"
      | "billing_cancellation_replayed"
      | "billing_cancellation_failed"
      | "billing_grace_periods_expired";
    timestamp: string;
    workspaceId: string | null;
  }) => void | Promise<void>;

  constructor(
    private readonly repository: BillingRuntimeRepository,
    private readonly gateway: BillingGateway,
    options: {
      now?: () => Date;
      reportInternalEvent?: BillingSubscriptionService["reportInternalEvent"];
    } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.reportInternalEvent = options.reportInternalEvent;
  }

  async requestCancellation(workspaceIdInput: string): Promise<{
    alreadyScheduled: boolean;
  }> {
    const workspaceId = workspaceIdInput.trim();
    if (!workspaceId) throw new ProductBillingError("BILLING_CANCELLATION_FAILED");
    try {
      const prepared = await this.repository.prepareSubscriptionCancellation({
        requestedAt: this.timestamp(),
        workspaceId,
      });
      if (prepared.state === "completed") {
        await this.report({
          event: "billing_cancellation_replayed",
          timestamp: this.timestamp(),
          workspaceId,
        });
        return { alreadyScheduled: true };
      }
      const result = await this.gateway.scheduleSubscriptionCancellation({
        idempotencyKey: `billing-cancel:${workspaceId}:${prepared.subscriptionId}`,
        subscriptionId: prepared.subscriptionId,
      });
      if (!result.cancelAtPeriodEnd) {
        throw new Error("Cancellation was not scheduled.");
      }
      await this.repository.completeSubscriptionCancellation({
        cancellationRequestId: prepared.cancellationRequestId,
        completedAt: this.timestamp(),
        subscriptionId: prepared.subscriptionId,
        workspaceId,
      });
      await this.report({
        event: "billing_cancellation_scheduled",
        timestamp: this.timestamp(),
        workspaceId,
        details: { cancellation_request_id: prepared.cancellationRequestId },
      });
      return { alreadyScheduled: false };
    } catch (error) {
      await this.report({
        event: "billing_cancellation_failed",
        timestamp: this.timestamp(),
        workspaceId,
        details: {
          failure_code:
            error instanceof BillingProviderError
              ? `provider_${error.operation}`
              : "persistence_or_validation_failed",
        },
      });
      if (error instanceof ProductBillingError) throw error;
      if (error instanceof BillingProviderError) {
        throw new ProductBillingError("BILLING_CANCELLATION_FAILED");
      }
      throw new ProductBillingError("BILLING_CANCELLATION_FAILED");
    }
  }

  async expireGracePeriods(limit = 100): Promise<{ expiredCount: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError("Grace expiration limit must be between 1 and 1000.");
    }
    const result = await this.repository.expireGracePeriods({
      limit,
      now: this.timestamp(),
    });
    await this.report({
      event: "billing_grace_periods_expired",
      timestamp: this.timestamp(),
      workspaceId: null,
      details: { expired_count: result.expiredCount },
    });
    return result;
  }

  private async report(input: Parameters<NonNullable<BillingSubscriptionService["reportInternalEvent"]>>[0]): Promise<void> {
    if (!this.reportInternalEvent) return;
    try {
      await this.reportInternalEvent(input);
    } catch {
      // Operational logging must not change cancellation semantics.
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
