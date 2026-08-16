import { safeMultiply } from "@/lib/billing/integer";
import { estimateSmsSegments, type SmsEncoding } from "@/lib/messaging/credits";

import { renderCampaignTemplate } from "./templates";
import type {
  CampaignRecipientCandidate,
  CampaignStepDraft,
  CampaignTemplateValues,
} from "./types";

const SAMPLE_RECIPIENT: CampaignTemplateValues = {
  company: "Atelier Rivoli",
  firstName: "Camille",
  lastName: "Martin",
};

export type CampaignStepCostImpact = Readonly<{
  encoding: SmsEncoding;
  maximumSegmentsPerRecipient: number;
  minimumSegmentsPerRecipient: number;
  stepIndex: number;
  totalCredits: number;
}>;

export type CampaignCostImpact = Readonly<{
  additionalChargeMicroUsd: number;
  currentEffectiveCredits: number;
  eligibleRecipients: number;
  estimatedNewOverageCredits: number;
  firstStepCredits: number;
  includedCredits: number;
  includedCreditsRemaining: number;
  maximumSequenceCredits: number;
  maximumSegmentsPerMessage: number;
  projectedUsageCredits: number;
  steps: readonly CampaignStepCostImpact[];
  usesUnicode: boolean;
}>;

export type CampaignCostImpactInput = Readonly<{
  currentEffectiveCredits: number;
  includedCredits: number;
  overagePriceMicroUsd: number;
  recipients: readonly CampaignRecipientCandidate[];
  steps: readonly CampaignStepDraft[];
}>;

function nonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non negative safe integer.`);
  }
}

function renderedMessage(
  template: string,
  recipient: CampaignTemplateValues,
): string {
  try {
    return renderCampaignTemplate(template, recipient);
  } catch {
    return template;
  }
}

export function estimateCampaignCostImpact(
  input: CampaignCostImpactInput,
): CampaignCostImpact {
  nonNegativeSafeInteger(input.currentEffectiveCredits, "Current credits");
  nonNegativeSafeInteger(input.includedCredits, "Included credits");
  nonNegativeSafeInteger(input.overagePriceMicroUsd, "Overage price");

  const previews: readonly CampaignTemplateValues[] =
    input.recipients.length > 0 ? input.recipients : [SAMPLE_RECIPIENT];
  const stepImpacts = input.steps.map((step, stepIndex) => {
    const estimates = previews.map((recipient) =>
      estimateSmsSegments(renderedMessage(step.body, recipient)),
    );
    const segments = estimates.map((estimate) => estimate.segments);
    const totalCredits =
      input.recipients.length === 0
        ? 0
        : segments.reduce((total, value) => total + value, 0);

    return {
      encoding: estimates.some((estimate) => estimate.encoding === "unicode")
        ? "unicode" as const
        : "gsm-7" as const,
      maximumSegmentsPerRecipient: Math.max(0, ...segments),
      minimumSegmentsPerRecipient: Math.min(...segments),
      stepIndex,
      totalCredits,
    };
  });
  const maximumSequenceCredits = stepImpacts.reduce(
    (total, step) => total + step.totalCredits,
    0,
  );
  const projectedUsageCredits =
    input.currentEffectiveCredits + maximumSequenceCredits;
  const currentOverageCredits = Math.max(
    0,
    input.currentEffectiveCredits - input.includedCredits,
  );
  const projectedOverageCredits = Math.max(
    0,
    projectedUsageCredits - input.includedCredits,
  );
  const estimatedNewOverageCredits =
    projectedOverageCredits - currentOverageCredits;
  return {
    additionalChargeMicroUsd: safeMultiply(
      estimatedNewOverageCredits,
      input.overagePriceMicroUsd,
      "Estimated additional campaign charge",
    ),
    currentEffectiveCredits: input.currentEffectiveCredits,
    eligibleRecipients: input.recipients.length,
    estimatedNewOverageCredits,
    firstStepCredits: stepImpacts[0]?.totalCredits ?? 0,
    includedCredits: input.includedCredits,
    includedCreditsRemaining: Math.max(
      0,
      input.includedCredits - input.currentEffectiveCredits,
    ),
    maximumSequenceCredits,
    maximumSegmentsPerMessage: Math.max(
      0,
      ...stepImpacts.map((step) => step.maximumSegmentsPerRecipient),
    ),
    projectedUsageCredits,
    steps: stepImpacts,
    usesUnicode: stepImpacts.some((step) => step.encoding === "unicode"),
  };
}
