import { describe, expect, it } from "vitest";

import { normalizePhoneNumber } from "./phone";

describe("normalizePhoneNumber", () => {
  it.each([
    ["5125550192", "+15125550192"],
    ["1 512 555 0192", "+15125550192"],
    ["+1 (512) 555-0192", "+15125550192"],
    ["212.555.0100", "+12125550100"],
  ])("normalizes %s to US E.164", (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it.each([
    "",
    "+442071838750",
    "512555019",
    "151255501922",
    "1125550192",
    "5121550192",
    "5125550192 ext 3",
  ])("rejects invalid input %s", (input) => {
    expect(normalizePhoneNumber(input)).toBeNull();
  });

  it.each([
    ["0612345678", "+33612345678"],
    ["07 12 34 56 78", "+33712345678"],
    ["+33 6 12 34 56 78", "+33612345678"],
    ["+33123456789", "+33123456789"],
  ])("normalizes %s to France E.164", (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it.each([
    "0812345678", // Premium
    "+33812345678", // Premium
    "08 12 34 56 78", // Premium
    "+33 8 12 34 56 78", // Premium
    "+33 0 12 34 56 78", // Invalid format (often people write +33 (0) ...)
  ])("rejects premium or invalid French input %s", (input) => {
    expect(normalizePhoneNumber(input)).toBeNull();
  });
});
