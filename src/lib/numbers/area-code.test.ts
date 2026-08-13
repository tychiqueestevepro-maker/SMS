import { describe, expect, it } from "vitest";

import {
  areaCodeFromUsE164,
  assertUsAreaCode,
  normalizeUsAreaCode,
} from "./area-code";

describe("US area-code choice", () => {
  it.each(["202", "512", "919"])("accepts %s", (areaCode) => {
    expect(normalizeUsAreaCode(areaCode)).toBe(areaCode);
  });

  it.each(["", "12", "012", "1A2", "5125"])("rejects %s", (areaCode) => {
    expect(normalizeUsAreaCode(areaCode)).toBeNull();
  });

  it("returns a safe product error and extracts an area code from US E.164", () => {
    expect(() => assertUsAreaCode("12")).toThrow(
      "Enter a valid three digit area code.",
    );
    expect(areaCodeFromUsE164("+15125550192")).toBe("512");
    expect(areaCodeFromUsE164("+442071838750")).toBeNull();
  });
});
