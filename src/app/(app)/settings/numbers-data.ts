import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { NumberSettingsData } from "@/components/numbers/types";
import { loadCustomerBillingCapabilities } from "@/lib/billing/customer-capabilities.server";
import { toNumberClientDtos } from "@/lib/numbers/client";
import type { InternalPhoneNumberRecord, NumberAdminState } from "@/lib/numbers/internal-types";
import type { NumberImportStatus, NumberSource } from "@/lib/numbers/product-types";
import {
  canConnectConfiguredExistingNumber,
  CONFIGURED_EXISTING_NUMBER,
} from "@/lib/numbers/configured-existing-number.server";
import { evaluateNumberCapacity } from "@/lib/numbers/policy";
import { numberImportsConfigured } from "@/lib/runtime/messaging.server";
import { billingPublishableKeyFromEnvironment } from "@/lib/runtime/billing.server";
import { createClient } from "@/lib/supabase/server";

type NumberRow = {
  id: string;
  phone_e164: string;
  status: "pending" | "ready";
  number_source: "included" | "imported";
  country_code: string | null;
  import_status: NumberImportStatus | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type NumberImportDetailRow = {
  phone_number_id: string;
  import_status: NumberImportStatus;
  verification_code: string | null;
};

const IMPORT_STATUSES = new Set<NumberImportStatus>([
  "verification",
  "pending",
  "importing",
  "action_required",
  "active",
  "failed",
]);

function importDetailRows(value: unknown): NumberImportDetailRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    if (
      typeof row.phone_number_id !== "string" ||
      typeof row.import_status !== "string" ||
      !IMPORT_STATUSES.has(row.import_status as NumberImportStatus) ||
      (row.verification_code !== null &&
        typeof row.verification_code !== "string")
    ) {
      return [];
    }
    return [row as NumberImportDetailRow];
  });
}

export type NumberServerContext = {
  maxPhoneNumbers: number;
  numberAcquisitionAllowed: boolean;
  ownerEmail: string | null;
  ownerUserId: string;
  records: InternalPhoneNumberRecord[];
  supabase: SupabaseClient;
  workspaceId: string;
};

export async function loadNumberServerContext(): Promise<NumberServerContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!workspace) return null;

  const [capabilities, { data: numberData }, importDetailsResponse] = await Promise.all([
    loadCustomerBillingCapabilities(supabase),
    supabase
      .from("phone_numbers")
      .select("id,phone_e164,status,number_source,country_code,import_status,activated_at,created_at,updated_at,deleted_at")
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .order("created_at"),
    supabase.rpc("get_my_phone_number_import_details"),
  ]);
  const importDetails = new Map(
    importDetailRows(importDetailsResponse.data).map((detail) => [
      detail.phone_number_id,
      detail,
    ]),
  );
  const records: InternalPhoneNumberRecord[] = ((numberData ?? []) as NumberRow[]).map((number) => ({
    activatedAt: number.activated_at,
    adminState: (number.status === "ready" ? "ready" : "under_review") as NumberAdminState,
    countryCode: number.country_code,
    createdAt: number.created_at,
    deletedAt: number.deleted_at,
    id: number.id,
    importStatus:
      number.number_source === "imported"
        ? importDetails.get(number.id)?.import_status ?? number.import_status ?? "pending"
        : null,
    isDefault: false,
    phoneNumber: number.phone_e164,
    source: (number.number_source === "imported" ? "imported" : "included") as NumberSource,
    technical: {} as InternalPhoneNumberRecord["technical"],
    updatedAt: number.updated_at,
    verificationCode:
      number.number_source === "imported"
        ? importDetails.get(number.id)?.verification_code ?? null
        : null,
  }));

  return {
    maxPhoneNumbers: capabilities.maxPhoneNumbers,
    numberAcquisitionAllowed: capabilities.canAcquireNumber,
    ownerEmail: user.email ?? null,
    ownerUserId: user.id,
    records,
    supabase,
    workspaceId: workspace.id as string,
  };
}

export async function loadNumberSettingsData(): Promise<NumberSettingsData> {
  const context = await loadNumberServerContext();
  if (!context) {
    return {
      canImportNumber: false,
      canConnectExistingNumber: false,
      canObtainIncludedNumber: false,
      importedNumberCount: 0,
      existingNumberToConnect: null,
      importNumberUnavailableReason: "billing",
      includedNumberCount: 0,
      includedNumberUnavailableReason: "billing",
      maxPhoneNumbers: 0,
      numbers: [],
      remainingIncludedSlots: 0,
      needsBillingSetup: false,
      billingPublishableKey: null,
    };
  }
  const capacity = evaluateNumberCapacity(context.records, { maxPhoneNumbers: context.maxPhoneNumbers });
  const configuredConnectionAllowed = canConnectConfiguredExistingNumber({
    email: context.ownerEmail,
    userId: context.ownerUserId,
  });
  const configuredNumberConnected = context.records.some(
    (record) => record.phoneNumber === CONFIGURED_EXISTING_NUMBER.phoneNumber,
  );
  const importsConfigured = numberImportsConfigured();
  const importedNumberCount = context.records.filter(
    (record) => record.source === "imported" && record.deletedAt === null,
  ).length;
  // needsBillingSetup: user has no saved payment method yet.
  // We detect this via payment_method_status from the billing summary RPC.
  const { data: billingSummaryData } = await context.supabase.rpc("get_billing_usage_summary");
  const billingSummaryRow = Array.isArray(billingSummaryData) ? billingSummaryData[0] : billingSummaryData;
  const paymentMethodStatus = billingSummaryRow && typeof billingSummaryRow === "object"
    ? (billingSummaryRow as Record<string, unknown>).payment_method_status
    : null;
  const needsBillingSetup = paymentMethodStatus !== "saved" && paymentMethodStatus !== "ready" && paymentMethodStatus !== "attached";
  let billingPublishableKey: string | null = null;
  if (needsBillingSetup) {
    try { billingPublishableKey = billingPublishableKeyFromEnvironment(); } catch { /* not configured */ }
  }
  return {
    // Always allow — payment happens inside the dialog if needed.
    canImportNumber: importsConfigured,
    canConnectExistingNumber:
      configuredConnectionAllowed &&
      !configuredNumberConnected &&
      capacity.allowed &&
      context.numberAcquisitionAllowed,
    canObtainIncludedNumber: true,
    importedNumberCount,
    existingNumberToConnect: configuredConnectionAllowed
      ? CONFIGURED_EXISTING_NUMBER.phoneNumber
      : null,
    importNumberUnavailableReason: !importsConfigured ? "configuration" : null,
    includedNumberCount: capacity.currentNumberCount,
    includedNumberUnavailableReason: capacity.allowed ? null : "limit",
    maxPhoneNumbers: capacity.maxPhoneNumbers,
    numbers: toNumberClientDtos(context.records),
    remainingIncludedSlots: capacity.remainingSlots,
    needsBillingSetup,
    billingPublishableKey,
  };
}
