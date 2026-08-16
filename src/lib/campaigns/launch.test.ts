import { describe, expect, it } from "vitest";

import {
  assessCampaignLaunch,
  campaignLaunchConfirmationKey,
  estimateFirstStepCredits,
} from "./launch";
import type { CampaignRecipientCandidate } from "./types";

function recipients(count: number): CampaignRecipientCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    contactId: `contact-${index}`,
    countryCode: "FR",
    firstName: "Ada",
    lastName: "Lovelace",
    company: "Analytical Engines",
    deletedAt: null,
    isSuppressed: false,
    hasActiveSequence: false,
  }));
}

describe("first-step SMS credit estimation", () => {
  it("renders each contact and counts multi-credit messages", () => {
    const [first, second] = recipients(2);
    first!.company = "A";
    second!.company = "🙂".repeat(40);

    const estimate = estimateFirstStepCredits("Hello from {{company}}", [
      first!,
      second!,
    ]);

    expect(estimate.recipients[0]?.smsCredits).toBe(1);
    expect(estimate.recipients[1]?.smsCredits).toBe(2);
    expect(estimate.totalSmsCredits).toBe(3);
  });
});

describe("large campaign launch assessment", () => {
  it("uses thresholds loaded from the centralized billing plan", () => {
    const assessment = assessCampaignLaunch({
      firstStepTemplate: "Hello",
      eligibleRecipients: recipients(1_000),
      currentEffectiveUsageCredits: 0,
      includedCredits: 2_000,
      thresholds: { recipientCount: 1_000, overageCredits: 1 },
    });

    expect(assessment.requiresConfirmation).toBe(true);
    expect(assessment.reasons).toEqual(["large_volume"]);
  });

  it("requires confirmation when the first step may create new overage", () => {
    const assessment = assessCampaignLaunch({
      firstStepTemplate: "Hello",
      eligibleRecipients: recipients(101),
      currentEffectiveUsageCredits: 1_900,
      includedCredits: 2_000,
      thresholds: { recipientCount: 1_000, overageCredits: 1 },
    });

    expect(assessment).toMatchObject({
      eligibleRecipientCount: 101,
      estimatedFirstStepCredits: 101,
      includedCreditsRemaining: 100,
      estimatedNewOverageCredits: 1,
      projectedUsageCredits: 2_001,
      requiresConfirmation: true,
      reasons: ["possible_overage"],
    });
  });

  it("does not add a limit and supports a centrally supplied threshold policy", () => {
    const assessment = assessCampaignLaunch({
      firstStepTemplate: "Hello",
      eligibleRecipients: recipients(5),
      currentEffectiveUsageCredits: 0,
      includedCredits: 2_000,
      thresholds: { recipientCount: 5, overageCredits: 100 },
    });

    expect(assessment.requiresConfirmation).toBe(true);
    expect(assessment.reasons).toEqual(["large_volume"]);
  });

  it("changes the confirmation key when the reviewed usage changes", () => {
    const original = assessCampaignLaunch({
      firstStepTemplate: "Hello",
      eligibleRecipients: recipients(1_000),
      currentEffectiveUsageCredits: 0,
      includedCredits: 2_000,
      thresholds: { recipientCount: 1_000, overageCredits: 1 },
    });
    const changed = assessCampaignLaunch({
      firstStepTemplate: "Hello",
      eligibleRecipients: recipients(1_000),
      currentEffectiveUsageCredits: 1,
      includedCredits: 2_000,
      thresholds: { recipientCount: 1_000, overageCredits: 1 },
    });

    expect(campaignLaunchConfirmationKey(original)).not.toBe(
      campaignLaunchConfirmationKey(changed),
    );
    expect(campaignLaunchConfirmationKey(original)).toBe(
      campaignLaunchConfirmationKey({ ...original }),
    );
  });
});
