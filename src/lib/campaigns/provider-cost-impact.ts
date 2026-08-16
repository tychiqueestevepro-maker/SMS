import "server-only";

import { safeAdd, safeMultiply } from "@/lib/billing/integer";
import { estimateSmsSegments } from "@/lib/messaging/credits";
import {
  smsDestinationPrice,
  smsDestinationPriceRange,
} from "@/lib/messaging/destination-pricing";

import { renderCampaignTemplate } from "./templates";
import type {
  CampaignDestinationCostImpact,
  CampaignProviderCostImpact,
  CampaignRecipientCandidate,
  CampaignStepDraft,
} from "./types";

function renderedMessage(
  template: string,
  recipient: CampaignRecipientCandidate,
): string {
  try {
    return renderCampaignTemplate(template, recipient);
  } catch {
    return template;
  }
}

/** Internal provider estimate. Never serialize this object to customer UI. */
export function estimateCampaignProviderCost(input: Readonly<{
  recipients: readonly CampaignRecipientCandidate[];
  steps: readonly CampaignStepDraft[];
}>): CampaignProviderCostImpact {
  const groups = new Map<
    string,
    { recipientCount: number; totalSegments: number }
  >();

  input.recipients.forEach((recipient) => {
    const countryCode = recipient.countryCode.trim().toUpperCase() || "UNKNOWN";
    const recipientSegments = input.steps.reduce(
      (total, step) =>
        safeAdd(
          total,
          estimateSmsSegments(renderedMessage(step.body, recipient)).segments,
          "Recipient provider estimate segments",
        ),
      0,
    );
    const existing = groups.get(countryCode) ?? {
      recipientCount: 0,
      totalSegments: 0,
    };
    groups.set(countryCode, {
      recipientCount: existing.recipientCount + 1,
      totalSegments: safeAdd(
        existing.totalSegments,
        recipientSegments,
        "Destination provider estimate segments",
      ),
    });
  });

  const byDestination = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map<CampaignDestinationCostImpact>(([countryCode, group]) => {
      const price = smsDestinationPrice(countryCode);
      if (!price) {
        return {
          basePriceMicroUsdPerSegment: null,
          carrierFeeMaximumMicroUsdPerSegment: null,
          carrierFeeMinimumMicroUsdPerSegment: null,
          countryCode,
          countryName:
            countryCode === "UNKNOWN" ? "Unknown destination" : countryCode,
          estimatedProviderCostMaximumMicroUsd: 0,
          estimatedProviderCostMinimumMicroUsd: 0,
          pricingAvailable: false,
          recipientCount: group.recipientCount,
          totalSegments: group.totalSegments,
        };
      }
      const range = smsDestinationPriceRange(price);
      return {
        basePriceMicroUsdPerSegment: price.basePriceMicroUsdPerSegment,
        carrierFeeMaximumMicroUsdPerSegment:
          price.carrierFeeMaximumMicroUsdPerSegment,
        carrierFeeMinimumMicroUsdPerSegment:
          price.carrierFeeMinimumMicroUsdPerSegment,
        countryCode,
        countryName: price.countryName,
        estimatedProviderCostMaximumMicroUsd: safeMultiply(
          group.totalSegments,
          range.maximumMicroUsdPerSegment,
          "Maximum destination provider cost",
        ),
        estimatedProviderCostMinimumMicroUsd: safeMultiply(
          group.totalSegments,
          range.minimumMicroUsdPerSegment,
          "Minimum destination provider cost",
        ),
        pricingAvailable: true,
        recipientCount: group.recipientCount,
        totalSegments: group.totalSegments,
      };
    });

  return {
    byDestination,
    maximumMicroUsd: byDestination.reduce(
      (total, destination) =>
        safeAdd(
          total,
          destination.estimatedProviderCostMaximumMicroUsd,
          "Maximum provider campaign cost",
        ),
      0,
    ),
    minimumMicroUsd: byDestination.reduce(
      (total, destination) =>
        safeAdd(
          total,
          destination.estimatedProviderCostMinimumMicroUsd,
          "Minimum provider campaign cost",
        ),
      0,
    ),
    pricingComplete: byDestination.every(
      (destination) => destination.pricingAvailable,
    ),
  };
}
