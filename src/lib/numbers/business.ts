import { normalizePhoneNumber } from "../contacts/phone";

export const BUSINESS_VERIFICATION_TITLE = "Business verification";
export const BUSINESS_VERIFICATION_DESCRIPTION =
  "We need a few details to activate your number.";

export interface BusinessAddressInput {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
}

export interface BusinessVerificationInput {
  legalBusinessName: string;
  ein: string;
  businessAddress: BusinessAddressInput;
  website: string;
  contactName: string;
  email: string;
  phone: string;
  messagingUseCase: string;
  optInMethod: string;
  privacyPolicy: string;
  terms: string;
  sampleMessages: readonly string[];
}

export interface NormalizedBusinessVerification {
  legalBusinessName: string;
  ein: string;
  businessAddress: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    postalCode: string;
    country: "US";
  };
  website: string;
  contactName: string;
  email: string;
  phoneE164: string;
  messagingUseCase: string;
  optInMethod: string;
  privacyPolicy: string;
  terms: string;
  sampleMessages: string[];
}

export type BusinessVerificationField =
  | "legalBusinessName"
  | "ein"
  | "businessAddress.line1"
  | "businessAddress.line2"
  | "businessAddress.city"
  | "businessAddress.state"
  | "businessAddress.postalCode"
  | "website"
  | "contactName"
  | "email"
  | "phone"
  | "messagingUseCase"
  | "optInMethod"
  | "privacyPolicy"
  | "terms"
  | "sampleMessages";

export interface BusinessVerificationIssue {
  field: BusinessVerificationField;
  code: "required" | "invalid";
}

export type BusinessVerificationValidation =
  | {
      valid: true;
      issues: [];
      value: NormalizedBusinessVerification;
    }
  | {
      valid: false;
      issues: BusinessVerificationIssue[];
      value: null;
    };

const US_STATE_CODES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
]);

const MAX_LENGTHS: Readonly<Record<BusinessVerificationField, number>> = {
  legalBusinessName: 200,
  ein: 20,
  "businessAddress.line1": 200,
  "businessAddress.line2": 200,
  "businessAddress.city": 100,
  "businessAddress.state": 20,
  "businessAddress.postalCode": 20,
  website: 2_048,
  contactName: 150,
  email: 320,
  phone: 50,
  messagingUseCase: 2_000,
  optInMethod: 2_000,
  privacyPolicy: 2_048,
  terms: 2_048,
  sampleMessages: 1_000,
};

const MAX_SAMPLE_MESSAGES = 3;

function validWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function required(
  issues: BusinessVerificationIssue[],
  field: BusinessVerificationField,
  value: string,
): void {
  if (!value.trim()) issues.push({ field, code: "required" });
}

export function validateBusinessVerification(
  input: BusinessVerificationInput,
): BusinessVerificationValidation {
  const issues: BusinessVerificationIssue[] = [];
  const state = input.businessAddress.state.trim().toUpperCase();
  const einDigits = input.ein.replace(/\D/g, "");
  const phoneE164 = normalizePhoneNumber(input.phone);
  const sampleMessages = input.sampleMessages.map((message) => message.trim()).filter(Boolean);

  required(issues, "legalBusinessName", input.legalBusinessName);
  required(issues, "ein", input.ein);
  required(issues, "businessAddress.line1", input.businessAddress.line1);
  required(issues, "businessAddress.city", input.businessAddress.city);
  required(issues, "businessAddress.state", input.businessAddress.state);
  required(issues, "businessAddress.postalCode", input.businessAddress.postalCode);
  required(issues, "website", input.website);
  required(issues, "contactName", input.contactName);
  required(issues, "email", input.email);
  required(issues, "phone", input.phone);
  required(issues, "messagingUseCase", input.messagingUseCase);
  required(issues, "optInMethod", input.optInMethod);
  required(issues, "privacyPolicy", input.privacyPolicy);
  required(issues, "terms", input.terms);
  if (sampleMessages.length === 0) {
    issues.push({ field: "sampleMessages", code: "required" });
  }

  const boundedValues: Array<[BusinessVerificationField, string]> = [
    ["legalBusinessName", input.legalBusinessName],
    ["ein", input.ein],
    ["businessAddress.line1", input.businessAddress.line1],
    ["businessAddress.line2", input.businessAddress.line2 ?? ""],
    ["businessAddress.city", input.businessAddress.city],
    ["businessAddress.state", input.businessAddress.state],
    ["businessAddress.postalCode", input.businessAddress.postalCode],
    ["website", input.website],
    ["contactName", input.contactName],
    ["email", input.email],
    ["phone", input.phone],
    ["messagingUseCase", input.messagingUseCase],
    ["optInMethod", input.optInMethod],
    ["privacyPolicy", input.privacyPolicy],
    ["terms", input.terms],
  ];
  for (const [field, value] of boundedValues) {
    if (value.length > MAX_LENGTHS[field]) {
      issues.push({ field, code: "invalid" });
    }
  }
  if (
    input.sampleMessages.length > MAX_SAMPLE_MESSAGES ||
    input.sampleMessages.some(
      (message) => message.length > MAX_LENGTHS.sampleMessages,
    )
  ) {
    issues.push({ field: "sampleMessages", code: "invalid" });
  }

  if (input.ein.trim() && !/^\d{2}-?\d{7}$/.test(input.ein.trim())) {
    issues.push({ field: "ein", code: "invalid" });
  }
  if (input.businessAddress.state.trim() && !US_STATE_CODES.has(state)) {
    issues.push({ field: "businessAddress.state", code: "invalid" });
  }
  if (
    input.businessAddress.postalCode.trim() &&
    !/^\d{5}(?:-\d{4})?$/.test(input.businessAddress.postalCode.trim())
  ) {
    issues.push({ field: "businessAddress.postalCode", code: "invalid" });
  }
  if (
    input.website.length <= MAX_LENGTHS.website &&
    input.website.trim() &&
    !validWebUrl(input.website.trim())
  ) {
    issues.push({ field: "website", code: "invalid" });
  }
  if (
    input.email.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())
  ) {
    issues.push({ field: "email", code: "invalid" });
  }
  if (input.phone.trim() && !phoneE164) {
    issues.push({ field: "phone", code: "invalid" });
  }
  if (
    input.privacyPolicy.length <= MAX_LENGTHS.privacyPolicy &&
    input.privacyPolicy.trim() &&
    !validWebUrl(input.privacyPolicy.trim())
  ) {
    issues.push({ field: "privacyPolicy", code: "invalid" });
  }
  if (
    input.terms.length <= MAX_LENGTHS.terms &&
    input.terms.trim() &&
    !validWebUrl(input.terms.trim())
  ) {
    issues.push({ field: "terms", code: "invalid" });
  }

  if (issues.length > 0 || !phoneE164) {
    return { valid: false, issues, value: null };
  }

  return {
    valid: true,
    issues: [],
    value: {
      legalBusinessName: input.legalBusinessName.trim(),
      ein: `${einDigits.slice(0, 2)}-${einDigits.slice(2)}`,
      businessAddress: {
        line1: input.businessAddress.line1.trim(),
        line2: input.businessAddress.line2?.trim() ?? "",
        city: input.businessAddress.city.trim(),
        state,
        postalCode: input.businessAddress.postalCode.trim(),
        country: "US",
      },
      website: input.website.trim(),
      contactName: input.contactName.trim(),
      email: input.email.trim().toLowerCase(),
      phoneE164,
      messagingUseCase: input.messagingUseCase.trim(),
      optInMethod: input.optInMethod.trim(),
      privacyPolicy: input.privacyPolicy.trim(),
      terms: input.terms.trim(),
      sampleMessages,
    },
  };
}
