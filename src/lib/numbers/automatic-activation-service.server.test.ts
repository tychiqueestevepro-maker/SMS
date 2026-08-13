// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductBillingError } from "@/lib/billing/gateway";

import type { AutomaticNumberActivationRepository } from "./automatic-activation-repository";
import { AutomaticNumberActivationService } from "./automatic-activation-service.server";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-08-13T16:00:00.000Z");
const PERIOD_START = "2026-08-13T16:00:00.000Z";
const PERIOD_END = "2026-09-13T16:00:00.000Z";

describe("AutomaticNumberActivationService", () => {
  const repository = {
    claimPurchasedNumber: vi.fn(),
    completePurchasedNumber: vi.fn(),
    failPurchasedNumber: vi.fn(),
  } satisfies AutomaticNumberActivationRepository;
  const ensureSubscription = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    repository.claimPurchasedNumber.mockResolvedValue({
      activationId: "activation-1",
      disposition: "claimed",
      numberId: "number-1",
      workspaceId: "workspace-1",
    });
    repository.completePurchasedNumber.mockResolvedValue(undefined);
    repository.failPurchasedNumber.mockResolvedValue(undefined);
    ensureSubscription.mockResolvedValue({
      active: true,
      periodEndsAt: PERIOD_END,
      periodStartsAt: PERIOD_START,
      subscriptionId: "sub-1",
    });
  });

  function service() {
    return new AutomaticNumberActivationService(repository, ensureSubscription, {
      now: () => NOW,
    });
  }

  it("checks the completed provider purchase before starting billing", async () => {
    await expect(
      service().activate({ numberId: "number-1", workspaceId: "workspace-1" }),
    ).resolves.toEqual({
      alreadyReady: false,
      numberId: "number-1",
      subscriptionId: "sub-1",
      workspaceId: "workspace-1",
    });

    expect(repository.claimPurchasedNumber).toHaveBeenCalledWith({
      numberId: "number-1",
      requestedAt: NOW.toISOString(),
      workspaceId: "workspace-1",
    });
    expect(repository.claimPurchasedNumber.mock.invocationCallOrder[0]).toBeLessThan(
      ensureSubscription.mock.invocationCallOrder[0]!,
    );
    expect(ensureSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      repository.completePurchasedNumber.mock.invocationCallOrder[0]!,
    );
    expect(repository.completePurchasedNumber).toHaveBeenCalledWith({
      activationId: "activation-1",
      completedAt: NOW.toISOString(),
      numberId: "number-1",
      periodEndsAt: PERIOD_END,
      periodStartsAt: PERIOD_START,
      subscriptionId: "sub-1",
      workspaceId: "workspace-1",
    });
  });

  it("does not start billing when the provider purchase is not confirmed", async () => {
    repository.claimPurchasedNumber.mockResolvedValue({
      activationId: null,
      disposition: "provider_not_ready",
      numberId: "number-1",
      workspaceId: "workspace-1",
    });

    await expect(
      service().activate({ numberId: "number-1", workspaceId: "workspace-1" }),
    ).rejects.toMatchObject({
      code: "PHONE_NUMBER_NOT_READY",
    });
    expect(ensureSubscription).not.toHaveBeenCalled();
    expect(repository.completePurchasedNumber).not.toHaveBeenCalled();
  });

  it("keeps the number pending and records a retryable failure when billing fails", async () => {
    ensureSubscription.mockRejectedValue(
      new ProductBillingError("BILLING_ACTIVATION_FAILED"),
    );

    await expect(
      service().activate({ numberId: "number-1", workspaceId: "workspace-1" }),
    ).rejects.toMatchObject({
      code: "BILLING_ACTIVATION_FAILED",
    });
    expect(repository.completePurchasedNumber).not.toHaveBeenCalled();
    expect(repository.failPurchasedNumber).toHaveBeenCalledWith({
      activationId: "activation-1",
      failedAt: NOW.toISOString(),
      failureCode: "BILLING_ACTIVATION_FAILED",
      numberId: "number-1",
      workspaceId: "workspace-1",
    });
  });
});
