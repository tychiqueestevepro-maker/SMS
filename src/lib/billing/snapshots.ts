import { assertNonNegativeSafeInteger } from "./integer";
import type {
  BillingPeriodSnapshot,
  BillingPeriodSnapshotInput,
  BillingPlanSnapshot,
  BillingPlanSnapshotInput,
} from "./types";

export function createBillingPlanSnapshot(
  input: BillingPlanSnapshotInput,
): BillingPlanSnapshot {
  if (!input.planId.trim()) throw new RangeError("Plan ID is required.");
  assertNonNegativeSafeInteger(input.planVersion, "Plan version");
  assertNonNegativeSafeInteger(input.monthlyPriceCents, "Monthly price");
  assertNonNegativeSafeInteger(input.includedSegments, "Included segments");
  assertNonNegativeSafeInteger(
    input.overagePriceMicroUsd,
    "Overage price",
  );
  assertNonNegativeSafeInteger(input.maxPhoneNumbers, "Maximum phone numbers");
  assertNonNegativeSafeInteger(input.safetyCapSegments, "Safety cap");
  if (input.safetyCapSegments < input.includedSegments) {
    throw new RangeError("Safety cap cannot be below included usage.");
  }

  return Object.freeze({ ...input });
}

function isoInstant(value: string, name: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError(`${name} is invalid.`);
  return date.toISOString();
}

export function createBillingPeriodSnapshot(
  input: BillingPeriodSnapshotInput,
): BillingPeriodSnapshot {
  const startsAt = isoInstant(input.startsAt, "Period start");
  const endsAt = isoInstant(input.endsAt, "Period end");
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new RangeError("Billing period end must be after its start.");
  }
  if (!input.id.trim() || !input.workspaceId.trim()) {
    throw new RangeError("Billing period and workspace IDs are required.");
  }

  return Object.freeze({
    id: input.id,
    workspaceId: input.workspaceId,
    startsAt,
    endsAt,
    plan: createBillingPlanSnapshot(input.plan),
  });
}
