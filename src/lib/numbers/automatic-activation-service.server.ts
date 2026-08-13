import "server-only";

import { ProductBillingError } from "@/lib/billing/gateway";
import { ProductMessagingError } from "@/lib/messaging/errors";

import type {
  AutomaticNumberActivationClaim,
  AutomaticNumberActivationRepository,
} from "./automatic-activation-repository";

export interface ActiveWorkspaceSubscription {
  active: true;
  periodEndsAt: string;
  periodStartsAt: string;
  subscriptionId: string;
}

export type EnsureWorkspaceSubscriptionActive = (
  workspaceId: string,
  promotionCode?: string,
) => Promise<ActiveWorkspaceSubscription>;

export interface AutomaticNumberActivationResult {
  alreadyReady: boolean;
  numberId: string;
  subscriptionId: string | null;
  workspaceId: string;
}

function validPeriod(startsAt: string, endsAt: string): boolean {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

export class AutomaticNumberActivationService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: AutomaticNumberActivationRepository,
    private readonly ensureSubscriptionActive: EnsureWorkspaceSubscriptionActive,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async activate(input: {
    numberId: string;
    promotionCode?: string;
    workspaceId: string;
  }): Promise<AutomaticNumberActivationResult> {
    let claim: AutomaticNumberActivationClaim;
    try {
      claim = await this.repository.claimPurchasedNumber({
        numberId: input.numberId,
        requestedAt: this.timestamp(),
        workspaceId: input.workspaceId,
      });
    } catch {
      throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
    }

    if (
      claim.numberId !== input.numberId ||
      claim.workspaceId !== input.workspaceId
    ) {
      throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
    }
    if (claim.disposition === "already_ready") {
      return {
        alreadyReady: true,
        numberId: claim.numberId,
        subscriptionId: null,
        workspaceId: claim.workspaceId,
      };
    }
    if (
      claim.disposition === "provider_not_ready" ||
      claim.disposition === "in_progress" ||
      !claim.activationId
    ) {
      throw new ProductMessagingError("PHONE_NUMBER_NOT_READY");
    }

    try {
      const subscription = await this.ensureSubscriptionActive(
        claim.workspaceId,
        input.promotionCode,
      );
      if (
        subscription.active !== true ||
        !subscription.subscriptionId.trim() ||
        !validPeriod(subscription.periodStartsAt, subscription.periodEndsAt)
      ) {
        throw new ProductBillingError("BILLING_ACTIVATION_FAILED");
      }

      await this.repository.completePurchasedNumber({
        activationId: claim.activationId,
        completedAt: this.timestamp(),
        numberId: claim.numberId,
        periodEndsAt: subscription.periodEndsAt,
        periodStartsAt: subscription.periodStartsAt,
        subscriptionId: subscription.subscriptionId,
        workspaceId: claim.workspaceId,
      });

      return {
        alreadyReady: false,
        numberId: claim.numberId,
        subscriptionId: subscription.subscriptionId,
        workspaceId: claim.workspaceId,
      };
    } catch (error) {
      try {
        await this.repository.failPurchasedNumber({
          activationId: claim.activationId,
          failedAt: this.timestamp(),
          failureCode: this.failureCode(error),
          numberId: claim.numberId,
          workspaceId: claim.workspaceId,
        });
      } catch {
        // The number remains Pending because only the completion RPC can make
        // it Ready. A stale claim can also be reclaimed after fifteen minutes.
      }

      if (error instanceof ProductBillingError) throw error;
      throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
    }
  }

  private failureCode(error: unknown): string {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
    ) {
      return (error as { code: string }).code;
    }
    return "AUTOMATIC_NUMBER_ACTIVATION_FAILED";
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
