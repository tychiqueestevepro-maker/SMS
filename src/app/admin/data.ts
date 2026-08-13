import "server-only";

import type { AuthorizedAdmin } from "@/lib/admin/authorization.server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

import type {
  AdminBillingOperationRow,
  AdminCustomerRow,
  AdminDashboardData,
  AdminDataSection,
  AdminMessageOperationRow,
  AdminNumberRow,
} from "./types";

export const ADMIN_RPC_NAMES = {
  billing: "admin_get_billing_operations",
  confirmAdvancedOptOut: "admin_confirm_workspace_advanced_opt_out",
  customers: "admin_get_customers",
  messages: "admin_get_message_operations",
  numbers: "admin_get_number_operations",
  recordNumberSetupState: "admin_record_phone_number_setup_state",
  setSafetyCap: "admin_set_workspace_safety_cap",
} as const;

type UnknownRow = Record<string, unknown>;

function rowsFrom(value: unknown): UnknownRow[] {
  if (Array.isArray(value)) {
    return value.filter((row): row is UnknownRow => Boolean(row) && typeof row === "object");
  }
  if (value && typeof value === "object" && Array.isArray((value as UnknownRow).rows)) {
    return ((value as UnknownRow).rows as unknown[]).filter(
      (row): row is UnknownRow => Boolean(row) && typeof row === "object",
    );
  }
  return [];
}

function textValue(row: UnknownRow, key: string, fallback = ""): string {
  const value = row[key];
  return typeof value === "string" ? value : fallback;
}

function optionalText(row: UnknownRow, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integerValue(row: UnknownRow, key: string, fallback = 0): number {
  const value = row[key];
  const parsed = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) ? parsed : fallback;
}

function optionalInteger(row: UnknownRow, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) ? parsed : null;
}

function booleanValue(row: UnknownRow, key: string, fallback: boolean): boolean {
  return typeof row[key] === "boolean" ? row[key] : fallback;
}

function mapCustomer(row: UnknownRow): AdminCustomerRow {
  return {
    actualCredits: integerValue(row, "actual_credits"),
    createdAt: textValue(row, "created_at"),
    includedCredits: integerValue(row, "included_credits"),
    messagingEnabled: booleanValue(row, "messaging_enabled", false),
    ownerEmail: optionalText(row, "owner_email"),
    ownerName: optionalText(row, "owner_name"),
    paymentMethodStatus: optionalText(row, "payment_method_status"),
    pendingPhoneCount: integerValue(row, "pending_phone_count"),
    phoneCount: integerValue(row, "phone_count"),
    reservedCredits: integerValue(row, "reserved_credits"),
    safetyCapCredits: integerValue(row, "safety_cap_credits"),
    subscriptionStatus: optionalText(row, "subscription_status"),
    suspensionReason: optionalText(row, "suspension_reason"),
    workspaceId: textValue(row, "workspace_id"),
    workspaceName: textValue(row, "workspace_name", "Unnamed workspace"),
  };
}

function mapNumber(row: UnknownRow): AdminNumberRow {
  return {
    activationEligible: booleanValue(row, "activation_eligible", false),
    advancedOptOutConfirmed: booleanValue(
      row,
      "advanced_opt_out_confirmed",
      false,
    ),
    a2pState: optionalText(row, "a2p_state"),
    accountSid: optionalText(row, "account_sid"),
    messagingServiceSid: optionalText(row, "messaging_service_sid"),
    numberId: textValue(row, "number_id"),
    phoneNumber: textValue(row, "phone_number"),
    productStatus: textValue(row, "product_status", "unknown"),
    provider: optionalText(row, "provider"),
    providerErrorCode: optionalText(row, "provider_error_code"),
    providerErrorMessage: optionalText(row, "provider_error_message"),
    providerNumberId: optionalText(row, "provider_number_id"),
    providerStatus: optionalText(row, "provider_status"),
    setupState: optionalText(row, "setup_state"),
    updatedAt: textValue(row, "updated_at"),
    workspaceId: textValue(row, "workspace_id"),
    workspaceName: textValue(row, "workspace_name", "Unnamed workspace"),
  };
}

function mapMessage(row: UnknownRow): AdminMessageOperationRow {
  return {
    acceptedAt: optionalText(row, "accepted_at"),
    createdAt: textValue(row, "created_at"),
    deliveryState: optionalText(row, "delivery_state"),
    direction: textValue(row, "direction", "unknown"),
    dispatchState: textValue(row, "dispatch_state", "unknown"),
    messageId: textValue(row, "message_id"),
    numSegments: optionalInteger(row, "num_segments"),
    provider: optionalText(row, "provider"),
    providerCostMicroUsd: optionalInteger(row, "provider_cost_micro_usd"),
    providerCurrency: optionalText(row, "provider_currency"),
    providerErrorCode: optionalText(row, "provider_error_code"),
    providerErrorMessage: optionalText(row, "provider_error_message"),
    providerMessageId: optionalText(row, "provider_message_id"),
    providerStatus: optionalText(row, "provider_status"),
    reconciliationReason: optionalText(row, "reconciliation_reason"),
    workspaceId: textValue(row, "workspace_id"),
    workspaceName: textValue(row, "workspace_name", "Unnamed workspace"),
  };
}

function mapBilling(row: UnknownRow): AdminBillingOperationRow {
  return {
    actualOutboundSegments: integerValue(row, "actual_outbound_segments"),
    billedAmountMicroUsd: integerValue(row, "billed_amount_micro_usd"),
    includedSegments: integerValue(row, "included_segments"),
    invoiceId: optionalText(row, "invoice_id"),
    invoiceRunId: optionalText(row, "invoice_run_id"),
    invoiceStatus: optionalText(row, "invoice_status"),
    overageAmountMicroUsd: integerValue(row, "overage_amount_micro_usd"),
    overageSegments: integerValue(row, "overage_segments"),
    periodEnd: textValue(row, "period_end"),
    periodId: textValue(row, "period_id"),
    periodStart: textValue(row, "period_start"),
    periodStatus: textValue(row, "period_status", "unknown"),
    providerCostMicroUsd: integerValue(row, "provider_cost_micro_usd"),
    providerFixedCostMicroUsd: integerValue(row, "provider_fixed_cost_micro_usd"),
    providerMessageCostMicroUsd: integerValue(row, "provider_message_cost_micro_usd"),
    reconciliationStatus: optionalText(row, "reconciliation_status"),
    reservedOutboundSegments: integerValue(row, "reserved_outbound_segments"),
    safetyCapSegments: integerValue(row, "safety_cap_segments"),
    subscriptionId: optionalText(row, "subscription_id"),
    workspaceId: textValue(row, "workspace_id"),
    workspaceName: textValue(row, "workspace_name", "Unnamed workspace"),
  };
}

async function readSection<T>(
  rpcName: string,
  mapper: (row: UnknownRow) => T,
): Promise<AdminDataSection<T>> {
  const service = createServiceRoleClient();
  const { data, error } = await service.rpc(rpcName, { p_limit: 100 });
  if (error) {
    return {
      error: { code: error.code ?? null, message: error.message },
      status: "error",
    };
  }
  return { rows: rowsFrom(data).map(mapper), status: "ready" };
}

export async function loadAdminDashboard(
  authorizedAdmin: AuthorizedAdmin,
): Promise<AdminDashboardData> {
  void authorizedAdmin;
  const [customers, numbers, messages, billing] = await Promise.all([
    readSection(ADMIN_RPC_NAMES.customers, mapCustomer),
    readSection(ADMIN_RPC_NAMES.numbers, mapNumber),
    readSection(ADMIN_RPC_NAMES.messages, mapMessage),
    readSection(ADMIN_RPC_NAMES.billing, mapBilling),
  ]);

  return {
    billing,
    customers,
    generatedAt: new Date().toISOString(),
    messages,
    numbers,
  };
}
