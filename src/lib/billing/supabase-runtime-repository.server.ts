import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BillingLifecycleMutation,
  BillingRuntimeRepository,
  BillingWebhookClaim,
  ClaimBillingWebhookInput,
  PreparedAdditionalUsageInvoiceRun,
  PreparedSubscriptionCancellation,
} from "./runtime-repository";

type UnknownRow = Record<string, unknown>;

export class BillingRuntimeRepositoryError extends Error {
  constructor(readonly operation: string) {
    super("Billing persistence is temporarily unavailable.");
    this.name = "BillingRuntimeRepositoryError";
  }
}

function firstRow(value: unknown): UnknownRow | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as UnknownRow)
    : null;
}

function requiredRow(value: unknown): UnknownRow {
  const row = firstRow(value);
  if (!row) throw new BillingRuntimeRepositoryError("invalid_rpc_response");
  return row;
}

function string(row: UnknownRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new BillingRuntimeRepositoryError("invalid_rpc_response");
  }
  return value;
}

function safeInteger(row: UnknownRow, key: string, minimum = 0): number {
  const value = row[key];
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new BillingRuntimeRepositoryError("invalid_rpc_response");
  }
  return value as number;
}

function strings(row: UnknownRow, key: string): readonly string[] {
  const value = row[key];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new BillingRuntimeRepositoryError("invalid_rpc_response");
  }
  const result = value as string[];
  if (new Set(result).size !== result.length) {
    throw new BillingRuntimeRepositoryError("invalid_rpc_response");
  }
  return Object.freeze([...result]);
}

function expect(row: UnknownRow, key: string, expected: string): void {
  if (string(row, key) !== expected) {
    throw new BillingRuntimeRepositoryError("rpc_correlation_mismatch");
  }
}

export class SupabaseBillingRuntimeRepository implements BillingRuntimeRepository {
  constructor(private readonly client: SupabaseClient) {}

  async claimWebhookEvent(input: ClaimBillingWebhookInput): Promise<BillingWebhookClaim> {
    const { data, error } = await this.client.rpc("billing_claim_webhook_event", {
      p_event_created_at: input.occurredAt,
      p_event_id: input.eventId,
      p_event_type: input.eventType,
      p_received_at: input.receivedAt,
    });
    if (error) throw new BillingRuntimeRepositoryError("claim_webhook_event");
    const row = requiredRow(data);
    expect(row, "event_id", input.eventId);
    const state = string(row, "claim_state");
    if (state === "completed" || state === "busy") return { state };
    if (state !== "claimed") {
      throw new BillingRuntimeRepositoryError("invalid_rpc_response");
    }
    return { claimToken: string(row, "claim_token"), state };
  }

  async completeWebhookEvent(
    input: Parameters<BillingRuntimeRepository["completeWebhookEvent"]>[0],
  ): Promise<void> {
    const { data, error } = await this.client.rpc("billing_complete_webhook_event", {
      p_claim_token: input.claimToken,
      p_event_id: input.eventId,
      p_outcome: input.outcome,
      p_processed_at: input.processedAt,
    });
    if (error) throw new BillingRuntimeRepositoryError("complete_webhook_event");
    const row = requiredRow(data);
    expect(row, "event_id", input.eventId);
    if (string(row, "event_status") !== "completed") {
      throw new BillingRuntimeRepositoryError("invalid_rpc_response");
    }
  }

  async failWebhookEvent(
    input: Parameters<BillingRuntimeRepository["failWebhookEvent"]>[0],
  ): Promise<void> {
    const { data, error } = await this.client.rpc("billing_fail_webhook_event", {
      p_claim_token: input.claimToken,
      p_event_id: input.eventId,
      p_failed_at: input.failedAt,
      p_failure_code: input.failureCode,
      p_provider_code: input.providerCode,
      p_provider_message: input.providerMessage,
    });
    if (error) throw new BillingRuntimeRepositoryError("fail_webhook_event");
    const row = requiredRow(data);
    expect(row, "event_id", input.eventId);
    if (string(row, "event_status") !== "failed") {
      throw new BillingRuntimeRepositoryError("invalid_rpc_response");
    }
  }

  async applyPaymentMethodSaved(
    input: Parameters<BillingRuntimeRepository["applyPaymentMethodSaved"]>[0],
  ): Promise<{ workspaceId: string }> {
    const { data, error } = await this.client.rpc("billing_apply_payment_method_event", {
      p_claim_token: input.claimToken,
      p_customer_id: input.customerId,
      p_event_id: input.eventId,
      p_occurred_at: input.occurredAt,
      p_payment_method_id: input.paymentMethodId,
      p_setup_intent_id: input.setupIntentId,
      p_workspace_id_hint: input.workspaceIdHint,
    });
    if (error) throw new BillingRuntimeRepositoryError("apply_payment_method_event");
    const row = requiredRow(data);
    expect(row, "event_id", input.eventId);
    expect(row, "customer_id", input.customerId);
    expect(row, "payment_method_id", input.paymentMethodId);
    return { workspaceId: string(row, "workspace_id") };
  }

  async prepareAdditionalUsageInvoiceRun(
    input: Parameters<BillingRuntimeRepository["prepareAdditionalUsageInvoiceRun"]>[0],
  ): Promise<PreparedAdditionalUsageInvoiceRun> {
    const { data, error } = await this.client.rpc(
      "billing_prepare_additional_usage_invoice_run",
      {
        p_billing_reason: input.billingReason,
        p_claim_token: input.claimToken,
        p_customer_id: input.customerId,
        p_event_id: input.eventId,
        p_invoice_created_at: input.invoiceCreatedAt,
        p_invoice_id: input.invoiceId,
        p_invoice_period_end: input.invoicePeriodEndsAt,
        p_invoice_period_start: input.invoicePeriodStartsAt,
        p_prepared_at: input.preparedAt,
        p_subscription_id: input.subscriptionId,
      },
    );
    if (error) {
      throw new BillingRuntimeRepositoryError("prepare_additional_usage_invoice_run");
    }
    const row = requiredRow(data);
    expect(row, "event_id", input.eventId);
    expect(row, "customer_id", input.customerId);
    expect(row, "invoice_id", input.invoiceId);
    const state = string(row, "run_state");
    if (state === "completed" || state === "no_usage") return { state };
    if (state !== "ready") {
      throw new BillingRuntimeRepositoryError("invalid_rpc_response");
    }
    const amountMicroUsd = safeInteger(row, "amount_micro_usd", 1);
    const ledgerEntryCount = safeInteger(row, "ledger_entry_count", 1);
    const sourcePeriodIds = strings(row, "source_period_ids");
    if (sourcePeriodIds.length < 1) {
      throw new BillingRuntimeRepositoryError("invalid_rpc_response");
    }
    return {
      amountMicroUsd,
      billingInvoiceRunId: string(row, "billing_invoice_run_id"),
      customerId: input.customerId,
      invoiceId: input.invoiceId,
      ledgerEntryCount,
      sourcePeriodIds,
      state,
      workspaceId: string(row, "workspace_id"),
    };
  }

  async completeAdditionalUsageInvoiceRun(
    input: Parameters<BillingRuntimeRepository["completeAdditionalUsageInvoiceRun"]>[0],
  ): Promise<void> {
    const { data, error } = await this.client.rpc(
      "billing_complete_additional_usage_invoice_run",
      {
        p_amount_cents: input.amountCents,
        p_billing_invoice_run_id: input.billingInvoiceRunId,
        p_claim_token: input.claimToken,
        p_completed_at: input.completedAt,
        p_event_id: input.eventId,
        p_invoice_id: input.invoiceId,
        p_invoice_item_id: input.invoiceItemId,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) {
      throw new BillingRuntimeRepositoryError("complete_additional_usage_invoice_run");
    }
    const row = requiredRow(data);
    expect(row, "billing_invoice_run_id", input.billingInvoiceRunId);
    expect(row, "event_id", input.eventId);
    expect(row, "invoice_id", input.invoiceId);
    expect(row, "invoice_item_id", input.invoiceItemId);
    expect(row, "workspace_id", input.workspaceId);
    if (string(row, "run_state") !== "completed") {
      throw new BillingRuntimeRepositoryError("invalid_rpc_response");
    }
  }

  async applyLifecycleEvent(
    input: BillingLifecycleMutation,
  ): Promise<{ workspaceId: string }> {
    const { data, error } = await this.client.rpc("billing_apply_lifecycle_event", {
      p_allow_terminal_reactivation: input.allowTerminalReactivation,
      p_cancel_at_period_end: input.cancelAtPeriodEnd,
      p_claim_token: input.claimToken,
      p_customer_id: input.customerId,
      p_event_id: input.eventId,
      p_event_kind: input.eventKind,
      p_event_occurred_at: input.eventOccurredAt,
      p_grace_ends_at: input.graceEndsAt,
      p_invoice_id: input.invoiceId,
      p_period_end: input.periodEndsAt,
      p_period_start: input.periodStartsAt,
      p_status: input.status,
      p_subscription_id: input.subscriptionId,
      p_workspace_id_hint: input.workspaceIdHint,
    });
    if (error) throw new BillingRuntimeRepositoryError("apply_lifecycle_event");
    const row = requiredRow(data);
    expect(row, "event_id", input.eventId);
    if (input.subscriptionId) {
      expect(row, "subscription_id", input.subscriptionId);
    }
    return { workspaceId: string(row, "workspace_id") };
  }

  async prepareSubscriptionCancellation(
    input: Parameters<BillingRuntimeRepository["prepareSubscriptionCancellation"]>[0],
  ): Promise<PreparedSubscriptionCancellation> {
    const { data, error } = await this.client.rpc(
      "billing_prepare_subscription_cancellation",
      {
        p_requested_at: input.requestedAt,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) {
      throw new BillingRuntimeRepositoryError("prepare_subscription_cancellation");
    }
    const row = requiredRow(data);
    expect(row, "workspace_id", input.workspaceId);
    const state = string(row, "request_state");
    if (state === "completed") return { state };
    if (state !== "ready") {
      throw new BillingRuntimeRepositoryError("invalid_rpc_response");
    }
    return {
      cancellationRequestId: string(row, "cancellation_request_id"),
      state,
      subscriptionId: string(row, "subscription_id"),
      workspaceId: input.workspaceId,
    };
  }

  async completeSubscriptionCancellation(
    input: Parameters<BillingRuntimeRepository["completeSubscriptionCancellation"]>[0],
  ): Promise<void> {
    const { data, error } = await this.client.rpc(
      "billing_complete_subscription_cancellation",
      {
        p_cancellation_request_id: input.cancellationRequestId,
        p_completed_at: input.completedAt,
        p_subscription_id: input.subscriptionId,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) {
      throw new BillingRuntimeRepositoryError("complete_subscription_cancellation");
    }
    const row = requiredRow(data);
    expect(row, "cancellation_request_id", input.cancellationRequestId);
    expect(row, "subscription_id", input.subscriptionId);
    expect(row, "workspace_id", input.workspaceId);
    if (string(row, "request_state") !== "completed") {
      throw new BillingRuntimeRepositoryError("invalid_rpc_response");
    }
  }

  async expireGracePeriods(
    input: Parameters<BillingRuntimeRepository["expireGracePeriods"]>[0],
  ): Promise<{ expiredCount: number }> {
    const { data, error } = await this.client.rpc("billing_expire_grace_periods", {
      p_limit: input.limit,
      p_now: input.now,
    });
    if (error) throw new BillingRuntimeRepositoryError("expire_grace_periods");
    const row = requiredRow(data);
    return { expiredCount: safeInteger(row, "expired_count") };
  }
}
