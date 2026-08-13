import { describe, expect, it, vi } from "vitest";

import { BillingProviderError, type BillingGateway } from "./gateway";
import type { BillingRepository, WorkspaceBillingAccount } from "./repository";
import { BillingService } from "./service";

function fixtures(accountOverrides: Partial<WorkspaceBillingAccount> = {}) {
  const account: WorkspaceBillingAccount = {
    customerId: null,
    currentPeriodEndsAt: null,
    currentPeriodStartsAt: null,
    defaultPaymentMethodId: null,
    monthlyPriceCents: 8_999,
    subscriptionId: null,
    subscriptionPriceId: accountOverrides.subscriptionId ? "price-1" : null,
    subscriptionStatus: null,
    workspaceId: "workspace-1",
    ...accountOverrides,
  };
  const repository: BillingRepository = {
    claimPaymentSetupAttempt: vi.fn(async () => ({
      allowed: true,
      replayed: false,
      retryAfterSeconds: 0,
    })),
    getWorkspaceAccount: vi.fn(async () => ({ ...account })),
    recordCustomer: vi.fn(async (input) => {
      account.customerId = input.customerId;
    }),
    recordSetupIntent: vi.fn(async () => undefined),
    recordSubscription: vi.fn(async (input) => {
      account.subscriptionId = input.subscriptionId;
      account.subscriptionPriceId = input.priceId;
      account.subscriptionStatus = input.status;
    }),
  };
  const gateway: BillingGateway = {
    addAdditionalUsageInvoiceLine: vi.fn(),
    createCustomer: vi.fn(async () => ({ customerId: "customer-1" })),
    createPortalSession: vi.fn(async () => ({ url: "https://billing.example" })),
    createSetupIntent: vi.fn(async () => ({
      clientSecret: "setup-secret",
      setupIntentId: "setup-1",
    })),
    createSubscription: vi.fn(async () => ({
      latestInvoiceId: "invoice-1",
      periodEndsAt: "2026-09-10T12:00:00.000Z",
      periodStartsAt: "2026-08-10T12:00:00.000Z",
      status: "active" as const,
      subscriptionId: "subscription-1",
    })),
    getRecurringPrice: vi.fn(async () => ({
      active: true,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
      unitAmountCents: 8_999,
      usageType: "licensed",
    })),
    scheduleSubscriptionCancellation: vi.fn(),
    verifyWebhook: vi.fn(),
  };
  return { account, gateway, repository };
}

describe("BillingService", () => {
  it("idempotently creates a customer before an off-session setup", async () => {
    const { gateway, repository } = fixtures();
    const service = new BillingService(repository, gateway, {
      now: () => new Date("2026-08-10T12:00:00.000Z"),
    });

    await expect(service.startPaymentSetup({
      ownerEmail: "owner@example.com",
      ownerName: "Owner",
      requestId: "request-1",
      workspaceId: "workspace-1",
    })).resolves.toEqual({
      clientSecret: "setup-secret",
      setupIntentId: "setup-1",
    });
    expect(gateway.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "billing-customer:workspace-1" }),
    );
    expect(gateway.createSetupIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "billing-setup:workspace-1:request-1",
      }),
    );
    expect(repository.recordSetupIntent).toHaveBeenCalledTimes(1);
    expect(repository.claimPaymentSetupAttempt).toHaveBeenCalledWith({
      requestedAt: "2026-08-10T12:00:00.000Z",
      requestId: "request-1",
      workspaceId: "workspace-1",
    });
  });

  it("does not call billing infrastructure when payment setup is throttled", async () => {
    const { gateway, repository } = fixtures();
    vi.mocked(repository.claimPaymentSetupAttempt).mockResolvedValue({
      allowed: false,
      replayed: false,
      retryAfterSeconds: 60,
    });
    const service = new BillingService(repository, gateway, {
      now: () => new Date("2026-08-10T12:00:00.000Z"),
    });

    await expect(service.startPaymentSetup({
      ownerEmail: "owner@example.com",
      ownerName: "Owner",
      requestId: "request-throttled",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "BILLING_SETUP_FAILED" });
    expect(gateway.createCustomer).not.toHaveBeenCalled();
    expect(gateway.createSetupIntent).not.toHaveBeenCalled();
  });

  it.each(["grace_period", "canceled", "ended"])(
    "does not expose payment setup in terminal %s state",
    async (subscriptionStatus) => {
      const { gateway, repository } = fixtures({
        customerId: "customer-1",
        defaultPaymentMethodId: "payment-method-1",
        subscriptionId: "subscription-existing",
        subscriptionStatus,
      });
      const service = new BillingService(repository, gateway);

      await expect(
        service.startPaymentSetup({
          ownerEmail: "owner@example.com",
          ownerName: "Owner",
          requestId: "request-1",
          workspaceId: "workspace-1",
        }),
      ).rejects.toMatchObject({ code: "BILLING_SETUP_FAILED" });
      expect(gateway.createSetupIntent).not.toHaveBeenCalled();
    },
  );

  it("opens billing management only for a nonterminal subscription", async () => {
    const active = fixtures({
      customerId: "customer-1",
      subscriptionId: "subscription-existing",
      subscriptionStatus: "active",
    });
    const activeService = new BillingService(active.repository, active.gateway);
    await expect(
      activeService.createPortalSession(
        "workspace-1",
        "https://www.riink.app/settings",
      ),
    ).resolves.toEqual({ url: "https://billing.example" });

    const grace = fixtures({
      customerId: "customer-1",
      subscriptionId: "subscription-existing",
      subscriptionStatus: "grace_period",
    });
    const graceService = new BillingService(grace.repository, grace.gateway);
    await expect(
      graceService.createPortalSession(
        "workspace-1",
        "https://www.riink.app/settings",
      ),
    ).rejects.toMatchObject({ code: "BILLING_PORTAL_FAILED" });
    expect(grace.gateway.createPortalSession).not.toHaveBeenCalled();
  });

  it("activates only with a stored payment method and persists the exact period", async () => {
    const { gateway, repository } = fixtures({
      customerId: "customer-1",
      currentPeriodEndsAt: "2026-09-10T12:00:00.000Z",
      currentPeriodStartsAt: "2026-08-10T12:00:00.000Z",
      defaultPaymentMethodId: "payment-method-1",
    });
    const service = new BillingService(repository, gateway);

    await expect(service.activateSubscription({
      priceId: "price-1",
      workspaceId: "workspace-1",
    })).resolves.toMatchObject({
      alreadyActive: false,
      subscriptionId: "subscription-1",
    });
    expect(repository.recordSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        periodEndsAt: "2026-09-10T12:00:00.000Z",
        periodStartsAt: "2026-08-10T12:00:00.000Z",
        priceId: "price-1",
      }),
    );
    expect(gateway.getRecurringPrice).toHaveBeenCalledWith({ priceId: "price-1" });
  });

  it("normalizes and forwards a promo code only for a new subscription", async () => {
    const { gateway, repository } = fixtures({
      customerId: "customer-1",
      defaultPaymentMethodId: "payment-method-1",
    });
    const service = new BillingService(repository, gateway);

    await service.ensureActiveSubscription({
      priceId: "price-1",
      promotionCode: "  save20  ",
      workspaceId: "workspace-1",
    });

    expect(gateway.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "billing-subscription:workspace-1:SAVE20",
        promotionCode: "SAVE20",
      }),
    );
  });

  it("returns a product safe error for an invalid promo code", async () => {
    const { gateway, repository } = fixtures({
      customerId: "customer-1",
      defaultPaymentMethodId: "payment-method-1",
    });
    vi.mocked(gateway.createSubscription).mockRejectedValue(
      new BillingProviderError({
        operation: "create_subscription",
        providerCode: "PROMOTION_CODE_INVALID",
        providerMessage: "Raw provider promotion error",
      }),
    );
    const service = new BillingService(repository, gateway);

    await expect(
      service.ensureActiveSubscription({
        priceId: "price-1",
        promotionCode: "EXPIRED",
        workspaceId: "workspace-1",
      }),
    ).rejects.toMatchObject({
      code: "PROMOTION_CODE_INVALID",
      message: "This promo code is invalid or no longer available.",
    });
    expect(repository.recordSubscription).not.toHaveBeenCalled();
  });

  it.each([
    ["inactive", { active: false }],
    ["wrong amount", { unitAmountCents: 9_000 }],
    ["wrong currency", { currency: "eur" }],
    ["wrong interval", { interval: "year" }],
    ["wrong interval count", { intervalCount: 3 }],
    ["metered usage", { usageType: "metered" }],
  ])("fails closed when the configured price is %s", async (_label, priceOverride) => {
    const { gateway, repository } = fixtures({
      customerId: "customer-1",
      defaultPaymentMethodId: "payment-method-1",
    });
    vi.mocked(gateway.getRecurringPrice).mockResolvedValue({
      active: true,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
      unitAmountCents: 8_999,
      usageType: "licensed",
      ...priceOverride,
    });
    const service = new BillingService(repository, gateway);

    await expect(service.ensureActiveSubscription({
      priceId: "price-1",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "BILLING_ACTIVATION_FAILED" });
    expect(gateway.createSubscription).not.toHaveBeenCalled();
    expect(repository.recordSubscription).not.toHaveBeenCalled();
  });

  it("does not create a second subscription when the workspace is already active", async () => {
    const { gateway, repository } = fixtures({
      customerId: "customer-1",
      currentPeriodEndsAt: "2026-09-10T12:00:00.000Z",
      currentPeriodStartsAt: "2026-08-10T12:00:00.000Z",
      defaultPaymentMethodId: "payment-method-1",
      subscriptionId: "subscription-existing",
      subscriptionStatus: "active",
    });
    const service = new BillingService(repository, gateway, {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
    });

    await expect(service.activateSubscription({
      priceId: "price-1",
      workspaceId: "workspace-1",
    })).resolves.toEqual({
      active: true,
      alreadyActive: true,
      periodEndsAt: "2026-09-10T12:00:00.000Z",
      periodStartsAt: "2026-08-10T12:00:00.000Z",
      subscriptionId: "subscription-existing",
    });
    expect(gateway.createSubscription).not.toHaveBeenCalled();
  });

  it("fails closed when an existing subscription is attached to another price", async () => {
    const { gateway, repository } = fixtures({
      customerId: "customer-1",
      currentPeriodEndsAt: "2026-09-10T12:00:00.000Z",
      currentPeriodStartsAt: "2026-08-10T12:00:00.000Z",
      defaultPaymentMethodId: "payment-method-1",
      subscriptionId: "subscription-existing",
      subscriptionPriceId: "price-other",
      subscriptionStatus: "active",
    });
    const service = new BillingService(repository, gateway, {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
    });

    await expect(service.ensureActiveSubscription({
      priceId: "price-1",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "BILLING_ACTIVATION_FAILED" });
    expect(gateway.getRecurringPrice).not.toHaveBeenCalled();
    expect(gateway.createSubscription).not.toHaveBeenCalled();
  });

  it("reuses a paid subscription whose cancellation is already scheduled", async () => {
    const { gateway, repository } = fixtures({
      customerId: "customer-1",
      currentPeriodEndsAt: "2026-09-10T12:00:00.000Z",
      currentPeriodStartsAt: "2026-08-10T12:00:00.000Z",
      defaultPaymentMethodId: "payment-method-1",
      subscriptionId: "subscription-existing",
      subscriptionStatus: "cancellation_scheduled",
    });
    const service = new BillingService(repository, gateway, {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
    });

    await expect(service.ensureActiveSubscription({
      priceId: "price-1",
      workspaceId: "workspace-1",
    })).resolves.toMatchObject({
      active: true,
      alreadyActive: true,
      subscriptionId: "subscription-existing",
    });
    expect(gateway.createSubscription).not.toHaveBeenCalled();
  });

  it("fails closed when a persisted paid period has already ended", async () => {
    const { gateway, repository } = fixtures({
      customerId: "customer-1",
      currentPeriodEndsAt: "2026-09-10T12:00:00.000Z",
      currentPeriodStartsAt: "2026-08-10T12:00:00.000Z",
      defaultPaymentMethodId: "payment-method-1",
      subscriptionId: "subscription-existing",
      subscriptionStatus: "active",
    });
    const service = new BillingService(repository, gateway, {
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });

    await expect(service.ensureActiveSubscription({
      priceId: "price-1",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "BILLING_ACTIVATION_FAILED" });
    expect(gateway.createSubscription).not.toHaveBeenCalled();
  });

  it("fails closed when a persisted paid period has not started yet", async () => {
    const { gateway, repository } = fixtures({
      customerId: "customer-1",
      currentPeriodEndsAt: "2026-10-10T12:00:00.000Z",
      currentPeriodStartsAt: "2026-09-10T12:00:00.000Z",
      defaultPaymentMethodId: "payment-method-1",
      subscriptionId: "subscription-existing",
      subscriptionStatus: "active",
    });
    const service = new BillingService(repository, gateway, {
      now: () => new Date("2026-08-20T12:00:00.000Z"),
    });

    await expect(service.ensureActiveSubscription({
      priceId: "price-1",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "BILLING_ACTIVATION_FAILED" });
    expect(gateway.createSubscription).not.toHaveBeenCalled();
  });

  it("fails closed when an existing active subscription has no persisted period", async () => {
    const { gateway, repository } = fixtures({
      customerId: "customer-1",
      defaultPaymentMethodId: "payment-method-1",
      subscriptionId: "subscription-existing",
      subscriptionStatus: "active",
    });
    const service = new BillingService(repository, gateway);

    await expect(service.ensureActiveSubscription({
      priceId: "price-1",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "BILLING_ACTIVATION_FAILED" });
    expect(gateway.createSubscription).not.toHaveBeenCalled();
  });

  it.each(["grace_period", "canceled", "past_due", "incomplete"])(
    "never replaces an existing %s subscription during number activation",
    async (subscriptionStatus) => {
      const { gateway, repository } = fixtures({
        customerId: "customer-1",
        currentPeriodEndsAt: "2026-09-10T12:00:00.000Z",
        currentPeriodStartsAt: "2026-08-10T12:00:00.000Z",
        defaultPaymentMethodId: "payment-method-1",
        subscriptionId: "subscription-existing",
        subscriptionStatus,
      });
      const service = new BillingService(repository, gateway);

      await expect(
        service.ensureActiveSubscription({
          priceId: "price-1",
          workspaceId: "workspace-1",
        }),
      ).rejects.toMatchObject({ code: "BILLING_ACTIVATION_FAILED" });
      expect(gateway.createSubscription).not.toHaveBeenCalled();
      expect(repository.recordSubscription).not.toHaveBeenCalled();
    },
  );
});
