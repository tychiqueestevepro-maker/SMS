import { describe, expect, it, vi } from "vitest";

import type { SmsProvider } from "../messaging/provider";
import {
  InboundMessageReconciler,
  type InboundReconciliationClaim,
  type InboundReconciliationRepository,
} from "./inbound-reconciliation";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function claim(
  overrides: Partial<InboundReconciliationClaim> = {},
): InboundReconciliationClaim {
  return {
    attemptCount: 1,
    billingPeriodId: "period-1",
    messageId: "message-1",
    providerMessageId: "provider-message-1",
    reconciliationToken: "token-1",
    workspaceId: "workspace-1",
    ...overrides,
  };
}

function repositoryMock(
  nextClaim: InboundReconciliationClaim | null = claim(),
): InboundReconciliationRepository {
  return {
    claimNext: vi.fn().mockResolvedValue(nextClaim),
    complete: vi.fn().mockResolvedValue(undefined),
    defer: vi.fn().mockResolvedValue(undefined),
  };
}

function providerMock(): SmsProvider {
  return {
    sendMessage: vi.fn(),
    searchNumbers: vi.fn(),
    purchaseNumber: vi.fn(),
    releaseNumber: vi.fn(),
    getMessageStatus: vi.fn(),
    getMessageCost: vi.fn().mockResolvedValue({
      providerMessageId: "provider-message-1",
      amountMicroUsd: 7_500,
      currency: "USD",
    }),
    getActualSegments: vi.fn().mockResolvedValue({
      providerMessageId: "provider-message-1",
      numSegments: 2,
    }),
    verifyWebhook: vi.fn(),
  };
}

describe("InboundMessageReconciler", () => {
  it("stores actual inbound segments and cost without any customer-allocation input", async () => {
    const repository = repositoryMock();
    const reconciler = new InboundMessageReconciler(
      repository,
      providerMock(),
      { workerId: "worker-1", now: () => NOW },
    );

    await expect(reconciler.runOnce()).resolves.toEqual({
      outcome: "reconciled",
      messageId: "message-1",
      actualSegments: 2,
      providerCostPending: false,
    });
    expect(repository.complete).toHaveBeenCalledWith({
      actualSegments: 2,
      claim: claim(),
      providerCostMicroUsd: 7_500,
      providerCostPending: false,
      reconciledAt: NOW.toISOString(),
    });
    expect(Object.keys(vi.mocked(repository.complete).mock.calls[0]![0])).not.toEqual(
      expect.arrayContaining(["includedSegments", "overageSegments"]),
    );
  });

  it("persists partial observations and leaves missing cost pending", async () => {
    const repository = repositoryMock();
    const provider = providerMock();
    vi.mocked(provider.getMessageCost).mockResolvedValue({
      providerMessageId: "provider-message-1",
      amountMicroUsd: null,
      currency: "USD",
    });
    const reconciler = new InboundMessageReconciler(repository, provider, {
      workerId: "worker-1",
      now: () => NOW,
    });

    await expect(reconciler.runOnce()).resolves.toMatchObject({
      outcome: "reconciled",
      actualSegments: 2,
      providerCostPending: true,
    });
    expect(repository.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        actualSegments: 2,
        providerCostMicroUsd: null,
        providerCostPending: true,
      }),
    );
  });

  it("defers with bounded backoff when both lookups fail", async () => {
    const currentClaim = claim({ attemptCount: 4 });
    const repository = repositoryMock(currentClaim);
    const provider = providerMock();
    vi.mocked(provider.getActualSegments).mockRejectedValue(new Error("down"));
    vi.mocked(provider.getMessageCost).mockRejectedValue(new Error("down"));
    const reconciler = new InboundMessageReconciler(repository, provider, {
      workerId: "worker-1",
      now: () => NOW,
    });

    await expect(reconciler.runOnce()).resolves.toEqual({
      outcome: "deferred",
      messageId: "message-1",
      reason: "provider_lookup_failed",
    });
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.defer).toHaveBeenCalledWith({
      claim: currentClaim,
      deferredAt: NOW.toISOString(),
      errorCode: "provider_lookup_failed",
      nextAttemptAt: "2026-08-10T12:40:00.000Z",
    });
  });

  it("rejects mismatched provider response correlation", async () => {
    const repository = repositoryMock();
    const provider = providerMock();
    vi.mocked(provider.getActualSegments).mockResolvedValue({
      providerMessageId: "different-message",
      numSegments: 1,
    });
    const reconciler = new InboundMessageReconciler(repository, provider, {
      workerId: "worker-1",
      now: () => NOW,
    });

    await expect(reconciler.runOnce()).resolves.toMatchObject({
      outcome: "deferred",
      reason: "invalid_segments_response",
    });
    expect(repository.complete).not.toHaveBeenCalled();
  });
});
