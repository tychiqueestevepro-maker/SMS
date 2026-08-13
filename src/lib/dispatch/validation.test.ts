import { describe, expect, it } from "vitest";

import { validFinalSnapshot } from "./test-fixtures";
import type { FinalDispatchValidationSnapshot } from "./types";
import { finalValidationFailure } from "./validation";

describe("immediate final dispatch validation", () => {
  it.each([
    ["campaignActive", false, "campaign_inactive"],
    ["recipientActive", false, "recipient_inactive"],
    ["contactActive", false, "contact_inactive"],
    ["suppressed", true, "suppressed"],
    ["workspaceAuthorized", false, "workspace_unauthorized"],
    ["phoneNumberReady", false, "phone_number_not_ready"],
    ["reservationValid", false, "reservation_invalid"],
  ] as const)("rejects when %s is %s", (field, value, reason) => {
    expect(
      finalValidationFailure(
        validFinalSnapshot({
          [field]: value,
        } as Partial<FinalDispatchValidationSnapshot>),
      ),
    ).toBe(reason);
  });

  it("allows the current reservation to bring effective usage exactly to 10,000", () => {
    expect(
      finalValidationFailure(
        validFinalSnapshot({
          actualOutboundSegments: 9_999,
          reservedOutboundSegments: 1,
          safetyCapSegments: 10_000,
        }),
      ),
    ).toBeNull();
  });

  it("blocks when reconciliation makes effective usage exceed 10,000", () => {
    expect(
      finalValidationFailure(
        validFinalSnapshot({
          actualOutboundSegments: 9_999,
          reservedOutboundSegments: 2,
          safetyCapSegments: 10_000,
        }),
      ),
    ).toBe("safety_cap_reached");
  });
});

