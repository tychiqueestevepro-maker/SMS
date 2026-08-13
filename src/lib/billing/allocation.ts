import {
  assertNonNegativeSafeInteger,
  safeAdd,
  safeMultiply,
} from "./integer";
import type {
  BillingMessageUsage,
  BillingPeriodSnapshot,
  BillingUsageLedgerEntry,
  PeriodUsageAllocation,
} from "./types";

function validateUsage(message: BillingMessageUsage, periodId: string): void {
  if (message.billingPeriodId !== periodId) {
    throw new RangeError("Message belongs to a different billing period.");
  }
  if (message.numSegments !== null) {
    assertNonNegativeSafeInteger(message.numSegments, "Actual segments");
    if (message.numSegments === 0) {
      throw new RangeError("Reconciled segment count must be positive.");
    }
  }
  if (message.providerCostMicroUsd !== null) {
    assertNonNegativeSafeInteger(message.providerCostMicroUsd, "Provider cost");
  }
  assertNonNegativeSafeInteger(
    message.billedOverageSegments ?? 0,
    "Billed overage segments",
  );
  assertNonNegativeSafeInteger(
    message.billedCustomerAmountMicroUsd ?? 0,
    "Billed customer amount",
  );
}

export function allocatePeriodUsage(
  period: BillingPeriodSnapshot,
  messages: readonly BillingMessageUsage[],
): PeriodUsageAllocation {
  messages.forEach((message) => validateUsage(message, period.id));
  const outbound = messages.filter((message) => message.direction === "outbound");
  const positions = new Set<number>();
  for (const message of outbound) {
    if (!Number.isSafeInteger(message.usagePosition) || message.usagePosition! < 1) {
      throw new RangeError("Every outbound requires a positive usage position.");
    }
    if (positions.has(message.usagePosition!)) {
      throw new RangeError("Outbound usage positions must be unique per period.");
    }
    positions.add(message.usagePosition!);
  }

  const orderedOutbound = [...outbound].sort(
    (left, right) => left.usagePosition! - right.usagePosition!,
  );
  const outboundEntries = new Map<string, BillingUsageLedgerEntry>();
  const pendingOutboundMessageIds: string[] = [];
  let actualOutboundSegments = 0;
  let includedOutboundSegments = 0;
  let overageOutboundSegments = 0;
  let customerBillableAmountMicroUsd = 0;

  for (const message of orderedOutbound) {
    const billedOverageSegments = message.billedOverageSegments ?? 0;
    const billedCustomerAmountMicroUsd =
      message.billedCustomerAmountMicroUsd ?? 0;
    if (message.numSegments === null) {
      pendingOutboundMessageIds.push(message.messageId);
      outboundEntries.set(message.messageId, {
        ...message,
        includedSegments: null,
        overageSegments: null,
        customerBillableAmountMicroUsd: null,
        billedOverageSegments,
        billedCustomerAmountMicroUsd,
      });
      continue;
    }

    const includedRemaining = Math.max(
      0,
      period.plan.includedSegments - actualOutboundSegments,
    );
    const includedSegments = Math.min(message.numSegments, includedRemaining);
    const overageSegments = message.numSegments - includedSegments;
    const amountMicroUsd = safeMultiply(
      overageSegments,
      period.plan.overagePriceMicroUsd,
      "Customer overage amount",
    );
    actualOutboundSegments = safeAdd(
      actualOutboundSegments,
      message.numSegments,
      "Actual outbound usage",
    );
    includedOutboundSegments = safeAdd(
      includedOutboundSegments,
      includedSegments,
      "Included outbound usage",
    );
    overageOutboundSegments = safeAdd(
      overageOutboundSegments,
      overageSegments,
      "Overage outbound usage",
    );
    customerBillableAmountMicroUsd = safeAdd(
      customerBillableAmountMicroUsd,
      amountMicroUsd,
      "Customer billable amount",
    );

    outboundEntries.set(message.messageId, {
      ...message,
      includedSegments,
      overageSegments,
      customerBillableAmountMicroUsd: amountMicroUsd,
      billedOverageSegments,
      billedCustomerAmountMicroUsd,
    });
  }

  const inboundEntries = messages
    .filter((message) => message.direction === "inbound")
    .map<BillingUsageLedgerEntry>((message) => ({
      ...message,
      usagePosition: null,
      includedSegments: 0,
      overageSegments: 0,
      customerBillableAmountMicroUsd: 0,
      billedOverageSegments: message.billedOverageSegments ?? 0,
      billedCustomerAmountMicroUsd: message.billedCustomerAmountMicroUsd ?? 0,
    }));
  const entries = [
    ...orderedOutbound.map((message) => outboundEntries.get(message.messageId)!),
    ...inboundEntries,
  ];
  const providerMessageCostMicroUsd = entries.reduce(
    (total, entry) =>
      safeAdd(
        total,
        entry.providerCostMicroUsd ?? 0,
        "Provider message cost",
      ),
    0,
  );

  return {
    periodId: period.id,
    entries,
    pendingOutboundMessageIds,
    actualOutboundSegments,
    includedOutboundSegments,
    overageOutboundSegments,
    customerBillableAmountMicroUsd,
    providerMessageCostMicroUsd,
  };
}
