import { describe, expect, it } from "vitest";

import { getSmsUsageWarning, toCustomerSmsUsageDto } from "./customer";
import { billingPeriod } from "./test-fixtures";

describe("customer SMS-credit usage", () => {
  it.each([
    [1_499, null],
    [1_500, "75"],
    [1_799, "75"],
    [1_800, "90"],
    [1_999, "90"],
    [2_000, "100"],
    [2_450, "100"],
  ] as const)("maps %i used credits to warning %s", (used, level) => {
    expect(getSmsUsageWarning(used, 2_000)?.level ?? null).toBe(level);
  });

  it("renders included usage in simple customer language", () => {
    const dto = toCustomerSmsUsageDto(billingPeriod(), 1_247);
    expect(dto).toMatchObject({
      title: "SMS usage",
      usedCredits: 1_247,
      includedCredits: 2_000,
      additionalCredits: 0,
      primaryText: "1,247 / 2,000 SMS credits used",
      additionalCreditsText: null,
      additionalUsageText: null,
    });
    expect(dto.helperText).toContain("more than one SMS credit");
  });

  it("renders 450 additional credits as exactly $18.00", () => {
    expect(toCustomerSmsUsageDto(billingPeriod(), 2_450)).toMatchObject({
      primaryText: "2,450 SMS credits used",
      additionalCreditsText: "450 additional credits",
      additionalUsageAmountMicroUsd: 18_000_000,
      additionalUsageText: "Additional usage: $18.00",
    });
  });

  it("exposes no provider cost or provider identifiers in the customer DTO", () => {
    const serialized = JSON.stringify(toCustomerSmsUsageDto(billingPeriod(), 2_450));
    expect(serialized).not.toMatch(/provider|twilio|sid|carrier|margin/i);
  });
});

