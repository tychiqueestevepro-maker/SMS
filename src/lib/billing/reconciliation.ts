import { allocatePeriodUsage } from "./allocation";
import { aggregateAdditionalSmsUsage } from "./invoice";
import { assertNonNegativeSafeInteger } from "./integer";
import type {
  BillingMessageUsage,
  BillingPeriodSnapshot,
  LateReconciliationResult,
} from "./types";

export interface ReconcileLateOutboundUsageInput {
  originalPeriod: BillingPeriodSnapshot;
  originalPeriodMessages: readonly BillingMessageUsage[];
  messageId: string;
  actualSegments: number;
}

export function reconcileLateOutboundUsage(
  input: ReconcileLateOutboundUsageInput,
): LateReconciliationResult {
  assertNonNegativeSafeInteger(input.actualSegments, "Actual segments");
  if (input.actualSegments === 0) {
    throw new RangeError("Actual consumed segments must be positive.");
  }
  const target = input.originalPeriodMessages.find(
    (message) => message.messageId === input.messageId,
  );
  if (!target || target.direction !== "outbound") {
    throw new RangeError("Late reconciliation requires an outbound message.");
  }
  if (target.billingPeriodId !== input.originalPeriod.id) {
    throw new RangeError("Message is not attached to the original period.");
  }
  if (!Number.isSafeInteger(target.usagePosition) || target.usagePosition! < 1) {
    throw new RangeError("Original usage position is invalid.");
  }
  const originalUsagePosition = target.usagePosition as number;
  if (target.numSegments !== null && target.numSegments !== input.actualSegments) {
    throw new RangeError("A reconciled segment count cannot be changed.");
  }

  const before = allocatePeriodUsage(
    input.originalPeriod,
    input.originalPeriodMessages,
  );
  const replayed = target.numSegments === input.actualSegments;
  const reconciledMessage: BillingMessageUsage = Object.freeze({
    ...target,
    // Period and usage position are copied from the immutable original record.
    billingPeriodId: target.billingPeriodId,
    usagePosition: originalUsagePosition,
    numSegments: input.actualSegments,
  });
  const messages = input.originalPeriodMessages.map((message) =>
    message.messageId === target.messageId ? reconciledMessage : message,
  );
  const allocation = allocatePeriodUsage(input.originalPeriod, messages);
  const unpaid = aggregateAdditionalSmsUsage(allocation.entries);

  return {
    originalPeriodId: input.originalPeriod.id,
    originalUsagePosition,
    reconciledMessage,
    allocation,
    allocationDeltaMicroUsd:
      allocation.customerBillableAmountMicroUsd -
      before.customerBillableAmountMicroUsd,
    unpaidOverageSegments: unpaid.additionalCredits,
    unpaidAmountMicroUsd: unpaid.amountMicroUsd,
    replayed,
  };
}
