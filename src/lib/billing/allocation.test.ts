import { describe, expect, it } from "vitest";

import { allocatePeriodUsage } from "./allocation";
import { billingPeriod, outboundUsage } from "./test-fixtures";
import type { BillingMessageUsage } from "./types";

describe("period usage allocation", () => {
  it("splits a 3-credit message across the included boundary at 1,999", () => {
    const allocation = allocatePeriodUsage(billingPeriod(), [
      outboundUsage("first", 1, 1_999),
      outboundUsage("boundary", 2, 3),
    ]);

    expect(allocation.entries[1]).toMatchObject({
      includedSegments: 1,
      overageSegments: 2,
      customerBillableAmountMicroUsd: 80_000,
    });
    expect(allocation).toMatchObject({
      actualOutboundSegments: 2_002,
      includedOutboundSegments: 2_000,
      overageOutboundSegments: 2,
      customerBillableAmountMicroUsd: 80_000,
    });
  });

  it("uses immutable usage position rather than input order", () => {
    const allocation = allocatePeriodUsage(billingPeriod(), [
      outboundUsage("second", 2, 3),
      outboundUsage("first", 1, 1_999),
    ]);
    expect(allocation.entries.map((entry) => entry.messageId)).toEqual([
      "first",
      "second",
    ]);
    expect(allocation.entries[1]?.overageSegments).toBe(2);
  });

  it("keeps failed-but-consumed outbound usage billable", () => {
    const allocation = allocatePeriodUsage(billingPeriod(), [
      outboundUsage("included", 1, 2_000),
      outboundUsage("failed-after-consumption", 2, 2, {
        dispatchOutcome: "failed",
      }),
    ]);
    expect(allocation.entries[1]).toMatchObject({
      numSegments: 2,
      overageSegments: 2,
      customerBillableAmountMicroUsd: 80_000,
    });
  });

  it("does not count a failed message until real usage is known", () => {
    const allocation = allocatePeriodUsage(billingPeriod(), [
      outboundUsage("not-consumed", 1, null, { dispatchOutcome: "failed" }),
    ]);
    expect(allocation.actualOutboundSegments).toBe(0);
    expect(allocation.pendingOutboundMessageIds).toEqual(["not-consumed"]);
  });

  it("retains inbound provider cost while charging the customer zero", () => {
    const inbound: BillingMessageUsage = {
      messageId: "inbound-1",
      billingPeriodId: "period-july",
      direction: "inbound",
      usagePosition: null,
      numSegments: 3,
      providerCostMicroUsd: 12_345,
      dispatchOutcome: "sent",
    };
    const allocation = allocatePeriodUsage(billingPeriod(), [inbound]);
    expect(allocation.entries[0]).toMatchObject({
      includedSegments: 0,
      overageSegments: 0,
      customerBillableAmountMicroUsd: 0,
      providerCostMicroUsd: 12_345,
    });
    expect(allocation.providerMessageCostMicroUsd).toBe(12_345);
    expect(allocation.actualOutboundSegments).toBe(0);
  });

  it("preserves the allocation identity across representative boundaries", () => {
    const period = billingPeriod();
    for (let prior = 0; prior <= 2_010; prior += 37) {
      for (let current = 1; current <= 6; current += 1) {
        const messages = [
          ...(prior === 0 ? [] : [outboundUsage("prior", 1, prior)]),
          outboundUsage("current", prior === 0 ? 1 : 2, current),
        ];
        const allocation = allocatePeriodUsage(period, messages);
        const total = prior + current;
        expect(allocation.includedOutboundSegments).toBe(Math.min(total, 2_000));
        expect(allocation.overageOutboundSegments).toBe(Math.max(0, total - 2_000));
        expect(allocation.customerBillableAmountMicroUsd).toBe(
          Math.max(0, total - 2_000) * 40_000,
        );
      }
    }
  });

  it("rejects duplicate positions and cross-period messages", () => {
    expect(() =>
      allocatePeriodUsage(billingPeriod(), [
        outboundUsage("one", 1, 1),
        outboundUsage("two", 1, 1),
      ]),
    ).toThrow(/unique/i);
    expect(() =>
      allocatePeriodUsage(billingPeriod(), [
        outboundUsage("wrong-period", 1, 1, { billingPeriodId: "period-august" }),
      ]),
    ).toThrow(/different billing period/i);
  });
});

