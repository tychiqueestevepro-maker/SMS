import { describe, expect, it } from "vitest";

import { createBillingPeriodSnapshot, createBillingPlanSnapshot } from "./snapshots";
import { billingPeriod } from "./test-fixtures";

describe("billing snapshots", () => {
  it("captures the V1 plan as an immutable period snapshot", () => {
    const mutablePlan = {
      planId: "riink-v1",
      planVersion: 1,
      monthlyPriceCents: 8_999,
      includedSegments: 2_000,
      overagePriceMicroUsd: 40_000,
      maxPhoneNumbers: 3,
      safetyCapSegments: 10_000,
    };
    const period = createBillingPeriodSnapshot({
      id: "period-july",
      workspaceId: "workspace-1",
      startsAt: "2026-07-01T00:00:00Z",
      endsAt: "2026-08-01T00:00:00Z",
      plan: mutablePlan,
    });
    mutablePlan.includedSegments = 999;

    expect(period.plan).toMatchObject({
      monthlyPriceCents: 8_999,
      includedSegments: 2_000,
      overagePriceMicroUsd: 40_000,
      maxPhoneNumbers: 3,
      safetyCapSegments: 10_000,
    });
    expect(Object.isFrozen(period)).toBe(true);
    expect(Object.isFrozen(period.plan)).toBe(true);
  });

  it("rejects invalid integer pricing and a safety cap below included usage", () => {
    expect(() =>
      createBillingPlanSnapshot({
        ...billingPeriod().plan,
        overagePriceMicroUsd: 40_000.5,
      }),
    ).toThrow(/integer/i);
    expect(() =>
      createBillingPlanSnapshot({
        ...billingPeriod().plan,
        includedSegments: 2_000,
        safetyCapSegments: 1_999,
      }),
    ).toThrow(/below included/i);
  });

  it("rejects inverted or invalid period boundaries", () => {
    expect(() =>
      createBillingPeriodSnapshot({
        id: "bad",
        workspaceId: "workspace-1",
        startsAt: "2026-08-01T00:00:00Z",
        endsAt: "2026-07-01T00:00:00Z",
        plan: billingPeriod().plan,
      }),
    ).toThrow(/after its start/i);
  });
});

