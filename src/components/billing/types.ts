import type { CustomerSmsUsageDto } from "@/lib/billing";

export type BillingPlanClientDto = {
  additionalCreditPriceMicroUsd: number;
  includedCredits: number;
  maxPhoneNumbers: number;
  monthlyPriceCents: number;
};

export type BillingSubscriptionClientDto = {
  canCancel: boolean;
  canManageBilling: boolean;
  canSetUpPayment: boolean;
  description: string;
  label: string;
  status:
    | "awaiting_number"
    | "setup_required"
    | "active"
    | "cancellation_scheduled"
    | "grace_period"
    | "attention_required"
    | "ended"
    | "unavailable";
};

export type BillingPaymentMethodClientDto = {
  label: string;
  status: "missing" | "saved" | "unavailable";
};

export type BillingSettingsData = {
  canActivateSubscriptionDirectly: boolean;
  directActivationAccount: boolean;
  paymentMethod: BillingPaymentMethodClientDto;
  plan: BillingPlanClientDto | null;
  subscription: BillingSubscriptionClientDto;
  usage: CustomerSmsUsageDto | null;
};

export type BillingActionFailure = {
  message: string;
  ok: false;
  code:
    | "BILLING_SESSION_UNAVAILABLE"
    | "BILLING_ACTIVATION_FAILED"
    | "BILLING_CANCELLATION_FAILED"
    | "PROMOTION_CODE_INVALID"
    | "AUTH_REQUIRED";
};

export type BillingSetupActionSuccess = {
  clientSecret: string;
  kind: "setup";
  ok: true;
  publishableKey: string;
};

export type BillingPortalActionSuccess = {
  kind: "portal";
  ok: true;
  redirectUrl: string;
};

export type BillingCancellationActionSuccess = {
  alreadyScheduled: boolean;
  kind: "cancellation";
  message: string;
  ok: true;
};

export type BillingActivationActionSuccess = {
  kind: "activation";
  message: string;
  ok: true;
};

export type BillingSetupActionResult = BillingActionFailure | BillingSetupActionSuccess;
export type BillingPortalActionResult = BillingActionFailure | BillingPortalActionSuccess;
export type BillingCancellationActionResult =
  | BillingActionFailure
  | BillingCancellationActionSuccess;
export type BillingActivationActionResult =
  | BillingActionFailure
  | BillingActivationActionSuccess;
export type BillingActionResult =
  | BillingSetupActionResult
  | BillingPortalActionResult
  | BillingCancellationActionResult
  | BillingActivationActionResult;
