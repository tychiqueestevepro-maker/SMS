export type BillingSubscriptionStatus =
  | "active"
  | "incomplete"
  | "past_due"
  | "canceled";

export interface BillingWebhookEventBase {
  eventId: string;
  eventType: string;
  occurredAt: string;
}

export type BillingInvoiceWebhookEventKind =
  | "invoice_created"
  | "invoice_paid"
  | "invoice_payment_failed";

export type BillingInvoiceWebhookEvent = {
  [Kind in BillingInvoiceWebhookEventKind]: BillingWebhookEventBase & {
    kind: Kind;
    billingReason: string | null;
    customerId: string;
    invoiceId: string;
    invoiceStatus: string | null;
    periodEndsAt: string | null;
    periodStartsAt: string | null;
    subscriptionId: string | null;
  };
}[BillingInvoiceWebhookEventKind];

export type BillingWebhookEvent =
  | (BillingWebhookEventBase & {
      kind: "payment_method_saved";
      customerId: string;
      paymentMethodId: string;
      setupIntentId: string;
      workspaceId: string | null;
    })
  | BillingInvoiceWebhookEvent
  | (BillingWebhookEventBase & {
      kind: "subscription_changed";
      cancelAtPeriodEnd: boolean;
      customerId: string;
      periodEndsAt: string | null;
      periodStartsAt: string | null;
      status: BillingSubscriptionStatus;
      subscriptionId: string;
      workspaceId: string | null;
    })
  | (BillingWebhookEventBase & {
      kind: "subscription_ended";
      endedAt: string;
      customerId: string;
      subscriptionId: string;
      workspaceId: string | null;
    })
  | (BillingWebhookEventBase & {
      kind: "unsupported";
    });

export interface BillingGateway {
  getRecurringPrice(input: { priceId: string }): Promise<{
    active: boolean;
    currency: string;
    interval: string | null;
    intervalCount: number | null;
    unitAmountCents: number | null;
    usageType: string | null;
  }>;
  createCustomer(input: {
    email: string;
    idempotencyKey: string;
    name: string | null;
    workspaceId: string;
  }): Promise<{ customerId: string }>;
  createSetupIntent(input: {
    customerId: string;
    idempotencyKey: string;
    workspaceId: string;
  }): Promise<{ clientSecret: string; setupIntentId: string }>;
  createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  createSubscription(input: {
    customerId: string;
    defaultPaymentMethodId: string;
    idempotencyKey: string;
    priceId: string;
    promotionCode?: string;
    workspaceId: string;
  }): Promise<{
    latestInvoiceId: string | null;
    periodEndsAt: string;
    periodStartsAt: string;
    status: BillingSubscriptionStatus;
    subscriptionId: string;
  }>;
  addAdditionalUsageInvoiceLine(input: {
    amountMicroUsd: number;
    billingInvoiceRunId: string;
    customerId: string;
    idempotencyKey: string;
    invoiceId: string;
    sourcePeriodCount: number;
    workspaceId: string;
  }): Promise<{ amountCents: number; invoiceItemId: string }>;
  scheduleSubscriptionCancellation(input: {
    idempotencyKey: string;
    subscriptionId: string;
  }): Promise<{ cancelAtPeriodEnd: boolean }>;
  verifyWebhook(input: {
    payload: Buffer;
    signature: string;
    webhookSecret: string;
  }): Promise<BillingWebhookEvent>;
}

export type BillingProviderOperation =
  | "retrieve_price"
  | "create_customer"
  | "create_setup_intent"
  | "create_portal_session"
  | "create_subscription"
  | "add_invoice_line"
  | "schedule_cancellation"
  | "verify_webhook";

/** Internal-only. Never serialize this error into a workspace response. */
export class BillingProviderError extends Error {
  readonly operation: BillingProviderOperation;
  readonly providerCode: string | null;
  readonly providerMessage: string;

  constructor(input: {
    operation: BillingProviderOperation;
    providerCode: string | null;
    providerMessage: string;
  }) {
    super(input.providerMessage);
    this.name = "BillingProviderError";
    this.operation = input.operation;
    this.providerCode = input.providerCode;
    this.providerMessage = input.providerMessage;
  }
}

export type ProductBillingErrorCode =
  | "BILLING_SETUP_FAILED"
  | "BILLING_PORTAL_FAILED"
  | "BILLING_ACTIVATION_FAILED"
  | "BILLING_CANCELLATION_FAILED"
  | "PROMOTION_CODE_INVALID";

const PRODUCT_BILLING_MESSAGES: Record<ProductBillingErrorCode, string> = {
  BILLING_SETUP_FAILED: "Billing setup couldn't be started. Please try again later.",
  BILLING_PORTAL_FAILED: "Billing settings couldn't be opened. Please try again later.",
  BILLING_ACTIVATION_FAILED: "Billing couldn't be activated. Please try again later.",
  BILLING_CANCELLATION_FAILED: "Cancellation couldn't be scheduled. Please try again later.",
  PROMOTION_CODE_INVALID: "This promo code is invalid or no longer available.",
};

export class ProductBillingError extends Error {
  readonly code: ProductBillingErrorCode;

  constructor(code: ProductBillingErrorCode) {
    super(PRODUCT_BILLING_MESSAGES[code]);
    this.name = "ProductBillingError";
    this.code = code;
  }
}

export function toProductBillingError(
  operation: BillingProviderOperation,
): ProductBillingError {
  if (operation === "create_setup_intent") return new ProductBillingError("BILLING_SETUP_FAILED");
  if (operation === "create_portal_session") return new ProductBillingError("BILLING_PORTAL_FAILED");
  if (operation === "schedule_cancellation") return new ProductBillingError("BILLING_CANCELLATION_FAILED");
  return new ProductBillingError("BILLING_ACTIVATION_FAILED");
}
