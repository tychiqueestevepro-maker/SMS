import { assertNonNegativeSafeInteger, formatMicroUsd, safeMultiply } from "./integer";
import type {
  BillingPeriodSnapshot,
  CustomerSmsUsageDto,
  SmsUsageWarning,
} from "./types";

export const SMS_CREDIT_HELPER_TEXT =
  "Message length and special characters can cause a single message to use more than one SMS credit.";

const WARNING_LEVELS = [
  { percent: 100, level: "100" as const },
  { percent: 90, level: "90" as const },
  { percent: 75, level: "75" as const },
];

function thresholdAtPercent(includedCredits: number, percent: number): number {
  const product = safeMultiply(
    includedCredits,
    percent,
    "Usage warning threshold",
  );
  return Math.floor((product + 99) / 100);
}

export function getSmsUsageWarning(
  usedCredits: number,
  includedCredits: number,
): SmsUsageWarning | null {
  assertNonNegativeSafeInteger(usedCredits, "Used credits");
  assertNonNegativeSafeInteger(includedCredits, "Included credits");
  if (usedCredits === 0) return null;
  if (includedCredits === 0) {
    return {
      level: "100",
      text: "You've used your included SMS credits.",
    };
  }

  for (const warning of WARNING_LEVELS) {
    if (usedCredits >= thresholdAtPercent(includedCredits, warning.percent)) {
      return {
        level: warning.level,
        text:
          warning.level === "100"
            ? "You've used your included SMS credits."
            : `You've used ${warning.level}% of your included SMS credits.`,
      };
    }
  }
  return null;
}

export function toCustomerSmsUsageDto(
  period: BillingPeriodSnapshot,
  actualOutboundSegments: number,
): CustomerSmsUsageDto {
  assertNonNegativeSafeInteger(
    actualOutboundSegments,
    "Actual outbound segments",
  );
  const includedCredits = period.plan.includedSegments;
  const additionalCredits = Math.max(
    0,
    actualOutboundSegments - includedCredits,
  );
  const additionalUsageAmountMicroUsd = safeMultiply(
    additionalCredits,
    period.plan.overagePriceMicroUsd,
    "Additional usage amount",
  );
  const number = (value: number) => value.toLocaleString("en-US");

  return {
    title: "SMS usage",
    usedCredits: actualOutboundSegments,
    includedCredits,
    additionalCredits,
    additionalUsageAmountMicroUsd,
    primaryText:
      additionalCredits === 0
        ? `${number(actualOutboundSegments)} / ${number(includedCredits)} SMS credits used`
        : `${number(actualOutboundSegments)} SMS credits used`,
    additionalCreditsText:
      additionalCredits === 0
        ? null
        : `${number(additionalCredits)} additional credits`,
    additionalUsageText:
      additionalCredits === 0
        ? null
        : `Additional usage: ${formatMicroUsd(additionalUsageAmountMicroUsd)}`,
    helperText: SMS_CREDIT_HELPER_TEXT,
    warning: getSmsUsageWarning(actualOutboundSegments, includedCredits),
    safetyCapCredits: period.plan.safetyCapSegments,
    safetyCapReached:
      actualOutboundSegments >= period.plan.safetyCapSegments,
  };
}
