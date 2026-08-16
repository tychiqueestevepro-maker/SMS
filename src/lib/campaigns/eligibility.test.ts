import { describe, expect, it } from "vitest";

import { evaluateRecipientEligibility } from "./eligibility";

describe("evaluateRecipientEligibility", () => {
  it("enrolls only unique active, non-suppressed contacts without a sequence", () => {
    const base = { firstName: "", lastName: "", company: "" };
    const result = evaluateRecipientEligibility([
      {
        ...base,
        contactId: "eligible",
        countryCode: "FR",
        deletedAt: null,
        isSuppressed: false,
        hasActiveSequence: false,
      },
      {
        ...base,
        contactId: "deleted",
        countryCode: "FR",
        deletedAt: "2026-08-01T00:00:00.000Z",
        isSuppressed: false,
        hasActiveSequence: false,
      },
      {
        ...base,
        contactId: "opted-out",
        countryCode: "FR",
        deletedAt: null,
        isSuppressed: true,
        hasActiveSequence: false,
      },
      {
        ...base,
        contactId: "in-sequence",
        countryCode: "FR",
        deletedAt: null,
        isSuppressed: false,
        hasActiveSequence: true,
      },
      {
        ...base,
        contactId: "eligible",
        countryCode: "FR",
        deletedAt: null,
        isSuppressed: false,
        hasActiveSequence: false,
      },
    ]);

    expect(result.eligible.map(({ contactId }) => contactId)).toEqual(["eligible"]);
    expect(result.counts).toEqual({
      selected: 5,
      eligible: 1,
      skipped: 4,
      duplicateSelection: 1,
      deleted: 1,
      optedOut: 1,
      activeSequence: 1,
      unsupportedCountry: 0,
    });
  });
});
