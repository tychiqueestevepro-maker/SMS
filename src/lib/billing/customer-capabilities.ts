export type CustomerBillingCapabilities = Readonly<{
  canAcquireNumber: boolean;
  canSendMessages: boolean;
  effectiveCredits: number;
  includedCredits: number;
  maxPhoneNumbers: number;
  messagingEnabled: boolean;
  overagePriceMicroUsd: number;
  safetyCapCredits: number;
  safetyCapReached: boolean;
  subscriptionStatus: string;
  valid: boolean;
}>;

export const unavailableCustomerBillingCapabilities: CustomerBillingCapabilities =
  Object.freeze({
    canAcquireNumber: false,
    canSendMessages: false,
    effectiveCredits: 0,
    includedCredits: 0,
    maxPhoneNumbers: 0,
    messagingEnabled: false,
    overagePriceMicroUsd: 0,
    safetyCapCredits: 0,
    safetyCapReached: false,
    subscriptionStatus: "unavailable",
    valid: false,
  });

const NUMBER_ACQUISITION_STATUSES = new Set([
  "not_started",
  "setup_required",
  "active",
  "cancellation_scheduled",
]);

export function isSavedPaymentMethodStatus(value: unknown): boolean {
  return value === "saved";
}

function nonNegativeInteger(value: unknown): number | null {
  const candidate =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof candidate === "number" &&
    Number.isSafeInteger(candidate) &&
    candidate >= 0
    ? candidate
    : null;
}

export function customerBillingCapabilitiesFromSummary(
  value: unknown,
): CustomerBillingCapabilities {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return unavailableCustomerBillingCapabilities;
  }
  const row = candidate as Record<string, unknown>;
  const effectiveCredits = nonNegativeInteger(row.effective_credits);
  const includedCredits = nonNegativeInteger(row.included_credits);
  const maxPhoneNumbers = nonNegativeInteger(row.max_phone_numbers);
  const safetyCapCredits = nonNegativeInteger(row.safety_cap_credits);
  const overagePriceMicroUsd = nonNegativeInteger(
    row.additional_credit_price_micro_usd,
  );
  if (
    effectiveCredits === null ||
    includedCredits === null ||
    maxPhoneNumbers === null ||
    safetyCapCredits === null ||
    overagePriceMicroUsd === null ||
    typeof row.messaging_enabled !== "boolean" ||
    typeof row.safety_cap_reached !== "boolean" ||
    typeof row.subscription_status !== "string" ||
    !row.subscription_status.trim()
  ) {
    return unavailableCustomerBillingCapabilities;
  }

  const messagingEnabled = row.messaging_enabled;
  const safetyCapReached = row.safety_cap_reached;
  const subscriptionStatus = row.subscription_status;
  return Object.freeze({
    canAcquireNumber: NUMBER_ACQUISITION_STATUSES.has(subscriptionStatus),
    canSendMessages: messagingEnabled && !safetyCapReached,
    effectiveCredits,
    includedCredits,
    maxPhoneNumbers,
    messagingEnabled,
    overagePriceMicroUsd,
    safetyCapCredits,
    safetyCapReached,
    subscriptionStatus,
    valid: true,
  });
}
