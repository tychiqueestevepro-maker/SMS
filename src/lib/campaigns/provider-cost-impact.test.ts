import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { estimateCampaignProviderCost } from "./provider-cost-impact";

const recipient = {
  company: "Atelier Rivoli",
  deletedAt: null,
  firstName: "Camille",
  hasActiveSequence: false,
  isSuppressed: false,
  lastName: "Martin",
};

describe("internal campaign provider cost", () => {
  it("estimates the historical French campaign without exposing billing logic", () => {
    const impact = estimateCampaignProviderCost({
      recipients: Array.from({ length: 150 }, (_, index) => ({
        ...recipient,
        contactId: `contact-${index}`,
        countryCode: "FR",
      })),
      steps: [{ body: "漢".repeat(702), waitDaysAfterPrevious: null }],
    });

    expect(impact).toMatchObject({
      maximumMicroUsd: 131_670_000,
      minimumMicroUsd: 131_670_000,
      pricingComplete: true,
    });
    expect(impact.byDestination).toEqual([
      expect.objectContaining({
        countryCode: "FR",
        recipientCount: 150,
        totalSegments: 1_650,
      }),
    ]);
  });

  it("keeps US carrier uncertainty in the internal estimate", () => {
    const impact = estimateCampaignProviderCost({
      recipients: [{
        ...recipient,
        contactId: "contact-us",
        countryCode: "US",
      }],
      steps: [
        { body: "First message", waitDaysAfterPrevious: null },
        { body: "Second message", waitDaysAfterPrevious: 2 },
      ],
    });

    expect(impact).toMatchObject({
      maximumMicroUsd: 26_600,
      minimumMicroUsd: 23_600,
      pricingComplete: true,
    });
  });
});
