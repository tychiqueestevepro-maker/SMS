import { createBillingPeriodSnapshot } from "./snapshots";
import type { BillingMessageUsage } from "./types";

export function billingPeriod(
  overrides: Partial<{
    id: string;
    workspaceId: string;
    startsAt: string;
    endsAt: string;
    includedSegments: number;
    overagePriceMicroUsd: number;
    safetyCapSegments: number;
  }> = {},
) {
  return createBillingPeriodSnapshot({
    id: overrides.id ?? "period-july",
    workspaceId: overrides.workspaceId ?? "workspace-1",
    startsAt: overrides.startsAt ?? "2026-07-01T00:00:00.000Z",
    endsAt: overrides.endsAt ?? "2026-08-01T00:00:00.000Z",
    plan: {
      planId: "riink-v1",
      planVersion: 1,
      monthlyPriceCents: 8_999,
      includedSegments: overrides.includedSegments ?? 2_000,
      overagePriceMicroUsd: overrides.overagePriceMicroUsd ?? 40_000,
      maxPhoneNumbers: 3,
      safetyCapSegments: overrides.safetyCapSegments ?? 10_000,
    },
  });
}

export function outboundUsage(
  messageId: string,
  usagePosition: number,
  numSegments: number | null,
  overrides: Partial<BillingMessageUsage> = {},
): BillingMessageUsage {
  return {
    messageId,
    billingPeriodId: "period-july",
    direction: "outbound",
    usagePosition,
    numSegments,
    providerCostMicroUsd: null,
    dispatchOutcome: "sent",
    ...overrides,
  };
}

