import { describe, expect, it, vi } from "vitest";

import { SimulatedMessagingProvider } from "../providers/simulated/provider";
import { DispatchReconciler } from "./reconciliation";
import {
  FIXED_NOW,
  MemoryDispatchRepository,
  reconciliationClaim,
} from "./test-fixtures";

describe("dispatch usage reconciliation", () => {
  it("replaces the reservation with real multi-credit usage exactly once", async () => {
    const provider = new SimulatedMessagingProvider({
      now: () => FIXED_NOW,
      outboundCostPerSegmentMicroUsd: 8_000,
    });
    const sent = await provider.sendMessage({
      workspaceId: "workspace-1",
      messageId: "message-1",
      from: "+12025550101",
      to: "+12025550199",
      body: "a".repeat(161),
      idempotencyKey: "dispatch:message-1",
    });
    const repository = new MemoryDispatchRepository({
      reconciliationClaims: [
        reconciliationClaim({ providerMessageId: sent.providerMessageId }),
      ],
    });
    const reconciler = new DispatchReconciler(repository, provider, {
      workerId: "reconciler-1",
      now: () => FIXED_NOW,
    });

    await expect(reconciler.runOnce()).resolves.toEqual({
      outcome: "reconciled",
      messageId: "message-1",
      actualSegments: 2,
      providerCostPending: false,
    });
    expect(repository.completedReconciliations).toHaveLength(1);
    expect(repository.completedReconciliations[0]).toMatchObject({
      actualSegments: 2,
      providerCostMicroUsd: 16_000,
      providerCostPending: false,
      claim: {
        billingPeriodId: "period-july",
        usagePosition: 42,
      },
    });
    await expect(reconciler.runOnce()).resolves.toEqual({ outcome: "idle" });
    expect(repository.completedReconciliations).toHaveLength(1);
  });

  it("keeps the reservation when actual segments are not available", async () => {
    const provider = new SimulatedMessagingProvider();
    vi.spyOn(provider, "getActualSegments").mockResolvedValue({
      providerMessageId: "sim-message-000001",
      numSegments: null,
    });
    const repository = new MemoryDispatchRepository({
      reconciliationClaims: [reconciliationClaim()],
    });
    const reconciler = new DispatchReconciler(repository, provider, {
      workerId: "reconciler-1",
      now: () => FIXED_NOW,
    });

    await expect(reconciler.runOnce()).resolves.toEqual({
      outcome: "deferred",
      messageId: "message-1",
      reason: "segments_pending",
    });
    expect(repository.completedReconciliations).toHaveLength(0);
    expect(repository.deferredReconciliations).toHaveLength(1);
  });

  it("persists failed-message provider cost even while segments remain unavailable", async () => {
    const provider = new SimulatedMessagingProvider();
    vi.spyOn(provider, "getMessageStatus").mockResolvedValue({
      providerMessageId: "sim-message-000001",
      status: "failed",
      updatedAt: FIXED_NOW.toISOString(),
    });
    vi.spyOn(provider, "getActualSegments").mockResolvedValue({
      providerMessageId: "sim-message-000001",
      numSegments: null,
    });
    vi.spyOn(provider, "getMessageCost").mockResolvedValue({
      providerMessageId: "sim-message-000001",
      amountMicroUsd: 9_500,
      currency: "USD",
    });
    const currentClaim = reconciliationClaim();
    const repository = new MemoryDispatchRepository({
      reconciliationClaims: [currentClaim],
    });
    const reconciler = new DispatchReconciler(repository, provider, {
      workerId: "reconciler-1",
      now: () => FIXED_NOW,
    });

    await expect(reconciler.runOnce()).resolves.toEqual({
      outcome: "deferred",
      messageId: "message-1",
      reason: "segments_pending",
    });
    expect(repository.reconciledDeliveryStates).toEqual([
      {
        claim: currentClaim,
        deliveryState: "failed",
        observedAt: FIXED_NOW.toISOString(),
      },
    ]);
    expect(repository.reconciledProviderCosts).toEqual([
      {
        claim: currentClaim,
        providerCostMicroUsd: 9_500,
        providerCostPending: false,
        observedAt: FIXED_NOW.toISOString(),
      },
    ]);
    expect(repository.completedReconciliations).toHaveLength(0);
  });

  it("actualizes segments even when provider cost must be reconciled later", async () => {
    const provider = new SimulatedMessagingProvider();
    vi.spyOn(provider, "getActualSegments").mockResolvedValue({
      providerMessageId: "sim-message-000001",
      numSegments: 3,
    });
    vi.spyOn(provider, "getMessageCost").mockRejectedValue(new Error("not ready"));
    const repository = new MemoryDispatchRepository({
      reconciliationClaims: [reconciliationClaim()],
    });
    const reconciler = new DispatchReconciler(repository, provider, {
      workerId: "reconciler-1",
      now: () => FIXED_NOW,
    });

    await expect(reconciler.runOnce()).resolves.toMatchObject({
      outcome: "reconciled",
      actualSegments: 3,
      providerCostPending: true,
    });
    expect(repository.completedReconciliations[0]).toMatchObject({
      actualSegments: 3,
      providerCostMicroUsd: null,
      providerCostPending: true,
    });
  });

  it("polls and persists an explicit late Failed state even if a callback was lost", async () => {
    const provider = new SimulatedMessagingProvider({ now: () => FIXED_NOW });
    const sent = await provider.sendMessage({
      workspaceId: "workspace-1",
      messageId: "message-1",
      from: "+12025550101",
      to: "+12025550199",
      body: "Hello",
      idempotencyKey: "dispatch:message-1",
    });
    provider.setMessageStatus(sent.providerMessageId, "failed");
    const currentClaim = reconciliationClaim({
      providerMessageId: sent.providerMessageId,
    });
    const repository = new MemoryDispatchRepository({
      reconciliationClaims: [currentClaim],
    });
    const reconciler = new DispatchReconciler(repository, provider, {
      workerId: "reconciler-1",
      now: () => FIXED_NOW,
    });

    await reconciler.runOnce();
    expect(repository.reconciledDeliveryStates).toEqual([
      {
        claim: currentClaim,
        deliveryState: "failed",
        observedAt: FIXED_NOW.toISOString(),
      },
    ]);
  });

  it("keeps usage reconciliation independent when status lookup fails", async () => {
    const provider = new SimulatedMessagingProvider();
    vi.spyOn(provider, "getMessageStatus").mockRejectedValue(new Error("not ready"));
    vi.spyOn(provider, "getActualSegments").mockResolvedValue({
      providerMessageId: "sim-message-000001",
      numSegments: 1,
    });
    vi.spyOn(provider, "getMessageCost").mockResolvedValue({
      providerMessageId: "sim-message-000001",
      amountMicroUsd: 8_000,
      currency: "USD",
    });
    const repository = new MemoryDispatchRepository({
      reconciliationClaims: [reconciliationClaim()],
    });
    const reconciler = new DispatchReconciler(repository, provider, {
      workerId: "reconciler-1",
      now: () => FIXED_NOW,
    });

    await expect(reconciler.runOnce()).resolves.toMatchObject({
      outcome: "reconciled",
      actualSegments: 1,
    });
    expect(repository.reconciledDeliveryStates).toHaveLength(0);
    expect(repository.completedReconciliations).toHaveLength(1);
  });
});
