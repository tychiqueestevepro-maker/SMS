import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  formatMicroUsdPerSegment,
  smsDestinationPrice,
  smsDestinationPriceRange,
} from "./destination-pricing";

describe("SMS destination pricing", () => {
  it.each([
    ["FR", 79_800, 79_800],
    ["US", 11_800, 13_300],
    ["CA", 14_700, 17_000],
  ] as const)(
    "returns the current provider range for %s",
    (countryCode, expectedMinimum, expectedMaximum) => {
      const price = smsDestinationPrice(countryCode);
      expect(price).not.toBeNull();
      expect(smsDestinationPriceRange(price!)).toEqual({
        maximumMicroUsdPerSegment: expectedMaximum,
        minimumMicroUsdPerSegment: expectedMinimum,
      });
    },
  );

  it("does not invent a rate for an unsupported destination", () => {
    expect(smsDestinationPrice("GB")).toBeNull();
  });

  it("shows four decimals for a per segment rate", () => {
    expect(formatMicroUsdPerSegment(79_800)).toBe("$0.0798");
  });
});
