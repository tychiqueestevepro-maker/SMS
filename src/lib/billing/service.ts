import type { BillingGateway } from "./gateway";
import {
  BillingProviderError,
  ProductBillingError,
  toProductBillingError,
} from "./gateway";
import type { BillingRepository } from "./repository";

export interface BillingServiceOptions {
  now?: () => Date;
}

export interface StartPaymentSetupInput {
  workspaceId: string;
  ownerEmail: string;
  ownerName: string | null;
  requestId: string;
}

export interface ActivateSubscriptionInput {
  workspaceId: string;
  priceId: string;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new RangeError(`${label} is required.`);
  return normalized;
}

const PAYMENT_SETUP_STATUSES = new Set<string | null>([
  null,
  "not_started",
  "setup_required",
]);

const PORTAL_STATUSES = new Set([
  "active",
  "past_due",
  "unpaid",
  "incomplete",
  "cancellation_scheduled",
  "cancel_at_period_end",
]);

const REUSABLE_PAID_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "cancellation_scheduled",
  "cancel_at_period_end",
]);

function currentPaidPeriod(
  startsAt: string | null,
  endsAt: string | null,
  now: Date,
): boolean {
  if (!startsAt || !endsAt) return false;
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  const current = now.getTime();
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    Number.isFinite(current) &&
    end > start &&
    current >= start &&
    current < end
  );
}

/** Server-only billing orchestration with durable, idempotent external calls. */
export class BillingService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: BillingRepository,
    private readonly gateway: BillingGateway,
    options: BillingServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async startPaymentSetup(input: StartPaymentSetupInput) {
    const workspaceId = required(input.workspaceId, "Workspace ID");
    const requestId = required(input.requestId, "Request ID");
    try {
      let account = await this.repository.getWorkspaceAccount(workspaceId);
      if (
        account.subscriptionId ||
        !PAYMENT_SETUP_STATUSES.has(account.subscriptionStatus)
      ) {
        throw new ProductBillingError("BILLING_SETUP_FAILED");
      }
      const attempt = await this.repository.claimPaymentSetupAttempt({
        requestedAt: this.timestamp(),
        requestId,
        workspaceId,
      });
      if (!attempt.allowed) {
        throw new ProductBillingError("BILLING_SETUP_FAILED");
      }
      let customerId = account.customerId;
      if (!customerId) {
        const customer = await this.gateway.createCustomer({
          email: required(input.ownerEmail, "Owner email"),
          idempotencyKey: `billing-customer:${workspaceId}`,
          name: input.ownerName,
          workspaceId,
        });
        customerId = customer.customerId;
        await this.repository.recordCustomer({
          customerId,
          recordedAt: this.timestamp(),
          workspaceId,
        });
        // Re-read after the idempotent upsert so a concurrent request cannot
        // make subsequent calls against a conflicting customer.
        account = await this.repository.getWorkspaceAccount(workspaceId);
        customerId = account.customerId;
      }
      if (!customerId) throw new ProductBillingError("BILLING_SETUP_FAILED");

      const setup = await this.gateway.createSetupIntent({
        customerId,
        idempotencyKey: `billing-setup:${workspaceId}:${requestId}`,
        workspaceId,
      });
      await this.repository.recordSetupIntent({
        customerId,
        recordedAt: this.timestamp(),
        setupIntentId: setup.setupIntentId,
        workspaceId,
      });
      return setup;
    } catch (error) {
      if (error instanceof ProductBillingError) throw error;
      if (error instanceof BillingProviderError) {
        throw toProductBillingError(error.operation);
      }
      throw new ProductBillingError("BILLING_SETUP_FAILED");
    }
  }

  async createPortalSession(workspaceIdInput: string, returnUrl: string) {
    const workspaceId = required(workspaceIdInput, "Workspace ID");
    try {
      const account = await this.repository.getWorkspaceAccount(workspaceId);
      if (
        !account.customerId ||
        !account.subscriptionId ||
        !PORTAL_STATUSES.has(account.subscriptionStatus ?? "")
      ) {
        throw new ProductBillingError("BILLING_PORTAL_FAILED");
      }
      return await this.gateway.createPortalSession({
        customerId: account.customerId,
        returnUrl: required(returnUrl, "Return URL"),
      });
    } catch (error) {
      if (error instanceof ProductBillingError) throw error;
      throw new ProductBillingError("BILLING_PORTAL_FAILED");
    }
  }

  /**
   * Fail-closed activation seam used by number onboarding. Callers may mark a
   * first approved number Ready only after this returns `active: true`.
   * Existing active subscriptions are reused for later numbers.
   */
  async ensureActiveSubscription(input: ActivateSubscriptionInput) {
    const workspaceId = required(input.workspaceId, "Workspace ID");
    try {
      const account = await this.repository.getWorkspaceAccount(workspaceId);
      if (!account.customerId || !account.defaultPaymentMethodId) {
        throw new ProductBillingError("BILLING_ACTIVATION_FAILED");
      }
      if (account.subscriptionId) {
        if (account.subscriptionPriceId !== required(input.priceId, "Price ID")) {
          throw new ProductBillingError("BILLING_ACTIVATION_FAILED");
        }
        if (
          !REUSABLE_PAID_SUBSCRIPTION_STATUSES.has(
            account.subscriptionStatus ?? "",
          )
        ) {
          // A prior unpaid or terminal subscription is never implicitly
          // replaced; only an explicit operator/customer workflow may start a
          // new plan. A scheduled cancellation merely reuses its paid period.
          throw new ProductBillingError("BILLING_ACTIVATION_FAILED");
        }
        const periodStartsAt = account.currentPeriodStartsAt;
        const periodEndsAt = account.currentPeriodEndsAt;
        if (
          !periodStartsAt ||
          !periodEndsAt ||
          !currentPaidPeriod(
            periodStartsAt,
            periodEndsAt,
            this.now(),
          )
        ) {
          throw new ProductBillingError("BILLING_ACTIVATION_FAILED");
        }
        return {
          active: true as const,
          alreadyActive: true as const,
          periodEndsAt,
          periodStartsAt,
          subscriptionId: account.subscriptionId,
        };
      }

      const priceId = required(input.priceId, "Price ID");
      const price = await this.gateway.getRecurringPrice({ priceId });
      if (
        !price.active ||
        price.currency !== "usd" ||
        price.interval !== "month" ||
        price.intervalCount !== 1 ||
        !Number.isSafeInteger(price.unitAmountCents) ||
        price.unitAmountCents !== account.monthlyPriceCents ||
        price.usageType !== "licensed"
      ) {
        throw new ProductBillingError("BILLING_ACTIVATION_FAILED");
      }

      const subscription = await this.gateway.createSubscription({
        customerId: account.customerId,
        defaultPaymentMethodId: account.defaultPaymentMethodId,
        idempotencyKey: `billing-subscription:${workspaceId}`,
        priceId,
        workspaceId,
      });
      if (subscription.status !== "active") {
        throw new ProductBillingError("BILLING_ACTIVATION_FAILED");
      }
      await this.repository.recordSubscription({
        customerId: account.customerId,
        latestInvoiceId: subscription.latestInvoiceId,
        periodEndsAt: subscription.periodEndsAt,
        periodStartsAt: subscription.periodStartsAt,
        priceId,
        recordedAt: this.timestamp(),
        status: subscription.status,
        subscriptionId: subscription.subscriptionId,
        workspaceId,
      });
      return {
        active: true as const,
        alreadyActive: false as const,
        ...subscription,
      };
    } catch (error) {
      if (error instanceof ProductBillingError) throw error;
      if (error instanceof BillingProviderError) {
        throw toProductBillingError(error.operation);
      }
      throw new ProductBillingError("BILLING_ACTIVATION_FAILED");
    }
  }

  async activateSubscription(input: ActivateSubscriptionInput) {
    return this.ensureActiveSubscription(input);
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
