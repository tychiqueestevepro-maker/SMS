// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BillingProviderError,
  type BillingGateway,
  type BillingWebhookEvent,
} from "./gateway";
import type { BillingRuntimeRepository } from "./runtime-repository";
import {
  BillingWebhookService,
  BillingWebhookServiceError,
} from "./webhook-service";

const NOW = "2026-08-10T12:00:00.000Z";

function invoiceEvent(): Extract<BillingWebhookEvent, { kind: "invoice_created" }> {
  return {
    billingReason: "subscription_cycle",
    customerId: "cus_1",
    eventId: "evt_invoice",
    eventType: "invoice.created",
    invoiceId: "in_1",
    invoiceStatus: "draft",
    kind: "invoice_created",
    occurredAt: NOW,
    periodEndsAt: "2026-08-10T12:00:00.000Z",
    periodStartsAt: "2026-07-10T12:00:00.000Z",
    subscriptionId: "sub_1",
  };
}

function fixtures(event: BillingWebhookEvent = invoiceEvent()) {
  const gateway: BillingGateway = {
    addAdditionalUsageInvoiceLine: vi.fn(async () => ({
      amountCents: 900,
      invoiceItemId: "ii_1",
    })),
    createCustomer: vi.fn(),
    createPortalSession: vi.fn(),
    createSetupIntent: vi.fn(),
    createSubscription: vi.fn(),
    getRecurringPrice: vi.fn(async () => ({
      active: true,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
      unitAmountCents: 8_999,
      usageType: "licensed",
    })),
    scheduleSubscriptionCancellation: vi.fn(),
    verifyWebhook: vi.fn(async () => event),
  };
  const repository: BillingRuntimeRepository = {
    applyLifecycleEvent: vi.fn(async () => ({ workspaceId: "ws_1" })),
    applyPaymentMethodSaved: vi.fn(async () => ({ workspaceId: "ws_1" })),
    claimWebhookEvent: vi.fn(async () => ({
      claimToken: "claim_1",
      state: "claimed" as const,
    })),
    completeAdditionalUsageInvoiceRun: vi.fn(async () => undefined),
    completeSubscriptionCancellation: vi.fn(async () => undefined),
    completeWebhookEvent: vi.fn(async () => undefined),
    expireGracePeriods: vi.fn(async () => ({ expiredCount: 0 })),
    failWebhookEvent: vi.fn(async () => undefined),
    prepareAdditionalUsageInvoiceRun: vi.fn(async () => ({
      amountMicroUsd: 9_000_000,
      billingInvoiceRunId: "run_1",
      customerId: "cus_1",
      invoiceId: "in_1",
      ledgerEntryCount: 451,
      sourcePeriodIds: ["period_july", "period_august"],
      state: "ready" as const,
      workspaceId: "ws_1",
    })),
    prepareSubscriptionCancellation: vi.fn(async () => ({
      state: "completed" as const,
    })),
  };
  const report = vi.fn();
  const service = new BillingWebhookService(repository, gateway, {
    now: () => new Date(NOW),
    reportInternalEvent: report,
  });
  return { gateway, report, repository, service };
}

function rawInput() {
  return {
    payload: Buffer.from("exact-raw-body"),
    receivedAt: NOW,
    signature: "signature",
    webhookSecret: "webhook-secret",
  };
}

describe("BillingWebhookService", () => {
  it("adds one aggregate usage line and durably links its original-period ledger entries", async () => {
    const { gateway, repository, service } = fixtures();

    await expect(service.handleRaw(rawInput())).resolves.toEqual({
      eventId: "evt_invoice",
      replayed: false,
    });
    expect(gateway.addAdditionalUsageInvoiceLine).toHaveBeenCalledTimes(1);
    expect(gateway.addAdditionalUsageInvoiceLine).toHaveBeenCalledWith({
      amountMicroUsd: 9_000_000,
      billingInvoiceRunId: "run_1",
      customerId: "cus_1",
      idempotencyKey: "additional-sms-usage:ws_1:in_1",
      invoiceId: "in_1",
      sourcePeriodCount: 2,
      workspaceId: "ws_1",
    });
    expect(repository.completeAdditionalUsageInvoiceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 900,
        billingInvoiceRunId: "run_1",
        invoiceId: "in_1",
        invoiceItemId: "ii_1",
      }),
    );
    expect(repository.completeWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "processed" }),
    );
  });

  it("does not create another line when the webhook event is replayed", async () => {
    const { gateway, repository, service } = fixtures();
    vi.mocked(repository.claimWebhookEvent).mockResolvedValue({ state: "completed" });

    await expect(service.handleRaw(rawInput())).resolves.toEqual({
      eventId: "evt_invoice",
      replayed: true,
    });
    expect(repository.prepareAdditionalUsageInvoiceRun).not.toHaveBeenCalled();
    expect(gateway.addAdditionalUsageInvoiceLine).not.toHaveBeenCalled();
    expect(repository.completeWebhookEvent).not.toHaveBeenCalled();
  });

  it("does not call the provider for a replayed or empty invoice run", async () => {
    const { gateway, repository, service } = fixtures();
    vi.mocked(repository.prepareAdditionalUsageInvoiceRun).mockResolvedValue({
      state: "no_usage",
    });

    await service.handleRaw(rawInput());
    expect(gateway.addAdditionalUsageInvoiceLine).not.toHaveBeenCalled();
    expect(repository.completeWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("never attaches usage to a manual or mid-cycle invoice", async () => {
    const event = invoiceEvent();
    event.billingReason = "manual";
    event.subscriptionId = null;
    const { gateway, repository, service } = fixtures(event);

    await service.handleRaw(rawInput());
    expect(repository.prepareAdditionalUsageInvoiceRun).not.toHaveBeenCalled();
    expect(gateway.addAdditionalUsageInvoiceLine).not.toHaveBeenCalled();
    expect(repository.completeWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("persists original provider diagnostics internally but returns only a stable error", async () => {
    const { gateway, repository, service } = fixtures();
    vi.mocked(gateway.addAdditionalUsageInvoiceLine).mockRejectedValue(
      new BillingProviderError({
        operation: "add_invoice_line",
        providerCode: "invoice_not_editable",
        providerMessage: "raw provider invoice detail",
      }),
    );

    const error = await service.handleRaw(rawInput()).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(BillingWebhookServiceError);
    expect((error as Error).message).not.toContain("raw provider invoice detail");
    expect(repository.failWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "provider_add_invoice_line",
        providerCode: "invoice_not_editable",
        providerMessage: "raw provider invoice detail",
      }),
    );
    expect(repository.completeWebhookEvent).not.toHaveBeenCalled();
  });

  it("starts an exact seven-day grace period when a subscription ends", async () => {
    const event: BillingWebhookEvent = {
      endedAt: "2026-08-10T10:00:00.000Z",
      customerId: "cus_1",
      eventId: "evt_deleted",
      eventType: "customer.subscription.deleted",
      kind: "subscription_ended",
      occurredAt: NOW,
      subscriptionId: "sub_1",
      workspaceId: "ws_1",
    };
    const { repository, service } = fixtures(event);

    await service.handleRaw(rawInput());
    expect(repository.applyLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        allowTerminalReactivation: false,
        graceEndsAt: "2026-08-17T10:00:00.000Z",
        status: "grace",
      }),
    );
  });

  it("allows payment recovery without allowing a canceled workspace to auto-restart", async () => {
    const event: BillingWebhookEvent = {
      billingReason: "subscription_cycle",
      customerId: "cus_1",
      eventId: "evt_paid",
      eventType: "invoice.paid",
      invoiceId: "in_1",
      invoiceStatus: "paid",
      kind: "invoice_paid",
      occurredAt: NOW,
      periodEndsAt: "2026-08-10T12:00:00.000Z",
      periodStartsAt: "2026-07-10T12:00:00.000Z",
      subscriptionId: "sub_1",
    };
    const { repository, service } = fixtures(event);

    await service.handleRaw(rawInput());
    expect(repository.applyLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        allowTerminalReactivation: false,
        eventKind: "invoice_paid",
        periodEndsAt: "2026-08-10T12:00:00.000Z",
        periodStartsAt: "2026-07-10T12:00:00.000Z",
        status: "active",
      }),
    );
  });

  it("persists the normalized invoice period when payment fails", async () => {
    const event: BillingWebhookEvent = {
      billingReason: "subscription_cycle",
      customerId: "cus_1",
      eventId: "evt_payment_failed",
      eventType: "invoice.payment_failed",
      invoiceId: "in_failed",
      invoiceStatus: "open",
      kind: "invoice_payment_failed",
      occurredAt: NOW,
      periodEndsAt: "2026-09-10T12:00:00.000Z",
      periodStartsAt: "2026-08-10T12:00:00.000Z",
      subscriptionId: "sub_1",
    };
    const { repository, service } = fixtures(event);

    await service.handleRaw(rawInput());
    expect(repository.applyLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "invoice_payment_failed",
        invoiceId: "in_failed",
        periodEndsAt: "2026-09-10T12:00:00.000Z",
        periodStartsAt: "2026-08-10T12:00:00.000Z",
        status: "past_due",
      }),
    );
  });

  it("does not change workspace access for a standalone invoice payment", async () => {
    const event: BillingWebhookEvent = {
      billingReason: "manual",
      customerId: "cus_1",
      eventId: "evt_manual_paid",
      eventType: "invoice.paid",
      invoiceId: "in_manual",
      invoiceStatus: "paid",
      kind: "invoice_paid",
      occurredAt: NOW,
      periodEndsAt: null,
      periodStartsAt: null,
      subscriptionId: null,
    };
    const { repository, service } = fixtures(event);

    await service.handleRaw(rawInput());
    expect(repository.applyLifecycleEvent).not.toHaveBeenCalled();
    expect(repository.completeWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "ignored" }),
    );
  });

  it("rejects an invalid signature before any persistence mutation", async () => {
    const { gateway, repository, service } = fixtures();
    vi.mocked(gateway.verifyWebhook).mockRejectedValue(
      new BillingProviderError({
        operation: "verify_webhook",
        providerCode: "signature_invalid",
        providerMessage: "raw signature detail",
      }),
    );

    await expect(service.handleRaw(rawInput())).rejects.toMatchObject({
      code: "INVALID_SIGNATURE",
      message: "The billing notification could not be processed.",
    });
    expect(repository.claimWebhookEvent).not.toHaveBeenCalled();
  });

  it("returns retryable busy semantics rather than acknowledging an unowned event", async () => {
    const { repository, service } = fixtures();
    vi.mocked(repository.claimWebhookEvent).mockResolvedValue({ state: "busy" });

    await expect(service.handleRaw(rawInput())).rejects.toMatchObject({
      code: "EVENT_BUSY",
    });
    expect(repository.completeWebhookEvent).not.toHaveBeenCalled();
  });
});
