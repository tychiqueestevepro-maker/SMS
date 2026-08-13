import type { BillingSubscriptionStatus } from "./gateway";

export type BillingWebhookClaim =
  | Readonly<{ state: "claimed"; claimToken: string }>
  | Readonly<{ state: "completed" }>
  | Readonly<{ state: "busy" }>;

export interface ClaimBillingWebhookInput {
  eventId: string;
  eventType: string;
  occurredAt: string;
  receivedAt: string;
}

export type PreparedAdditionalUsageInvoiceRun =
  | Readonly<{ state: "completed" | "no_usage" }>
  | Readonly<{
      state: "ready";
      amountMicroUsd: number;
      billingInvoiceRunId: string;
      customerId: string;
      invoiceId: string;
      ledgerEntryCount: number;
      sourcePeriodIds: readonly string[];
      workspaceId: string;
    }>;

export interface BillingLifecycleMutation {
  allowTerminalReactivation: false;
  cancelAtPeriodEnd: boolean | null;
  claimToken: string;
  customerId: string;
  eventId: string;
  eventKind:
    | "invoice_paid"
    | "invoice_payment_failed"
    | "subscription_changed"
    | "subscription_ended";
  eventOccurredAt: string;
  graceEndsAt: string | null;
  invoiceId: string | null;
  periodEndsAt: string | null;
  periodStartsAt: string | null;
  status: BillingSubscriptionStatus | "grace";
  subscriptionId: string | null;
  workspaceIdHint: string | null;
}

export type PreparedSubscriptionCancellation =
  | Readonly<{ state: "completed" }>
  | Readonly<{
      state: "ready";
      cancellationRequestId: string;
      subscriptionId: string;
      workspaceId: string;
    }>;

/**
 * Internal service-role persistence seam. Every mutation is implemented by a
 * SECURITY DEFINER RPC; no provider identifiers are exposed through workspace
 * APIs or Realtime.
 */
export interface BillingRuntimeRepository {
  claimWebhookEvent(input: ClaimBillingWebhookInput): Promise<BillingWebhookClaim>;
  completeWebhookEvent(input: {
    claimToken: string;
    eventId: string;
    outcome: "ignored" | "processed";
    processedAt: string;
  }): Promise<void>;
  failWebhookEvent(input: {
    claimToken: string;
    eventId: string;
    failedAt: string;
    failureCode: string;
    providerCode: string | null;
    providerMessage: string | null;
  }): Promise<void>;
  applyPaymentMethodSaved(input: {
    claimToken: string;
    customerId: string;
    eventId: string;
    occurredAt: string;
    paymentMethodId: string;
    setupIntentId: string;
    workspaceIdHint: string | null;
  }): Promise<{ workspaceId: string }>;
  /**
   * Atomically creates or reuses the unique run for the invoice and locks the
   * exact unpaid ledger deltas. Implementations include only real outbound
   * usage attributable to the invoice's ending period plus late deltas from
   * older original periods. They must never move an entry to a newer period or
   * consume that newer period's included allowance.
   */
  prepareAdditionalUsageInvoiceRun(input: {
    billingReason: string | null;
    claimToken: string;
    customerId: string;
    eventId: string;
    invoiceCreatedAt: string;
    invoiceId: string;
    invoicePeriodEndsAt: string | null;
    invoicePeriodStartsAt: string | null;
    preparedAt: string;
    subscriptionId: string | null;
  }): Promise<PreparedAdditionalUsageInvoiceRun>;
  completeAdditionalUsageInvoiceRun(input: {
    amountCents: number;
    billingInvoiceRunId: string;
    claimToken: string;
    completedAt: string;
    eventId: string;
    invoiceId: string;
    invoiceItemId: string;
    workspaceId: string;
  }): Promise<void>;
  applyLifecycleEvent(input: BillingLifecycleMutation): Promise<{
    workspaceId: string;
  }>;
  prepareSubscriptionCancellation(input: {
    requestedAt: string;
    workspaceId: string;
  }): Promise<PreparedSubscriptionCancellation>;
  completeSubscriptionCancellation(input: {
    cancellationRequestId: string;
    completedAt: string;
    subscriptionId: string;
    workspaceId: string;
  }): Promise<void>;
  expireGracePeriods(input: {
    limit: number;
    now: string;
  }): Promise<{ expiredCount: number }>;
}
