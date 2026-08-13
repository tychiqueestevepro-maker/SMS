// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BillingProviderError } from "@/lib/billing/gateway";

import { microUsdToInvoiceCents, StripeBillingGateway } from "./gateway";
import type { StripeClientPort } from "./types";

function client(): StripeClientPort {
  return {
    customers: { create: vi.fn(async () => ({ id: "cus_1" })) },
    setupIntents: {
      create: vi.fn(async () => ({ client_secret: "seti_secret", id: "seti_1" })),
      retrieve: vi.fn(async (id: string) => ({
        id,
        status: "succeeded",
        customer: "cus_1",
        payment_method: "pm_1",
        metadata: { workspace_id: "ws_1" },
      })),
    },
    billingPortal: { sessions: { create: vi.fn(async () => ({ url: "https://billing.example/session" })) } },
    subscriptions: {
      create: vi.fn(async () => ({
        id: "sub_1",
        items: {
          data: [{
            current_period_start: 1_786_363_200,
            current_period_end: 1_789_041_600,
            price: "price_1",
          }],
        },
        latest_invoice: { id: "in_1" },
        metadata: { workspace_id: "ws_1" },
        status: "active",
      })),
      list: vi.fn(async () => ({ data: [], has_more: false })),
      update: vi.fn(async () => ({ cancel_at_period_end: true })),
    },
    prices: {
      retrieve: vi.fn(async (id) => ({
        active: true,
        currency: "USD",
        id,
        recurring: {
          interval: "month",
          interval_count: 1,
          usage_type: "licensed",
        },
        unit_amount: 8_999,
      })),
    },
    invoiceItems: {
      create: vi.fn(async () => ({ id: "ii_1" })),
      list: vi.fn(async () => ({ data: [], has_more: false })),
    },
    webhooks: {
      constructEvent: vi.fn(() => ({
        created: 1_786_363_200,
        data: {
          object: {
            billing_reason: "subscription_cycle",
            customer: "cus_1",
            id: "in_1",
            parent: { subscription_details: { subscription: "sub_1" } },
            period_end: 1_786_363_200,
            period_start: 1_783_684_800,
            status: "draft",
          },
        },
        id: "evt_1",
        type: "invoice.created",
      })),
    },
  };
}

describe("StripeBillingGateway", () => {
  let fake: StripeClientPort;
  let gateway: StripeBillingGateway;

  beforeEach(() => {
    fake = client();
    gateway = new StripeBillingGateway(fake);
  });

  it("creates an off-session card SetupIntent with safe output", async () => {
    await expect(gateway.createSetupIntent({ customerId: "cus_1", idempotencyKey: "setup:1", workspaceId: "ws_1" })).resolves.toEqual({
      clientSecret: "seti_secret",
      setupIntentId: "seti_1",
    });
    expect(fake.setupIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", payment_method_types: ["card"], usage: "off_session" }),
      { idempotencyKey: "setup:1" },
    );
  });

  it("maps the configured recurring price to billing-domain fields", async () => {
    await expect(gateway.getRecurringPrice({ priceId: "price_1" })).resolves.toEqual({
      active: true,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
      unitAmountCents: 8_999,
      usageType: "licensed",
    });
    expect(fake.prices.retrieve).toHaveBeenCalledWith("price_1");
  });

  it("activates only when the first invoice can be paid and returns the item period", async () => {
    await expect(gateway.createSubscription({
      customerId: "cus_1",
      defaultPaymentMethodId: "pm_1",
      idempotencyKey: "subscription:ws_1",
      priceId: "price_1",
      workspaceId: "ws_1",
    })).resolves.toEqual({
      latestInvoiceId: "in_1",
      periodEndsAt: "2026-09-10T12:00:00.000Z",
      periodStartsAt: "2026-08-10T12:00:00.000Z",
      status: "active",
      subscriptionId: "sub_1",
    });
    expect(fake.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        off_session: true,
        payment_behavior: "error_if_incomplete",
      }),
      { idempotencyKey: "subscription:ws_1" },
    );
  });

  it("reuses the subscription correlated by durable workspace metadata", async () => {
    fake.subscriptions.list = vi.fn(async () => ({
      data: [{
        id: "sub_existing",
        items: {
          data: [{
            current_period_start: 1_786_363_200,
            current_period_end: 1_789_041_600,
            price: { id: "price_1" },
          }],
        },
        latest_invoice: "in_existing",
        metadata: { workspace_id: "ws_1" },
        status: "active",
      }],
      has_more: false,
    }));

    await expect(gateway.createSubscription({
      customerId: "cus_1",
      defaultPaymentMethodId: "pm_1",
      idempotencyKey: "subscription:ws_1",
      priceId: "price_1",
      workspaceId: "ws_1",
    })).resolves.toEqual({
      latestInvoiceId: "in_existing",
      periodEndsAt: "2026-09-10T12:00:00.000Z",
      periodStartsAt: "2026-08-10T12:00:00.000Z",
      status: "active",
      subscriptionId: "sub_existing",
    });
    expect(fake.subscriptions.list).toHaveBeenCalledWith({
      customer: "cus_1",
      limit: 100,
      status: "all",
    });
    expect(fake.subscriptions.create).not.toHaveBeenCalled();
  });

  it("fails closed when subscription pagination prevents complete reconciliation", async () => {
    fake.subscriptions.list = vi.fn(async () => ({ data: [], has_more: true }));

    await expect(gateway.createSubscription({
      customerId: "cus_1",
      defaultPaymentMethodId: "pm_1",
      idempotencyKey: "subscription:ws_1",
      priceId: "price_1",
      workspaceId: "ws_1",
    })).rejects.toMatchObject({
      operation: "create_subscription",
      providerMessage: "Subscription reconciliation requires operator review.",
    });
    expect(fake.subscriptions.create).not.toHaveBeenCalled();
  });

  it("creates exactly one aggregated invoice item with deterministic idempotency", async () => {
    await expect(gateway.addAdditionalUsageInvoiceLine({
      amountMicroUsd: 9_000_000,
      billingInvoiceRunId: "run_1",
      customerId: "cus_1",
      idempotencyKey: "additional-sms-usage:ws_1:in_1",
      invoiceId: "in_1",
      sourcePeriodCount: 1,
      workspaceId: "ws_1",
    })).resolves.toEqual({ amountCents: 900, invoiceItemId: "ii_1" });
    expect(fake.invoiceItems.create).toHaveBeenCalledTimes(1);
    expect(fake.invoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 900, description: "Additional SMS usage", invoice: "in_1" }),
      { idempotencyKey: "additional-sms-usage:ws_1:in_1" },
    );
  });

  it("reuses the invoice item correlated by durable run metadata", async () => {
    fake.invoiceItems.list = vi.fn(async () => ({
      data: [{
        amount: 900,
        currency: "usd",
        description: "Additional SMS usage",
        id: "ii_existing",
        metadata: {
          billing_invoice_run_id: "run_1",
          workspace_id: "ws_1",
        },
      }],
      has_more: false,
    }));

    await expect(gateway.addAdditionalUsageInvoiceLine({
      amountMicroUsd: 9_000_000,
      billingInvoiceRunId: "run_1",
      customerId: "cus_1",
      idempotencyKey: "additional-sms-usage:ws_1:in_1",
      invoiceId: "in_1",
      sourcePeriodCount: 1,
      workspaceId: "ws_1",
    })).resolves.toEqual({ amountCents: 900, invoiceItemId: "ii_existing" });
    expect(fake.invoiceItems.list).toHaveBeenCalledWith({
      customer: "cus_1",
      invoice: "in_1",
      limit: 100,
    });
    expect(fake.invoiceItems.create).not.toHaveBeenCalled();
  });

  it.each([
    ["amount", 899, "run_1"],
    ["billing run", 900, "run_other"],
  ])("fails closed when an existing invoice item's %s does not match", async (_field, amount, runId) => {
    fake.invoiceItems.list = vi.fn(async () => ({
      data: [{
        amount,
        currency: "usd",
        description: "Additional SMS usage",
        id: "ii_mismatch",
        metadata: {
          billing_invoice_run_id: runId,
          workspace_id: "ws_1",
        },
      }],
      has_more: false,
    }));

    await expect(gateway.addAdditionalUsageInvoiceLine({
      amountMicroUsd: 9_000_000,
      billingInvoiceRunId: "run_1",
      customerId: "cus_1",
      idempotencyKey: "additional-sms-usage:ws_1:in_1",
      invoiceId: "in_1",
      sourcePeriodCount: 1,
      workspaceId: "ws_1",
    })).rejects.toMatchObject({
      operation: "add_invoice_line",
      providerMessage: "Invoice usage line correlation failed.",
    });
    expect(fake.invoiceItems.create).not.toHaveBeenCalled();
  });

  it("fails closed when invoice-item pagination prevents complete reconciliation", async () => {
    fake.invoiceItems.list = vi.fn(async () => ({ data: [], has_more: true }));

    await expect(gateway.addAdditionalUsageInvoiceLine({
      amountMicroUsd: 9_000_000,
      billingInvoiceRunId: "run_1",
      customerId: "cus_1",
      idempotencyKey: "additional-sms-usage:ws_1:in_1",
      invoiceId: "in_1",
      sourcePeriodCount: 1,
      workspaceId: "ws_1",
    })).rejects.toMatchObject({
      operation: "add_invoice_line",
      providerMessage: "Invoice reconciliation requires operator review.",
    });
    expect(fake.invoiceItems.create).not.toHaveBeenCalled();
  });

  it("rounds only the aggregated micro-USD amount to invoice cents", () => {
    expect(microUsdToInvoiceCents(20_000)).toBe(2);
    expect(microUsdToInvoiceCents(25_000)).toBe(3);
  });

  it("verifies raw webhook input and returns an internal normalized event", async () => {
    const payload = Buffer.from("raw-body");
    await expect(gateway.verifyWebhook({ payload, signature: "signature", webhookSecret: "secret" })).resolves.toMatchObject({
      eventId: "evt_1",
      eventType: "invoice.created",
      billingReason: "subscription_cycle",
      kind: "invoice_created",
      customerId: "cus_1",
      invoiceId: "in_1",
      periodEndsAt: "2026-08-10T12:00:00.000Z",
      periodStartsAt: "2026-07-10T12:00:00.000Z",
      subscriptionId: "sub_1",
    });
    expect(fake.webhooks.constructEvent).toHaveBeenCalledWith(payload, "signature", "secret");
  });

  it("normalizes payment setup and terminal subscription events inside the adapter", async () => {
    fake.webhooks.constructEvent = vi
      .fn()
      .mockReturnValueOnce({
        created: 1_786_363_200,
        data: {
          object: {
            customer: "cus_1",
            id: "seti_1",
            metadata: { workspace_id: "ws_1" },
            payment_method: "pm_1",
          },
        },
        id: "evt_setup",
        type: "setup_intent.succeeded",
      })
      .mockReturnValueOnce({
        created: 1_786_363_200,
        data: {
          object: {
            canceled_at: 1_783_670_400,
            customer: "cus_1",
            ended_at: 1_786_363_100,
            id: "sub_1",
            metadata: { workspace_id: "ws_1" },
          },
        },
        id: "evt_end",
        type: "customer.subscription.deleted",
      });

    await expect(gateway.verifyWebhook({
      payload: Buffer.from("setup"),
      signature: "signature",
      webhookSecret: "secret",
    })).resolves.toMatchObject({
      customerId: "cus_1",
      kind: "payment_method_saved",
      paymentMethodId: "pm_1",
      workspaceId: "ws_1",
    });
    await expect(gateway.verifyWebhook({
      payload: Buffer.from("ended"),
      signature: "signature",
      webhookSecret: "secret",
    })).resolves.toMatchObject({
      endedAt: "2026-08-10T11:58:20.000Z",
      kind: "subscription_ended",
      subscriptionId: "sub_1",
    });
  });

  it("uses the event time when a terminal subscription has no end timestamp", async () => {
    fake.webhooks.constructEvent = vi.fn(() => ({
      created: 1_786_363_200,
      data: {
        object: {
          canceled_at: 1_783_670_400,
          customer: "cus_1",
          ended_at: null,
          id: "sub_1",
          metadata: { workspace_id: "ws_1" },
        },
      },
      id: "evt_end_fallback",
      type: "customer.subscription.deleted",
    }));

    await expect(gateway.verifyWebhook({
      payload: Buffer.from("ended"),
      signature: "signature",
      webhookSecret: "secret",
    })).resolves.toMatchObject({
      endedAt: "2026-08-10T12:00:00.000Z",
      kind: "subscription_ended",
    });
  });

  it("normalizes unhandled signed events without interpreting their payload", async () => {
    fake.webhooks.constructEvent = vi.fn(() => ({
      created: 1_786_363_200,
      data: { object: { deliberately: "untrusted" } },
      id: "evt_other",
      type: "customer.updated",
    }));

    await expect(gateway.verifyWebhook({
      payload: Buffer.from("other"),
      signature: "signature",
      webhookSecret: "secret",
    })).resolves.toEqual({
      eventId: "evt_other",
      eventType: "customer.updated",
      kind: "unsupported",
      occurredAt: "2026-08-10T12:00:00.000Z",
    });
  });

  it("normalizes subscription item periods and cancellation intent", async () => {
    fake.webhooks.constructEvent = vi.fn(() => ({
      created: 1_786_363_200,
      data: {
        object: {
          cancel_at_period_end: true,
          customer: "cus_1",
          id: "sub_1",
          items: {
            data: [{
              current_period_end: 1_789_041_600,
              current_period_start: 1_786_363_200,
            }],
          },
          metadata: { workspace_id: "ws_1" },
          status: "active",
        },
      },
      id: "evt_sub",
      type: "customer.subscription.updated",
    }));

    await expect(gateway.verifyWebhook({
      payload: Buffer.from("subscription"),
      signature: "signature",
      webhookSecret: "secret",
    })).resolves.toMatchObject({
      cancelAtPeriodEnd: true,
      kind: "subscription_changed",
      periodEndsAt: "2026-09-10T12:00:00.000Z",
      periodStartsAt: "2026-08-10T12:00:00.000Z",
      status: "active",
    });
  });

  it("fails closed instead of treating an unsupported trial as active", async () => {
    fake.webhooks.constructEvent = vi.fn(() => ({
      created: 1_786_363_200,
      data: {
        object: {
          cancel_at_period_end: false,
          customer: "cus_1",
          id: "sub_1",
          items: {
            data: [{
              current_period_end: 1_789_041_600,
              current_period_start: 1_786_363_200,
            }],
          },
          metadata: { workspace_id: "ws_1" },
          status: "trialing",
        },
      },
      id: "evt_trial",
      type: "customer.subscription.updated",
    }));

    await expect(gateway.verifyWebhook({
      payload: Buffer.from("subscription"),
      signature: "signature",
      webhookSecret: "secret",
    })).resolves.toMatchObject({
      kind: "subscription_changed",
      status: "incomplete",
    });
  });

  it("retains raw provider errors internally", async () => {
    fake.customers.create = vi.fn(async () => {
      throw { code: "raw_code", message: "raw provider detail" };
    });
    const error = await gateway
      .createCustomer({ email: "owner@example.com", idempotencyKey: "customer:ws_1", name: null, workspaceId: "ws_1" })
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(BillingProviderError);
    expect(error).toMatchObject({
      operation: "create_customer",
      providerCode: "raw_code",
      providerMessage: "raw provider detail",
    });
  });
});
