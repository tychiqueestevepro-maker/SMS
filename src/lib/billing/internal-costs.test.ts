import { describe, expect, it } from "vitest";

import { allocatePeriodUsage } from "./allocation";
import { aggregateAdditionalSmsUsage } from "./invoice";
import { summarizeInternalProviderCosts } from "./internal-costs";
import { billingPeriod, outboundUsage } from "./test-fixtures";
import type { BillingMessageUsage } from "./types";

describe("internal provider costs", () => {
  it("keeps message and fixed costs internal and outside customer overage", () => {
    const inbound: BillingMessageUsage = {
      messageId: "inbound",
      billingPeriodId: "period-july",
      direction: "inbound",
      usagePosition: null,
      numSegments: 1,
      providerCostMicroUsd: 8_000,
      dispatchOutcome: "sent",
    };
    const allocation = allocatePeriodUsage(billingPeriod(), [
      outboundUsage("included", 1, 2_000, { providerCostMicroUsd: 15_000 }),
      outboundUsage("overage", 2, 2, { providerCostMicroUsd: 4_000 }),
      inbound,
    ]);
    const summary = summarizeInternalProviderCosts(allocation.entries, [
      {
        id: "number-cost",
        billingPeriodId: "period-july",
        category: "phone_number",
        amountMicroUsd: 100_000,
      },
      {
        id: "setup-cost",
        billingPeriodId: "period-july",
        category: "telecom_setup",
        amountMicroUsd: 50_000,
      },
    ]);

    expect(summary).toEqual({
      messageCostMicroUsd: 27_000,
      fixedCostMicroUsd: 150_000,
      totalProviderCostMicroUsd: 177_000,
    });
    expect(aggregateAdditionalSmsUsage(allocation.entries)).toMatchObject({
      additionalCredits: 2,
      amountMicroUsd: 80_000,
    });
  });
});

