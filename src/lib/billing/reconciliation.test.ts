import { describe, expect, it } from "vitest";

import { allocatePeriodUsage } from "./allocation";
import { prepareAdditionalUsageInvoiceRun } from "./invoice";
import { reconcileLateOutboundUsage } from "./reconciliation";
import { billingPeriod, outboundUsage } from "./test-fixtures";

describe("late segment reconciliation", () => {
  it("records July usage for a later invoice without consuming August allowance", () => {
    const july = billingPeriod();
    const august = billingPeriod({
      id: "period-august",
      startsAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2026-09-01T00:00:00.000Z",
    });
    const reconciliation = reconcileLateOutboundUsage({
      originalPeriod: july,
      originalPeriodMessages: [
        outboundUsage("july-included", 1, 1_999),
        outboundUsage("july-late", 2, null),
      ],
      messageId: "july-late",
      actualSegments: 3,
    });

    expect(reconciliation).toMatchObject({
      originalPeriodId: "period-july",
      originalUsagePosition: 2,
      allocationDeltaMicroUsd: 80_000,
      unpaidOverageSegments: 2,
      unpaidAmountMicroUsd: 80_000,
      replayed: false,
    });
    expect(reconciliation.reconciledMessage).toMatchObject({
      billingPeriodId: "period-july",
      usagePosition: 2,
    });
    expect(reconciliation.allocation.entries[1]).toMatchObject({
      includedSegments: 1,
      overageSegments: 2,
    });

    const augustUsage = allocatePeriodUsage(august, []);
    expect(augustUsage.includedOutboundSegments).toBe(0);
    expect(august.plan.includedSegments).toBe(2_000);
  });

  it("reallocates later messages according to the original monotone position", () => {
    const reconciliation = reconcileLateOutboundUsage({
      originalPeriod: billingPeriod(),
      originalPeriodMessages: [
        outboundUsage("late-first", 1, null),
        outboundUsage("known-second", 2, 1_999),
      ],
      messageId: "late-first",
      actualSegments: 3,
    });
    expect(reconciliation.allocation.entries).toMatchObject([
      { messageId: "late-first", includedSegments: 3, overageSegments: 0 },
      { messageId: "known-second", includedSegments: 1_997, overageSegments: 2 },
    ]);
    expect(reconciliation.unpaidOverageSegments).toBe(2);
  });

  it("returns only the unpaid delta when earlier overage was already invoiced", () => {
    const reconciliation = reconcileLateOutboundUsage({
      originalPeriod: billingPeriod(),
      originalPeriodMessages: [
        outboundUsage("late-first", 1, null),
        outboundUsage("already-billed", 2, 2_100, {
          billedCustomerAmountMicroUsd: 4_000_000,
          billedOverageSegments: 100,
        }),
      ],
      messageId: "late-first",
      actualSegments: 3,
    });

    expect(reconciliation.allocation.overageOutboundSegments).toBe(103);
    expect(reconciliation.unpaidOverageSegments).toBe(3);
    expect(reconciliation.unpaidAmountMicroUsd).toBe(120_000);
  });

  it("combines reconciliation with invoice-run idempotency", () => {
    const input = {
      originalPeriod: billingPeriod(),
      originalPeriodMessages: [
        outboundUsage("included", 1, 2_000),
        outboundUsage("late", 2, null),
      ],
      messageId: "late",
      actualSegments: 2,
    } as const;
    const reconciliation = reconcileLateOutboundUsage(input);
    const sameReconciliation = reconcileLateOutboundUsage({
      ...input,
      originalPeriodMessages: [
        input.originalPeriodMessages[0],
        reconciliation.reconciledMessage,
      ],
    });
    expect(sameReconciliation.replayed).toBe(true);
    expect(sameReconciliation.unpaidAmountMicroUsd).toBe(80_000);

    const firstRun = prepareAdditionalUsageInvoiceRun({
      workspaceId: "workspace-1",
      stripeInvoiceId: "invoice-august",
      entries: reconciliation.allocation.entries,
      existingRuns: [],
      createdAt: "2026-08-01T01:00:00Z",
    });
    const replay = prepareAdditionalUsageInvoiceRun({
      workspaceId: "workspace-1",
      stripeInvoiceId: "invoice-august",
      entries: reconciliation.allocation.entries,
      existingRuns: [firstRun.run],
      createdAt: "2026-08-01T02:00:00Z",
    });
    expect(firstRun.line?.amountMicroUsd).toBe(80_000);
    expect(replay.replayed).toBe(true);
    expect(replay.run).toBe(firstRun.run);
  });

  it("never changes a real segment count after reconciliation", () => {
    expect(() =>
      reconcileLateOutboundUsage({
        originalPeriod: billingPeriod(),
        originalPeriodMessages: [outboundUsage("already-known", 1, 2)],
        messageId: "already-known",
        actualSegments: 3,
      }),
    ).toThrow("A reconciled segment count cannot be changed.");
  });

  it("rejects a message detached from the original billing period", () => {
    expect(() =>
      reconcileLateOutboundUsage({
        originalPeriod: billingPeriod(),
        originalPeriodMessages: [
          outboundUsage("late", 1, null, { billingPeriodId: "period-august" }),
        ],
        messageId: "late",
        actualSegments: 2,
      }),
    ).toThrow(/original period|different billing period/i);
  });
});
