import { estimateSmsCredits } from "../messaging/credits";
import { renderCampaignTemplate } from "./templates";
import type {
  CampaignLaunchAssessment,
  CampaignLaunchThresholds,
  CampaignRecipientCandidate,
  FirstStepCreditEstimate,
} from "./types";

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer.`);
  }
}

export function estimateFirstStepCredits(
  template: string,
  recipients: readonly CampaignRecipientCandidate[],
): FirstStepCreditEstimate {
  const estimates = recipients.map((recipient) => {
    const renderedMessage = renderCampaignTemplate(template, recipient);
    return {
      contactId: recipient.contactId,
      renderedMessage,
      // Each enrolled outbound has a one-credit minimum. Actual billing later
      // uses the provider-reported segment count.
      smsCredits: Math.max(1, estimateSmsCredits(renderedMessage)),
    };
  });

  return {
    totalSmsCredits: estimates.reduce(
      (total, estimate) => total + estimate.smsCredits,
      0,
    ),
    recipients: estimates,
  };
}

export interface AssessCampaignLaunchInput {
  firstStepTemplate: string;
  eligibleRecipients: readonly CampaignRecipientCandidate[];
  currentEffectiveUsageCredits: number;
  includedCredits: number;
  /** Loaded from the workspace billing plan; never duplicated in UI code. */
  thresholds: Readonly<CampaignLaunchThresholds>;
}

export function assessCampaignLaunch(
  input: AssessCampaignLaunchInput,
): CampaignLaunchAssessment {
  assertNonNegativeInteger(
    input.currentEffectiveUsageCredits,
    "Current effective usage",
  );
  assertNonNegativeInteger(input.includedCredits, "Included credits");
  const thresholds = input.thresholds;
  assertNonNegativeInteger(thresholds.recipientCount, "Recipient threshold");
  assertNonNegativeInteger(thresholds.overageCredits, "Overage threshold");

  const estimate = estimateFirstStepCredits(
    input.firstStepTemplate,
    input.eligibleRecipients,
  );
  const projectedUsageCredits =
    input.currentEffectiveUsageCredits + estimate.totalSmsCredits;
  const currentOverage = Math.max(
    0,
    input.currentEffectiveUsageCredits - input.includedCredits,
  );
  const projectedOverage = Math.max(
    0,
    projectedUsageCredits - input.includedCredits,
  );
  const estimatedNewOverageCredits = projectedOverage - currentOverage;
  const reasons: CampaignLaunchAssessment["reasons"] = [];

  if (input.eligibleRecipients.length >= thresholds.recipientCount) {
    reasons.push("large_volume");
  }
  if (
    estimatedNewOverageCredits >= thresholds.overageCredits &&
    estimatedNewOverageCredits > 0
  ) {
    reasons.push("possible_overage");
  }

  return {
    eligibleRecipientCount: input.eligibleRecipients.length,
    estimatedFirstStepCredits: estimate.totalSmsCredits,
    currentEffectiveUsageCredits: input.currentEffectiveUsageCredits,
    includedCredits: input.includedCredits,
    includedCreditsRemaining: Math.max(
      0,
      input.includedCredits - input.currentEffectiveUsageCredits,
    ),
    estimatedNewOverageCredits,
    projectedUsageCredits,
    requiresConfirmation: reasons.length > 0,
    reasons,
    unsupportedCountryCount: 0,
  };
}

/** Identifies the exact server assessment shown in the launch modal. */
export function campaignLaunchConfirmationKey(
  assessment: Readonly<CampaignLaunchAssessment>,
): string {
  const values = [
    assessment.eligibleRecipientCount,
    assessment.estimatedFirstStepCredits,
    assessment.currentEffectiveUsageCredits,
    assessment.includedCredits,
    assessment.includedCreditsRemaining,
    assessment.estimatedNewOverageCredits,
    assessment.projectedUsageCredits,
  ];
  values.forEach((value, index) =>
    assertNonNegativeInteger(value, `Launch assessment value ${index + 1}`),
  );

  return [
    "v1",
    ...values.map(String),
    [...assessment.reasons].sort().join(","),
  ].join(":");
}
