import type { BusinessVerificationField } from "@/lib/numbers/business";
import type { NumberClientDto, NumberSearchCandidateDto } from "@/lib/numbers/product-types";

export type NumberSettingsData = {
  canImportNumber: boolean;
  canConnectExistingNumber: boolean;
  canObtainIncludedNumber: boolean;
  importedNumberCount: number;
  existingNumberToConnect: string | null;
  importNumberUnavailableReason: "billing" | "configuration" | null;
  includedNumberCount: number;
  includedNumberUnavailableReason: "billing" | "limit" | null;
  maxPhoneNumbers: number;
  numbers: NumberClientDto[];
  remainingIncludedSlots: number;
  /** True when the user has no saved payment method yet and needs to enter card details during onboarding. */
  needsBillingSetup: boolean;
  /** Stripe publishable key — only present when needsBillingSetup is true. */
  billingPublishableKey: string | null;
};


export type NumberActionResult = {
  ok: boolean;
  message: string;
  code?: string;
  candidates?: NumberSearchCandidateDto[];
  countryCode?: string;
  eligibilityToken?: string;
  manualImport?: boolean;
  fieldErrors?: BusinessVerificationField[];
  phoneNumber?: string;
};
