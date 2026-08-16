import { describe, expect, it } from "vitest";

import { estimateCampaignCostImpact } from "./cost-impact";

const recipients = [
  {
    company: "Atelier Rivoli",
    contactId: "contact-1",
    countryCode: "FR",
    deletedAt: null,
    firstName: "Camille",
    hasActiveSequence: false,
    isSuppressed: false,
    lastName: "Martin",
  },
  {
    company: "Studio Voltaire",
    contactId: "contact-2",
    countryCode: "US",
    deletedAt: null,
    firstName: "Alexandre",
    hasActiveSequence: false,
    isSuppressed: false,
    lastName: "Bernard",
  },
];

describe("campaign cost impact", () => {
  it("makes an eleven segment campaign impact visible before launch", () => {
    const campaignRecipients = Array.from({ length: 150 }, (_, index) => ({
      ...recipients[index % recipients.length]!,
      contactId: `contact-${index}`,
      countryCode: "FR",
    }));

    const impact = estimateCampaignCostImpact({
      currentEffectiveCredits: 0,
      includedCredits: 2_000,
      overagePriceMicroUsd: 40_000,
      recipients: campaignRecipients,
      steps: [{ body: "漢".repeat(702), waitDaysAfterPrevious: null }],
    });

    expect(impact).toMatchObject({
      firstStepCredits: 1_650,
      maximumSegmentsPerMessage: 11,
      maximumSequenceCredits: 1_650,
      projectedUsageCredits: 1_650,
      usesUnicode: true,
    });
  });

  it("projects the first send, the full sequence and new overage", () => {
    const impact = estimateCampaignCostImpact({
      currentEffectiveCredits: 1_998,
      includedCredits: 2_000,
      overagePriceMicroUsd: 40_000,
      recipients,
      steps: [
        { body: "Bonjour {{first_name}}", waitDaysAfterPrevious: null },
        { body: "Suite 🙂 ".repeat(6), waitDaysAfterPrevious: 2 },
      ],
    });

    expect(impact).toMatchObject({
      additionalChargeMicroUsd: 80_000,
      eligibleRecipients: 2,
      estimatedNewOverageCredits: 2,
      firstStepCredits: 2,
      maximumSequenceCredits: 4,
      maximumSegmentsPerMessage: 1,
      projectedUsageCredits: 2_002,
      usesUnicode: true,
    });
  });

  it("shows representative segment risk before contacts are selected", () => {
    const impact = estimateCampaignCostImpact({
      currentEffectiveCredits: 0,
      includedCredits: 2_000,
      overagePriceMicroUsd: 40_000,
      recipients: [],
      steps: [{ body: "🙂".repeat(36), waitDaysAfterPrevious: null }],
    });

    expect(impact).toMatchObject({
      eligibleRecipients: 0,
      firstStepCredits: 0,
      maximumSegmentsPerMessage: 2,
      maximumSequenceCredits: 0,
      usesUnicode: true,
    });
  });
});
