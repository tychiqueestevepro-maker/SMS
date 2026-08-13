import "server-only";

import {
  BillingProviderError,
  type BillingGateway,
  type BillingProviderOperation,
  type BillingSubscriptionStatus,
  type BillingWebhookEvent,
} from "@/lib/billing/gateway";
import { assertNonNegativeSafeInteger } from "@/lib/billing/integer";

import type { StripeClientPort, StripeErrorShape } from "./types";
import type { StripeSubscriptionRecord } from "./types";

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new RangeError(`${label} is required.`);
  return normalized;
}

function providerError(error: unknown, operation: BillingProviderOperation): BillingProviderError {
  const shape = error && typeof error === "object" ? (error as StripeErrorShape) : {};
  const providerCode = typeof shape.code === "string"
    ? shape.code
    : typeof shape.raw?.code === "string"
      ? shape.raw.code
      : null;
  const providerMessage = typeof shape.message === "string"
    ? shape.message
    : typeof shape.raw?.message === "string"
      ? shape.raw.message
      : "Unknown billing provider failure";
  return new BillingProviderError({ operation, providerCode, providerMessage });
}

function subscriptionStatus(status: string): BillingSubscriptionStatus {
  if (status === "active") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled" || status === "incomplete_expired") return "canceled";
  return "incomplete";
}

function subscriptionResult(
  subscription: StripeSubscriptionRecord,
  expectedPriceId: string,
) {
  const latestInvoice = subscription.latest_invoice;
  const period = subscription.items.data[0];
  const actualPriceId =
    typeof period?.price === "string" ? period.price : period?.price.id;
  if (
    !period ||
    actualPriceId !== expectedPriceId ||
    !Number.isSafeInteger(period.current_period_start) ||
    !Number.isSafeInteger(period.current_period_end) ||
    period.current_period_end <= period.current_period_start
  ) {
    throw new Error("Subscription billing correlation is unavailable.");
  }
  return {
    latestInvoiceId:
      typeof latestInvoice === "string" ? latestInvoice : latestInvoice?.id ?? null,
    periodEndsAt: new Date(period.current_period_end * 1_000).toISOString(),
    periodStartsAt: new Date(period.current_period_start * 1_000).toISOString(),
    status: subscriptionStatus(subscription.status),
    subscriptionId: subscription.id,
  };
}

type UnknownObject = Record<string, unknown>;

function object(value: unknown, label: string): UnknownObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is unavailable.`);
  }
  return value as UnknownObject;
}

function optionalObject(value: unknown): UnknownObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownObject)
    : null;
}

function identifier(value: unknown, label: string): string {
  const candidate =
    typeof value === "string"
      ? value
      : optionalObject(value) && typeof optionalObject(value)?.id === "string"
        ? (optionalObject(value)?.id as string)
        : "";
  return required(candidate, label);
}

function optionalIdentifier(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return identifier(value, "Identifier");
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function timestampFromSeconds(value: unknown, label: string): string {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} is unavailable.`);
  }
  return new Date((value as number) * 1_000).toISOString();
}

function optionalTimestampFromSeconds(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : timestampFromSeconds(value, "Timestamp");
}

function workspaceMetadata(row: UnknownObject): string | null {
  return optionalString(optionalObject(row.metadata)?.workspace_id);
}

function invoiceSubscriptionId(row: UnknownObject): string | null {
  const direct = optionalIdentifier(row.subscription);
  if (direct) return direct;
  const parent = optionalObject(row.parent);
  const details = optionalObject(parent?.subscription_details);
  return optionalIdentifier(details?.subscription);
}

function subscriptionPeriod(row: UnknownObject): {
  periodEndsAt: string | null;
  periodStartsAt: string | null;
} {
  const items = optionalObject(row.items);
  const first = Array.isArray(items?.data)
    ? optionalObject(items.data[0])
    : null;
  if (!first) return { periodEndsAt: null, periodStartsAt: null };
  return {
    periodEndsAt: optionalTimestampFromSeconds(first.current_period_end),
    periodStartsAt: optionalTimestampFromSeconds(first.current_period_start),
  };
}

export function normalizeVerifiedBillingWebhookEvent(input: {
  created: number;
  data: unknown;
  eventId: string;
  type: string;
}): BillingWebhookEvent {
  const base = {
    eventId: required(input.eventId, "Event ID"),
    eventType: required(input.type, "Event type"),
    occurredAt: timestampFromSeconds(input.created, "Event timestamp"),
  };
  if (
    input.type !== "setup_intent.succeeded" &&
    input.type !== "invoice.created" &&
    input.type !== "invoice.paid" &&
    input.type !== "invoice.payment_failed" &&
    input.type !== "customer.subscription.created" &&
    input.type !== "customer.subscription.updated" &&
    input.type !== "customer.subscription.deleted"
  ) {
    return { ...base, kind: "unsupported" };
  }

  const row = object(input.data, "Webhook object");
  if (input.type === "setup_intent.succeeded") {
    return {
      ...base,
      kind: "payment_method_saved",
      customerId: identifier(row.customer, "Customer ID"),
      paymentMethodId: identifier(row.payment_method, "Payment method ID"),
      setupIntentId: identifier(row.id, "Setup intent ID"),
      workspaceId: workspaceMetadata(row),
    };
  }
  if (
    input.type === "invoice.created" ||
    input.type === "invoice.paid" ||
    input.type === "invoice.payment_failed"
  ) {
    const kind =
      input.type === "invoice.created"
        ? "invoice_created"
        : input.type === "invoice.paid"
          ? "invoice_paid"
          : "invoice_payment_failed";
    return {
      ...base,
      billingReason: optionalString(row.billing_reason),
      kind,
      customerId: identifier(row.customer, "Customer ID"),
      invoiceId: identifier(row.id, "Invoice ID"),
      invoiceStatus: optionalString(row.status),
      periodEndsAt: optionalTimestampFromSeconds(row.period_end),
      periodStartsAt: optionalTimestampFromSeconds(row.period_start),
      subscriptionId: invoiceSubscriptionId(row),
    };
  }
  if (input.type === "customer.subscription.deleted") {
    return {
      ...base,
      kind: "subscription_ended",
      // `canceled_at` records when cancellation was requested. For a scheduled
      // cancellation that can be weeks before access actually ends.
      endedAt: optionalTimestampFromSeconds(row.ended_at) ?? base.occurredAt,
      customerId: identifier(row.customer, "Customer ID"),
      subscriptionId: identifier(row.id, "Subscription ID"),
      workspaceId: workspaceMetadata(row),
    };
  }
  const period = subscriptionPeriod(row);
  return {
    ...base,
    kind: "subscription_changed",
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    customerId: identifier(row.customer, "Customer ID"),
    ...period,
    status: subscriptionStatus(optionalString(row.status) ?? "incomplete"),
    subscriptionId: identifier(row.id, "Subscription ID"),
    workspaceId: workspaceMetadata(row),
  };
}

export function microUsdToInvoiceCents(amountMicroUsd: number): number {
  assertNonNegativeSafeInteger(amountMicroUsd, "Invoice amount");
  return Math.floor((amountMicroUsd + 5_000) / 10_000);
}

export class StripeBillingGateway implements BillingGateway {
  constructor(private readonly client: StripeClientPort) {}

  async getRecurringPrice(input: Parameters<BillingGateway["getRecurringPrice"]>[0]) {
    try {
      const price = await this.client.prices.retrieve(
        required(input.priceId, "Price ID"),
      );
      return {
        active: price.active,
        currency: price.currency.toLowerCase(),
        interval: price.recurring?.interval ?? null,
        intervalCount: price.recurring?.interval_count ?? null,
        unitAmountCents: price.unit_amount,
        usageType: price.recurring?.usage_type ?? null,
      };
    } catch (error) {
      if (error instanceof RangeError) throw error;
      throw providerError(error, "retrieve_price");
    }
  }

  async createCustomer(input: Parameters<BillingGateway["createCustomer"]>[0]) {
    try {
      const customer = await this.client.customers.create(
        {
          email: required(input.email, "Email"),
          ...(input.name?.trim() ? { name: input.name.trim() } : {}),
          metadata: { workspace_id: required(input.workspaceId, "Workspace ID") },
        },
        { idempotencyKey: required(input.idempotencyKey, "Idempotency key") },
      );
      return { customerId: customer.id };
    } catch (error) {
      if (error instanceof RangeError) throw error;
      throw providerError(error, "create_customer");
    }
  }

  async createSetupIntent(input: Parameters<BillingGateway["createSetupIntent"]>[0]) {
    try {
      const intent = await this.client.setupIntents.create(
        {
          customer: required(input.customerId, "Customer ID"),
          payment_method_types: ["card"],
          usage: "off_session",
          metadata: { workspace_id: required(input.workspaceId, "Workspace ID") },
        },
        { idempotencyKey: required(input.idempotencyKey, "Idempotency key") },
      );
      if (!intent.client_secret) throw new Error("Setup intent has no client secret.");
      return { clientSecret: intent.client_secret, setupIntentId: intent.id };
    } catch (error) {
      if (error instanceof RangeError) throw error;
      throw providerError(error, "create_setup_intent");
    }
  }

  async createPortalSession(input: Parameters<BillingGateway["createPortalSession"]>[0]) {
    try {
      const session = await this.client.billingPortal.sessions.create({
        customer: required(input.customerId, "Customer ID"),
        return_url: required(input.returnUrl, "Return URL"),
      });
      return { url: session.url };
    } catch (error) {
      if (error instanceof RangeError) throw error;
      throw providerError(error, "create_portal_session");
    }
  }

  async createSubscription(input: Parameters<BillingGateway["createSubscription"]>[0]) {
    try {
      const customerId = required(input.customerId, "Customer ID");
      const priceId = required(input.priceId, "Price ID");
      const workspaceId = required(input.workspaceId, "Workspace ID");
      const existingPage = await this.client.subscriptions.list({
        customer: customerId,
        limit: 100,
        status: "all",
      });
      if (existingPage.has_more) {
        throw new Error("Subscription reconciliation requires operator review.");
      }
      const existing = existingPage.data.filter(
        (subscription) => subscription.metadata?.workspace_id === workspaceId,
      );
      if (existing.length > 1) {
        throw new Error("Subscription reconciliation found multiple matches.");
      }
      if (existing[0]) return subscriptionResult(existing[0], priceId);

      let promotionCodeId: string | null = null;
      if (input.promotionCode) {
        const promotionCode = required(input.promotionCode, "Promotion code");
        const promotionPage = await this.client.promotionCodes.list({
          active: true,
          code: promotionCode,
          limit: 2,
        });
        const matches = promotionPage.data.filter((candidate) => {
          const restrictedCustomer = candidate.customer
            ? typeof candidate.customer === "string"
              ? candidate.customer
              : candidate.customer.id
            : null;
          return (
            candidate.active &&
            candidate.code.toLowerCase() === promotionCode.toLowerCase() &&
            (!restrictedCustomer || restrictedCustomer === customerId) &&
            (!candidate.expires_at || candidate.expires_at * 1_000 > Date.now()) &&
            (!candidate.max_redemptions ||
              candidate.times_redeemed < candidate.max_redemptions)
          );
        });
        if (promotionPage.has_more || matches.length !== 1) {
          throw new BillingProviderError({
            operation: "create_subscription",
            providerCode: "PROMOTION_CODE_INVALID",
            providerMessage: "Promotion code is invalid or unavailable.",
          });
        }
        promotionCodeId = matches[0]!.id;
      }

      const subscription = await this.client.subscriptions.create(
        {
          customer: customerId,
          default_payment_method: required(input.defaultPaymentMethodId, "Payment method ID"),
          items: [{ price: priceId }],
          ...(promotionCodeId
            ? { discounts: [{ promotion_code: promotionCodeId }] }
            : {}),
          off_session: true,
          // Number activation is fail-closed: no usable subscription is
          // persisted if the first invoice cannot be paid automatically.
          payment_behavior: "error_if_incomplete",
          payment_settings: { save_default_payment_method: "on_subscription" },
          metadata: { workspace_id: workspaceId },
        },
        { idempotencyKey: required(input.idempotencyKey, "Idempotency key") },
      );
      return subscriptionResult(subscription, priceId);
    } catch (error) {
      if (error instanceof RangeError) throw error;
      if (error instanceof BillingProviderError) throw error;
      const mapped = providerError(error, "create_subscription");
      if (
        input.promotionCode &&
        `${mapped.providerCode ?? ""} ${mapped.providerMessage}`
          .toLowerCase()
          .match(/promotion|coupon|discount/)
      ) {
        throw new BillingProviderError({
          operation: "create_subscription",
          providerCode: "PROMOTION_CODE_INVALID",
          providerMessage: mapped.providerMessage,
        });
      }
      throw mapped;
    }
  }

  async addAdditionalUsageInvoiceLine(
    input: Parameters<BillingGateway["addAdditionalUsageInvoiceLine"]>[0],
  ) {
    try {
      const amountCents = microUsdToInvoiceCents(input.amountMicroUsd);
      if (amountCents < 1) throw new RangeError("Invoice line amount must round to at least one cent.");
      const billingInvoiceRunId = required(
        input.billingInvoiceRunId,
        "Billing invoice run ID",
      );
      const customerId = required(input.customerId, "Customer ID");
      const invoiceId = required(input.invoiceId, "Invoice ID");
      const workspaceId = required(input.workspaceId, "Workspace ID");
      const existingPage = await this.client.invoiceItems.list({
        customer: customerId,
        invoice: invoiceId,
        limit: 100,
      });
      if (existingPage.has_more) {
        throw new Error("Invoice reconciliation requires operator review.");
      }
      const existing = existingPage.data.filter(
        (item) =>
          item.description === "Additional SMS usage" &&
          item.metadata?.workspace_id === workspaceId,
      );
      if (existing.length > 1) {
        throw new Error("Invoice reconciliation found multiple usage lines.");
      }
      if (existing[0]) {
        if (
          existing[0].metadata?.billing_invoice_run_id !== billingInvoiceRunId ||
          existing[0].amount !== amountCents ||
          existing[0].currency.toLowerCase() !== "usd"
        ) {
          throw new Error("Invoice usage line correlation failed.");
        }
        return { amountCents, invoiceItemId: existing[0].id };
      }
      const item = await this.client.invoiceItems.create(
        {
          amount: amountCents,
          currency: "usd",
          customer: customerId,
          description: "Additional SMS usage",
          invoice: invoiceId,
          metadata: {
            billing_invoice_run_id: billingInvoiceRunId,
            source_period_count: String(input.sourcePeriodCount),
            workspace_id: workspaceId,
          },
        },
        { idempotencyKey: required(input.idempotencyKey, "Idempotency key") },
      );
      return { amountCents, invoiceItemId: item.id };
    } catch (error) {
      if (error instanceof RangeError) throw error;
      throw providerError(error, "add_invoice_line");
    }
  }

  async scheduleSubscriptionCancellation(
    input: Parameters<BillingGateway["scheduleSubscriptionCancellation"]>[0],
  ) {
    try {
      const subscription = await this.client.subscriptions.update(
        required(input.subscriptionId, "Subscription ID"),
        { cancel_at_period_end: true },
        { idempotencyKey: required(input.idempotencyKey, "Idempotency key") },
      );
      return { cancelAtPeriodEnd: subscription.cancel_at_period_end };
    } catch (error) {
      if (error instanceof RangeError) throw error;
      throw providerError(error, "schedule_cancellation");
    }
  }

  async verifyWebhook(input: Parameters<BillingGateway["verifyWebhook"]>[0]) {
    try {
      const event = this.client.webhooks.constructEvent(
        input.payload,
        required(input.signature, "Webhook signature"),
        required(input.webhookSecret, "Webhook secret"),
      );
      return normalizeVerifiedBillingWebhookEvent({
        created: event.created,
        data: event.data.object,
        eventId: event.id,
        type: event.type,
      });
    } catch (error) {
      if (error instanceof RangeError) throw error;
      throw providerError(error, "verify_webhook");
    }
  }

  async retrieveConfirmedSetupIntent(setupIntentId: string) {
    try {
      const intent = await this.client.setupIntents.retrieve(
        required(setupIntentId, "Setup intent ID"),
      );
      if (intent.status !== "succeeded") {
        throw new RangeError("Setup intent has not succeeded yet.");
      }
      const pm = intent.payment_method;
      const paymentMethodId = typeof pm === "string" ? pm : (pm as { id?: string } | null)?.id ?? "";
      const customerId = typeof intent.customer === "string" ? intent.customer : (intent.customer as { id?: string } | null)?.id ?? "";
      const workspaceId = optionalString(intent.metadata?.workspace_id);
      return {
        customerId: required(customerId, "Customer ID from setup intent"),
        paymentMethodId: required(paymentMethodId, "Payment method ID from setup intent"),
        workspaceId,
      };
    } catch (error) {
      if (error instanceof RangeError) throw error;
      throw providerError(error, "create_setup_intent");
    }
  }
}
