import { describe, expect, it } from "vitest";

import { allocatePeriodUsage } from "./allocation";
import {
  additionalUsageInvoiceRunKey,
  aggregateAdditionalSmsUsage,
  prepareAdditionalUsageInvoiceRun,
} from "./invoice";
import { billingPeriod, outboundUsage } from "./test-fixtures";

describe("aggregated additional usage invoicing", () => {
  const entries = allocatePeriodUsage(billingPeriod(), [
    outboundUsage("included", 1, 2_000),
    outboundUsage("overage", 2, 3),
  ]).entries;

  it("creates one aggregate line linked to its exact ledger messages", () => {
    const aggregate = aggregateAdditionalSmsUsage(entries);
    expect(aggregate).toEqual({
      description: "Additional SMS usage",
      additionalCredits: 3,
      amountMicroUsd: 120_000,
      sourcePeriodIds: ["period-july"],
      ledgerMessageIds: ["overage"],
    });
  });

  it("charges only the net amount not already billed for the original period", () => {
    const partlyBilled = entries.map((entry) => ({
      ...entry,
      billedOverageSegments: entry.messageId === "overage" ? 1 : 0,
      billedCustomerAmountMicroUsd: entry.messageId === "overage" ? 40_000 : 0,
    }));
    expect(aggregateAdditionalSmsUsage(partlyBilled)).toMatchObject({
      additionalCredits: 2,
      amountMicroUsd: 80_000,
    });
  });

  it("uses a stable invoice idempotency key and replays the existing run", () => {
    const first = prepareAdditionalUsageInvoiceRun({
      workspaceId: "workspace-1",
      stripeInvoiceId: "invoice-august",
      entries,
      existingRuns: [],
      createdAt: "2026-08-01T01:00:00.000Z",
    });
    expect(first).toMatchObject({
      replayed: false,
      line: { description: "Additional SMS usage", amountMicroUsd: 120_000 },
    });
    expect(first.run.idempotencyKey).toBe(
      additionalUsageInvoiceRunKey("workspace-1", "invoice-august"),
    );

    const replay = prepareAdditionalUsageInvoiceRun({
      workspaceId: "workspace-1",
      stripeInvoiceId: "invoice-august",
      entries,
      existingRuns: [first.run],
      createdAt: "2026-08-01T02:00:00.000Z",
    });
    expect(replay.replayed).toBe(true);
    expect(replay.run).toBe(first.run);
    expect(replay.line).toEqual(first.line);
  });

  it("creates no invoice line when there is no overage", () => {
    const run = prepareAdditionalUsageInvoiceRun({
      workspaceId: "workspace-1",
      stripeInvoiceId: "invoice-july",
      entries: allocatePeriodUsage(billingPeriod(), [
        outboundUsage("included", 1, 2_000),
      ]).entries,
      existingRuns: [],
      createdAt: "2026-08-01T01:00:00.000Z",
    });
    expect(run.run.status).toBe("no_usage");
    expect(run.line).toBeNull();
  });
});

