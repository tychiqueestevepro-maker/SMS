import { describe, expect, it } from "vitest";

import {
  customerBillingCapabilitiesFromSummary,
  isSavedPaymentMethodStatus,
  unavailableCustomerBillingCapabilities,
} from "./customer-capabilities";

function summary(overrides: Record<string, unknown> = {}) {
  return {
    effective_credits: 2_450,
    included_credits: 2_000,
    max_phone_numbers: 3,
    messaging_enabled: true,
    additional_credit_price_micro_usd: 40_000,
    safety_cap_credits: 10_000,
    safety_cap_reached: false,
    subscription_status: "active",
    ...overrides,
  };
}

describe("customer billing capabilities", () => {
  it("recognizes only the persisted saved payment method state", () => {
    expect(isSavedPaymentMethodStatus("saved")).toBe(true);
    expect(isSavedPaymentMethodStatus("setup_required")).toBe(false);
    expect(isSavedPaymentMethodStatus("missing")).toBe(false);
    expect(isSavedPaymentMethodStatus(null)).toBe(false);
  });

  it("allows messaging below the safety cap for an authorized workspace", () => {
    expect(customerBillingCapabilitiesFromSummary(summary())).toMatchObject({
      canAcquireNumber: true,
      canSendMessages: true,
      effectiveCredits: 2_450,
      maxPhoneNumbers: 3,
      valid: true,
    });
  });

  it("blocks sending at the safety cap without treating overage as a block", () => {
    expect(customerBillingCapabilitiesFromSummary(summary({
      effective_credits: 10_000,
      safety_cap_reached: true,
    }))).toMatchObject({
      canSendMessages: false,
      safetyCapReached: true,
    });
    expect(customerBillingCapabilitiesFromSummary(summary({
      effective_credits: 2_001,
    })).canSendMessages).toBe(true);
  });

  it("allows initial number setup but blocks terminal workspaces", () => {
    expect(customerBillingCapabilitiesFromSummary(summary({
      messaging_enabled: false,
      subscription_status: "not_started",
    })).canAcquireNumber).toBe(true);
    expect(customerBillingCapabilitiesFromSummary(summary({
      messaging_enabled: false,
      subscription_status: "ended",
    })).canAcquireNumber).toBe(false);
  });

  it("fails closed when an authoritative field is missing or malformed", () => {
    expect(customerBillingCapabilitiesFromSummary(summary({
      messaging_enabled: undefined,
    }))).toEqual(unavailableCustomerBillingCapabilities);
    expect(customerBillingCapabilitiesFromSummary(null)).toEqual(
      unavailableCustomerBillingCapabilities,
    );
  });
});
