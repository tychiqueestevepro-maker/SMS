// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toCustomerSmsUsageDto, type BillingPeriodSnapshot } from "@/lib/billing";

import { BillingSettingsPanel } from "./billing-settings-panel";
import type { BillingSettingsData } from "./types";

const mocks = vi.hoisted(() => ({
  activateConfiguredAccountSubscription: vi.fn(),
  createBillingPortalSession: vi.fn(),
  createBillingSetupSession: vi.fn(),
  requestBillingCancellation: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/app/(app)/settings/billing-actions", () => ({
  activateConfiguredAccountSubscription: mocks.activateConfiguredAccountSubscription,
  createBillingPortalSession: mocks.createBillingPortalSession,
  createBillingSetupSession: mocks.createBillingSetupSession,
  requestBillingCancellation: mocks.requestBillingCancellation,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/components/billing/payment-method-dialog", () => ({
  PaymentMethodDialog: ({
    onComplete,
    session,
  }: {
    onComplete: () => void;
    session: { clientSecret: string };
  }) => (
    <div aria-label="Embedded payment form" role="dialog">
      <span>{session.clientSecret}</span>
      <button onClick={onComplete} type="button">Complete card setup</button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const period: BillingPeriodSnapshot = {
  endsAt: "2026-09-10T00:00:00.000Z",
  id: "period-1",
  plan: {
    includedSegments: 2_000,
    maxPhoneNumbers: 3,
    monthlyPriceCents: 8_999,
    overagePriceMicroUsd: 40_000,
    planId: "plan-1",
    planVersion: 1,
    safetyCapSegments: 10_000,
  },
  startsAt: "2026-08-10T00:00:00.000Z",
  workspaceId: "workspace-1",
};

function settingsData(usedCredits: number): BillingSettingsData {
  return {
    canActivateSubscriptionDirectly: false,
    directActivationAccount: false,
    paymentMethod: { label: "No payment method added", status: "missing" },
    plan: {
      additionalCreditPriceMicroUsd: period.plan.overagePriceMicroUsd,
      includedCredits: period.plan.includedSegments,
      maxPhoneNumbers: period.plan.maxPhoneNumbers,
      monthlyPriceCents: period.plan.monthlyPriceCents,
    },
    subscription: {
      canCancel: false,
      canManageBilling: false,
      canSetUpPayment: false,
      description: "Billing starts when your phone number is ready.",
      label: "Not started",
      status: "awaiting_number",
    },
    usage: toCustomerSmsUsageDto(period, usedCredits),
  };
}

describe("BillingSettingsPanel", () => {
  it("shows customer usage in SMS credits with the exact helper copy", () => {
    const { container } = render(<BillingSettingsPanel data={settingsData(1_247)} />);

    expect(screen.getByText("1,247 / 2,000 SMS credits used")).toBeTruthy();
    expect(
      screen.getByText(
        "Message length and special characters can cause a single message to use more than one SMS credit.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("$89.99", { exact: false })).toBeTruthy();
    expect(screen.getByText(/2,000 SMS credits included/)).toBeTruthy();
    expect(container.textContent?.toLowerCase()).not.toContain("segment");
  });

  it("shows aggregated additional credits and amount without per-message detail", () => {
    render(<BillingSettingsPanel data={settingsData(2_450)} />);

    expect(screen.getByText("2,450 SMS credits used")).toBeTruthy();
    expect(screen.getByText("450 additional credits")).toBeTruthy();
    expect(screen.getByText("Additional usage: $18.00")).toBeTruthy();
    expect(screen.queryByText(/message charge/i)).toBeNull();
  });

  it("keeps payment controls non-interactive until the server enables a session", () => {
    const { rerender } = render(<BillingSettingsPanel data={settingsData(0)} />);

    expect(screen.queryByRole("button", { name: "Add payment method" })).toBeNull();
    expect(screen.getByText("Billing starts when your phone number is ready.")).toBeTruthy();

    const enabled = settingsData(0);
    enabled.subscription = {
      canCancel: false,
      canManageBilling: false,
      canSetUpPayment: true,
      description: "Add a payment method to finish setting up your Riink plan.",
      label: "Setup needed",
      status: "setup_required",
    };
    rerender(<BillingSettingsPanel data={enabled} />);
    expect(screen.getByRole("button", { name: "Add payment method" })).toBeTruthy();
  });

  it("opens the embedded setup form and refreshes after confirmation", async () => {
    mocks.createBillingSetupSession.mockResolvedValue({
      clientSecret: "seti_client_secret",
      kind: "setup",
      ok: true,
      publishableKey: "pk_test_public",
    });
    const enabled = settingsData(0);
    enabled.subscription = {
      canCancel: false,
      canManageBilling: false,
      canSetUpPayment: true,
      description: "Add a payment method to finish setting up your Riink plan.",
      label: "Setup needed",
      status: "setup_required",
    };
    render(<BillingSettingsPanel data={enabled} />);

    fireEvent.click(screen.getByRole("button", { name: "Add payment method" }));
    expect(await screen.findByRole("dialog", { name: "Embedded payment form" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Complete card setup" }));

    expect(await screen.findByText("Payment method saved.")).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("requires explicit confirmation before scheduling cancellation", async () => {
    mocks.requestBillingCancellation.mockResolvedValue({
      alreadyScheduled: false,
      kind: "cancellation",
      message: "Cancellation scheduled.",
      ok: true,
    });
    const active = settingsData(350);
    active.paymentMethod = { label: "Payment method saved", status: "saved" };
    active.subscription = {
      canCancel: true,
      canManageBilling: true,
      canSetUpPayment: false,
      description: "Your Riink monthly plan is active.",
      label: "Active",
      status: "active",
    };
    render(<BillingSettingsPanel data={active} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel plan" }));
    expect(mocks.requestBillingCancellation).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Cancel Riink plan?" })).toBeTruthy();
    expect(
      screen.getByText(
        "Your plan will remain available through the end of the current billing period. A seven-day grace period follows.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Schedule cancellation" }));

    expect(await screen.findByText("Cancellation scheduled.")).toBeTruthy();
    expect(mocks.requestBillingCancellation).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Cancel Riink plan?" })).toBeNull();
  });

  it("charges the configured account only after explicit confirmation", async () => {
    mocks.activateConfiguredAccountSubscription.mockResolvedValue({
      kind: "activation",
      message: "Your Riink subscription is active.",
      ok: true,
    });
    const configured = settingsData(0);
    configured.canActivateSubscriptionDirectly = true;
    configured.directActivationAccount = true;
    configured.paymentMethod = { label: "Payment method saved", status: "saved" };
    configured.subscription = {
      canCancel: false,
      canManageBilling: false,
      canSetUpPayment: true,
      description: "Billing starts when your phone number is ready.",
      label: "Setup needed",
      status: "setup_required",
    };
    render(<BillingSettingsPanel data={configured} />);

    fireEvent.click(screen.getByRole("button", { name: "Start subscription" }));
    expect(mocks.activateConfiguredAccountSubscription).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Start Riink subscription?" })).toBeTruthy();
    expect(screen.getByText(/The charge today is \$89.99/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pay and start subscription" }));
    expect(await screen.findByText("Your Riink subscription is active.")).toBeTruthy();
    expect(mocks.activateConfiguredAccountSubscription).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("does not offer cancellation once cancellation is scheduled", () => {
    const scheduled = settingsData(350);
    scheduled.subscription = {
      canCancel: false,
      canManageBilling: true,
      canSetUpPayment: false,
      description:
        "Your plan will end after the current billing period, followed by a seven-day grace period.",
      label: "Cancellation scheduled",
      status: "cancellation_scheduled",
    };

    render(<BillingSettingsPanel data={scheduled} />);

    expect(screen.getByText("Cancellation scheduled")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel plan" })).toBeNull();
  });

  it("keeps terminal grace read-only without payment or reactivation controls", () => {
    const grace = settingsData(350);
    grace.subscription = {
      canCancel: false,
      canManageBilling: false,
      canSetUpPayment: false,
      description:
        "Your plan has ended. Your workspace remains available during the seven-day grace period.",
      label: "Grace period",
      status: "grace_period",
    };

    render(<BillingSettingsPanel data={grace} />);

    expect(
      screen.getByText(
        "Your plan has ended. Your workspace remains available during the seven-day grace period.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add payment method" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage billing" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel plan" })).toBeNull();
  });
});
