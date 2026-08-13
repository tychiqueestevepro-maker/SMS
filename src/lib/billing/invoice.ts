import { safeAdd } from "./integer";
import type {
  AggregatedAdditionalUsage,
  BillingInvoiceRun,
  BillingUsageLedgerEntry,
  PreparedInvoiceRun,
} from "./types";

export function aggregateAdditionalSmsUsage(
  entries: readonly BillingUsageLedgerEntry[],
): AggregatedAdditionalUsage {
  const byPeriod = new Map<
    string,
    {
      currentCredits: number;
      billedCredits: number;
      currentAmount: number;
      billedAmount: number;
      messageIds: Set<string>;
    }
  >();

  for (const entry of entries) {
    if (entry.direction !== "outbound") continue;
    const period = byPeriod.get(entry.billingPeriodId) ?? {
      currentCredits: 0,
      billedCredits: 0,
      currentAmount: 0,
      billedAmount: 0,
      messageIds: new Set<string>(),
    };
    period.currentCredits = safeAdd(
      period.currentCredits,
      entry.overageSegments ?? 0,
      "Current overage credits",
    );
    period.billedCredits = safeAdd(
      period.billedCredits,
      entry.billedOverageSegments,
      "Billed overage credits",
    );
    period.currentAmount = safeAdd(
      period.currentAmount,
      entry.customerBillableAmountMicroUsd ?? 0,
      "Current customer amount",
    );
    period.billedAmount = safeAdd(
      period.billedAmount,
      entry.billedCustomerAmountMicroUsd,
      "Billed customer amount",
    );
    if (
      (entry.overageSegments ?? 0) > 0 ||
      entry.billedOverageSegments > 0
    ) {
      period.messageIds.add(entry.messageId);
    }
    byPeriod.set(entry.billingPeriodId, period);
  }

  let additionalCredits = 0;
  let amountMicroUsd = 0;
  const sourcePeriodIds: string[] = [];
  const ledgerMessageIds = new Set<string>();
  for (const [periodId, period] of byPeriod) {
    const creditDelta = Math.max(
      0,
      period.currentCredits - period.billedCredits,
    );
    const amountDelta = Math.max(
      0,
      period.currentAmount - period.billedAmount,
    );
    if (creditDelta === 0 && amountDelta === 0) continue;
    additionalCredits = safeAdd(
      additionalCredits,
      creditDelta,
      "Aggregated additional credits",
    );
    amountMicroUsd = safeAdd(
      amountMicroUsd,
      amountDelta,
      "Aggregated additional amount",
    );
    sourcePeriodIds.push(periodId);
    period.messageIds.forEach((messageId) => ledgerMessageIds.add(messageId));
  }

  return {
    description: "Additional SMS usage",
    additionalCredits,
    amountMicroUsd,
    sourcePeriodIds: sourcePeriodIds.sort(),
    ledgerMessageIds: Array.from(ledgerMessageIds).sort(),
  };
}

export function additionalUsageInvoiceRunKey(
  workspaceId: string,
  stripeInvoiceId: string,
): string {
  if (!workspaceId || !stripeInvoiceId) {
    throw new RangeError("Workspace and invoice IDs are required.");
  }
  return `additional-sms-usage:${workspaceId}:${stripeInvoiceId}`;
}

export interface PrepareAdditionalUsageInvoiceRunInput {
  workspaceId: string;
  stripeInvoiceId: string;
  entries: readonly BillingUsageLedgerEntry[];
  existingRuns: readonly BillingInvoiceRun[];
  createdAt: string;
}

export function prepareAdditionalUsageInvoiceRun(
  input: PrepareAdditionalUsageInvoiceRunInput,
): PreparedInvoiceRun {
  const idempotencyKey = additionalUsageInvoiceRunKey(
    input.workspaceId,
    input.stripeInvoiceId,
  );
  const existing = input.existingRuns.find(
    (run) => run.idempotencyKey === idempotencyKey,
  );
  if (existing) {
    return {
      run: existing,
      line:
        existing.amountMicroUsd === 0
          ? null
          : {
              description: "Additional SMS usage",
              amountMicroUsd: existing.amountMicroUsd,
            },
      replayed: true,
    };
  }

  const createdAt = new Date(input.createdAt);
  if (!Number.isFinite(createdAt.getTime())) {
    throw new RangeError("Invoice run timestamp is invalid.");
  }
  const aggregate = aggregateAdditionalSmsUsage(input.entries);
  const run: BillingInvoiceRun = Object.freeze({
    idempotencyKey,
    workspaceId: input.workspaceId,
    stripeInvoiceId: input.stripeInvoiceId,
    status: aggregate.amountMicroUsd === 0 ? "no_usage" : "pending",
    amountMicroUsd: aggregate.amountMicroUsd,
    additionalCredits: aggregate.additionalCredits,
    sourcePeriodIds: Object.freeze([...aggregate.sourcePeriodIds]),
    ledgerMessageIds: Object.freeze([...aggregate.ledgerMessageIds]),
    createdAt: createdAt.toISOString(),
  });
  return {
    run,
    line:
      aggregate.amountMicroUsd === 0
        ? null
        : {
            description: "Additional SMS usage",
            amountMicroUsd: aggregate.amountMicroUsd,
          },
    replayed: false,
  };
}
