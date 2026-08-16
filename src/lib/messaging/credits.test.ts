import { describe, expect, it } from "vitest";

import { estimateSmsCredits, estimateSmsSegments } from "./credits";

describe("SMS segment estimation", () => {
  it("counts GSM messages using concatenated segment limits", () => {
    expect(estimateSmsSegments("a".repeat(160))).toEqual({
      encoding: "gsm-7",
      segments: 1,
      units: 160,
    });
    expect(estimateSmsCredits("a".repeat(161))).toBe(2);
  });

  it("detects Unicode and counts UTF-16 units like the provider", () => {
    expect(estimateSmsSegments("🙂".repeat(36))).toEqual({
      encoding: "unicode",
      segments: 2,
      units: 72,
    });
  });

  it("returns an empty estimate without inventing one segment", () => {
    expect(estimateSmsSegments("")).toEqual({
      encoding: "gsm-7",
      segments: 0,
      units: 0,
    });
  });
});
