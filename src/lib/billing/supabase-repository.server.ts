import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BillingRepository,
  RecordBillingCustomerInput,
  RecordBillingSetupIntentInput,
  RecordBillingSubscriptionInput,
  WorkspaceBillingAccount,
} from "./repository";

type UnknownRow = Record<string, unknown>;

export class BillingRepositoryError extends Error {
  constructor(readonly operation: string) {
    super("Billing persistence is temporarily unavailable.");
    this.name = "BillingRepositoryError";
  }
}

function firstRow(value: unknown): UnknownRow | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object"
    ? (candidate as UnknownRow)
    : null;
}

function optionalString(row: UnknownRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new BillingRepositoryError("invalid_rpc_response");
  }
  return value;
}

function requiredString(row: UnknownRow, key: string): string {
  const value = optionalString(row, key);
  if (!value) throw new BillingRepositoryError("invalid_rpc_response");
  return value;
}

function optionalTimestamp(row: UnknownRow, key: string): string | null {
  const value = optionalString(row, key);
  if (value === null) return null;
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new BillingRepositoryError("invalid_rpc_response");
  }
  return timestamp.toISOString();
}

function nonNegativeSafeInteger(row: UnknownRow, key: string): number {
  const value = row[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new BillingRepositoryError("invalid_rpc_response");
  }
  return value as number;
}

function requiredBoolean(row: UnknownRow, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") {
    throw new BillingRepositoryError("invalid_rpc_response");
  }
  return value;
}

export class SupabaseBillingRepository implements BillingRepository {
  constructor(private readonly client: SupabaseClient) {}

  async claimPaymentSetupAttempt(
    input: Parameters<BillingRepository["claimPaymentSetupAttempt"]>[0],
  ) {
    const { data, error } = await this.client.rpc(
      "billing_claim_payment_setup_attempt",
      {
        p_request_id: input.requestId,
        p_requested_at: input.requestedAt,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) throw new BillingRepositoryError("claim_payment_setup_attempt");
    const row = firstRow(data);
    if (!row) throw new BillingRepositoryError("invalid_rpc_response");
    return {
      allowed: requiredBoolean(row, "allowed"),
      replayed: requiredBoolean(row, "replayed"),
      retryAfterSeconds: nonNegativeSafeInteger(row, "retry_after_seconds"),
    };
  }

  async getWorkspaceAccount(workspaceId: string): Promise<WorkspaceBillingAccount> {
    const { data, error } = await this.client.rpc("billing_get_workspace_account", {
      p_workspace_id: workspaceId,
    });
    if (error) throw new BillingRepositoryError("get_workspace_account");
    const row = firstRow(data);
    if (!row) throw new BillingRepositoryError("workspace_account_not_found");
    const returnedWorkspaceId = requiredString(row, "workspace_id");
    if (returnedWorkspaceId !== workspaceId) {
      throw new BillingRepositoryError("workspace_correlation_mismatch");
    }
    return {
      customerId: optionalString(row, "customer_id"),
      currentPeriodEndsAt: optionalTimestamp(row, "current_period_end"),
      currentPeriodStartsAt: optionalTimestamp(row, "current_period_start"),
      defaultPaymentMethodId: optionalString(row, "default_payment_method_id"),
      monthlyPriceCents: nonNegativeSafeInteger(row, "monthly_price_cents"),
      subscriptionId: optionalString(row, "subscription_id"),
      subscriptionPriceId: optionalString(row, "subscription_price_id"),
      subscriptionStatus: optionalString(row, "subscription_status"),
      workspaceId: returnedWorkspaceId,
    };
  }

  async recordCustomer(input: RecordBillingCustomerInput): Promise<void> {
    const { error } = await this.client.rpc("billing_record_customer", {
      p_customer_id: input.customerId,
      p_recorded_at: input.recordedAt,
      p_workspace_id: input.workspaceId,
    });
    if (error) throw new BillingRepositoryError("record_customer");
  }

  async recordSetupIntent(input: RecordBillingSetupIntentInput): Promise<void> {
    const { error } = await this.client.rpc("billing_record_setup_intent", {
      p_customer_id: input.customerId,
      p_recorded_at: input.recordedAt,
      p_setup_intent_id: input.setupIntentId,
      p_workspace_id: input.workspaceId,
    });
    if (error) throw new BillingRepositoryError("record_setup_intent");
  }

  async recordSubscription(input: RecordBillingSubscriptionInput): Promise<void> {
    const { error } = await this.client.rpc("billing_record_subscription", {
      p_customer_id: input.customerId,
      p_latest_invoice_id: input.latestInvoiceId,
      p_period_end: input.periodEndsAt,
      p_period_start: input.periodStartsAt,
      p_price_id: input.priceId,
      p_recorded_at: input.recordedAt,
      p_status: input.status,
      p_subscription_id: input.subscriptionId,
      p_workspace_id: input.workspaceId,
    });
    if (error) throw new BillingRepositoryError("record_subscription");
  }
}
