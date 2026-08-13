import "server-only";

import type {
  BillingPaymentMethodClientDto,
  BillingPlanClientDto,
  BillingSettingsData,
  BillingSubscriptionClientDto,
} from "@/components/billing/types";
import {
  formatMicroUsd,
  toCustomerSmsUsageDto,
  type BillingPeriodSnapshot,
  type CustomerSmsUsageDto,
} from "@/lib/billing";
import { isConfiguredExistingNumberOwner } from "@/lib/numbers/configured-existing-number.server";
import { createClient } from "@/lib/supabase/server";

type BillingUsageSummary = {
  actual_credits: unknown;
  additional_credits: unknown;
  additional_credit_price_micro_usd: unknown;
  additional_usage_amount_micro_usd: unknown;
  can_open_portal?: unknown;
  can_cancel_subscription?: unknown;
  can_setup_payment?: unknown;
  canOpenPortal?: unknown;
  canCancelSubscription?: unknown;
  canSetupPayment?: unknown;
  effective_credits?: unknown;
  effectiveCredits?: unknown;
  included_credits: unknown;
  max_phone_numbers: unknown;
  messaging_enabled?: unknown;
  monthly_price_cents: unknown;
  payment_method_status: unknown;
  reserved_credits?: unknown;
  reservedCredits?: unknown;
  safety_cap_reached?: unknown;
  safetyCapReached?: unknown;
  safety_cap_credits: unknown;
  subscription_status: unknown;
};

function explicitTrue(value: unknown): boolean {
  return value === true;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function safeInteger(value: unknown): number | null {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : null;
}

function firstSummary(value: unknown): BillingUsageSummary | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object"
    ? (candidate as BillingUsageSummary)
    : null;
}

function currentPlan(
  summary: BillingUsageSummary | null,
): BillingPlanClientDto | null {
  const monthlyPriceCents = safeInteger(summary?.monthly_price_cents);
  const includedCredits = safeInteger(summary?.included_credits);
  const additionalCreditPriceMicroUsd = safeInteger(
    summary?.additional_credit_price_micro_usd,
  );
  const maxPhoneNumbers = safeInteger(summary?.max_phone_numbers);

  if (
    monthlyPriceCents === null ||
    includedCredits === null ||
    additionalCreditPriceMicroUsd === null ||
    maxPhoneNumbers === null
  ) {
    return null;
  }

  return {
    additionalCreditPriceMicroUsd,
    includedCredits,
    maxPhoneNumbers,
    monthlyPriceCents,
  };
}

function usageView(
  summary: BillingUsageSummary | null,
  plan: BillingPlanClientDto | null,
): CustomerSmsUsageDto | null {
  const usedCredits = safeInteger(summary?.actual_credits);
  const safetyCapCredits = safeInteger(summary?.safety_cap_credits);
  if (!summary || !plan || usedCredits === null || safetyCapCredits === null) return null;

  const snapshot: BillingPeriodSnapshot = {
    endsAt: "9999-12-31T23:59:59.999Z",
    id: "customer-summary",
    plan: {
      includedSegments: plan.includedCredits,
      maxPhoneNumbers: plan.maxPhoneNumbers,
      monthlyPriceCents: plan.monthlyPriceCents,
      overagePriceMicroUsd: plan.additionalCreditPriceMicroUsd,
      planId: "customer-summary",
      planVersion: 1,
      safetyCapSegments: safetyCapCredits,
    },
    startsAt: "1970-01-01T00:00:00.000Z",
    workspaceId: "customer-summary",
  };
  const usage = toCustomerSmsUsageDto(snapshot, usedCredits);
  const additionalCredits = safeInteger(summary.additional_credits);
  const additionalUsageAmountMicroUsd = safeInteger(
    summary.additional_usage_amount_micro_usd,
  );
  const authoritativeSafetyCapReached = optionalBoolean(
    summary.safety_cap_reached ?? summary.safetyCapReached,
  );
  const effectiveCredits =
    safeInteger(summary.effective_credits ?? summary.effectiveCredits) ??
    (() => {
      const reservedCredits = safeInteger(
        summary.reserved_credits ?? summary.reservedCredits,
      );
      if (reservedCredits === null) return null;
      const total = usedCredits + reservedCredits;
      return Number.isSafeInteger(total) ? total : null;
    })();
  const safetyCapReached =
    authoritativeSafetyCapReached ??
    (effectiveCredits === null
      ? usage.safetyCapReached
      : effectiveCredits >= safetyCapCredits);

  if (additionalCredits === null || additionalUsageAmountMicroUsd === null) {
    return { ...usage, safetyCapReached };
  }

  return {
    ...usage,
    additionalCredits,
    additionalCreditsText:
      additionalCredits > 0
        ? `${additionalCredits.toLocaleString("en-US")} additional credits`
        : null,
    additionalUsageAmountMicroUsd,
    additionalUsageText:
      additionalCredits > 0
        ? `Additional usage: ${formatMicroUsd(additionalUsageAmountMicroUsd)}`
        : null,
    primaryText:
      additionalCredits > 0
        ? `${usedCredits.toLocaleString("en-US")} SMS credits used`
        : `${usedCredits.toLocaleString("en-US")} / ${plan.includedCredits.toLocaleString("en-US")} SMS credits used`,
    safetyCapReached,
  };
}

function paymentMethodView(status: unknown): BillingPaymentMethodClientDto {
  if (status === "saved" || status === "ready" || status === "attached") {
    return { label: "Payment method saved", status: "saved" };
  }
  if (status === "missing" || status === "required") {
    return { label: "No payment method added", status: "missing" };
  }
  return { label: "Payment details unavailable", status: "unavailable" };
}

function subscriptionView(
  status: unknown,
  hasReadyNumber: boolean,
  paymentMethod: BillingPaymentMethodClientDto,
  capabilities: {
    canCancel: boolean;
    canManageBilling: boolean;
    canSetUpPayment: boolean;
  },
  messagingEnabled: boolean,
): BillingSubscriptionClientDto {
  if (
    (status === "active" ||
      status === "cancellation_scheduled" ||
      status === "cancel_at_period_end") &&
    !messagingEnabled
  ) {
    return {
      ...capabilities,
      canCancel: status === "active" && capabilities.canCancel,
      description:
        "Messaging is currently unavailable. Review your billing details or contact Riink support.",
      label: "Messaging unavailable",
      status: "attention_required",
    };
  }
  if (status === "active") {
    return {
      ...capabilities,
      description: "Your Riink monthly plan is active.",
      label: "Active",
      status: "active",
    };
  }
  if (status === "grace" || status === "grace_period") {
    return {
      ...capabilities,
      canCancel: false,
      canManageBilling: false,
      canSetUpPayment: false,
      description:
        "Your plan has ended. Your workspace remains available during the seven-day grace period.",
      label: "Grace period",
      status: "grace_period",
    };
  }
  if (status === "cancellation_scheduled" || status === "cancel_at_period_end") {
    return {
      ...capabilities,
      canCancel: false,
      description:
        "Your plan will end after the current billing period, followed by a seven-day grace period.",
      label: "Cancellation scheduled",
      status: "cancellation_scheduled",
    };
  }
  if (status === "past_due" || status === "unpaid") {
    return {
      ...capabilities,
      description: "Your payment needs attention. Update your payment method to keep messaging available.",
      label: "Payment needed",
      status: "attention_required",
    };
  }
  if (status === "canceled" || status === "ended") {
    return {
      ...capabilities,
      canCancel: false,
      canManageBilling: false,
      canSetUpPayment: false,
      description: "Your Riink monthly plan has ended.",
      label: "Ended",
      status: "ended",
    };
  }
  if (status === "setup_required" && paymentMethod.status === "saved") {
    return hasReadyNumber
      ? {
          ...capabilities,
          canCancel: false,
          description: "Your phone number is ready. Start your Riink monthly plan when you are ready.",
          label: "Ready to start",
          status: "setup_required",
        }
      : {
          ...capabilities,
          canCancel: false,
          description: "Billing starts when your phone number is ready.",
          label: "Not started",
          status: "awaiting_number",
        };
  }
  if (
    status === "setup_required" ||
    status === "incomplete" ||
    (hasReadyNumber && paymentMethod.status === "missing")
  ) {
    return {
      ...capabilities,
      canCancel: false,
      description: "Add a payment method to finish setting up your Riink plan.",
      label: "Setup needed",
      status: "setup_required",
    };
  }
  if (status === "not_started" || status === "awaiting_number" || !hasReadyNumber) {
    return {
      ...capabilities,
      canCancel: false,
      description: "Billing starts when your phone number is ready.",
      label: "Not started",
      status: "awaiting_number",
    };
  }
  return {
    ...capabilities,
    canCancel: false,
    description: "Billing details are temporarily unavailable.",
    label: "Unavailable",
    status: "unavailable",
  };
}

export async function loadBillingSettingsData(): Promise<BillingSettingsData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const paymentMethod = paymentMethodView(null);
    return {
      canActivateSubscriptionDirectly: false,
      directActivationAccount: false,
      paymentMethod,
      plan: null,
      subscription: subscriptionView(null, false, paymentMethod, {
        canCancel: false,
        canManageBilling: false,
        canSetUpPayment: false,
      }, false),
      usage: null,
    };
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!workspace) {
    const paymentMethod = paymentMethodView(null);
    return {
      canActivateSubscriptionDirectly: false,
      directActivationAccount: false,
      paymentMethod,
      plan: null,
      subscription: subscriptionView(null, false, paymentMethod, {
        canCancel: false,
        canManageBilling: false,
        canSetUpPayment: false,
      }, false),
      usage: null,
    };
  }

  const [{ data: summaryData, error: summaryError }, { count: readyCount }] =
    await Promise.all([
      supabase.rpc("get_billing_usage_summary"),
      supabase
        .from("phone_numbers")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .eq("status", "ready")
        .is("deleted_at", null),
    ]);

  const summary = summaryError ? null : firstSummary(summaryData);
  const plan = currentPlan(summary);
  const paymentMethod = paymentMethodView(summary?.payment_method_status);
  const directActivationAccount = isConfiguredExistingNumberOwner({
    email: user.email ?? null,
    userId: user.id,
  });
  const canActivateSubscriptionDirectly =
    directActivationAccount &&
    (readyCount ?? 0) > 0 &&
    paymentMethod.status === "saved" &&
    (summary?.subscription_status === "not_started" ||
      summary?.subscription_status === "setup_required" ||
      summary?.subscription_status === "awaiting_number");
  const capabilities = {
    canCancel: explicitTrue(
      summary?.can_cancel_subscription ?? summary?.canCancelSubscription,
    ),
    canManageBilling: explicitTrue(summary?.can_open_portal ?? summary?.canOpenPortal),
    canSetUpPayment: explicitTrue(
      summary?.can_setup_payment ?? summary?.canSetupPayment,
    ),
  };

  return {
    canActivateSubscriptionDirectly,
    directActivationAccount,
    paymentMethod,
    plan,
    subscription: subscriptionView(
      summary?.subscription_status,
      (readyCount ?? 0) > 0,
      paymentMethod,
      capabilities,
      explicitTrue(summary?.messaging_enabled),
    ),
    usage: usageView(summary, plan),
  };
}
