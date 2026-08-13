// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ProductBillingError } from "@/lib/billing/gateway";

import type { AdminNumberActivationRepository } from "./admin-activation-repository";
import {
  AdminNumberActivationError,
  AdminNumberActivationService,
} from "./admin-activation-service.server";

const NOW = "2026-08-10T12:00:00.000Z";

function fixtures() {
  const repository: AdminNumberActivationRepository = {
    claimApprovedNumber: vi.fn(async () => ({
      activationId: "activation_1",
      disposition: "claimed" as const,
      numberId: "number_1",
      workspaceId: "workspace_1",
    })),
    completeApprovedNumber: vi.fn(async () => undefined),
    failApprovedNumber: vi.fn(async () => undefined),
  };
  const ensureSubscription = vi.fn(async () => ({
    active: true as const,
    periodEndsAt: "2026-09-10T12:00:00.000Z",
    periodStartsAt: NOW,
    subscriptionId: "subscription_1",
  }));
  const service = new AdminNumberActivationService(
    repository,
    ensureSubscription,
    { now: () => new Date(NOW) },
  );
  return { ensureSubscription, repository, service };
}

describe("AdminNumberActivationService", () => {
  it("marks only the claimed approved number Ready after active billing is persisted", async () => {
    const { ensureSubscription, repository, service } = fixtures();

    await expect(service.activate({
      adminUserId: "admin_1",
      numberId: "number_1",
    })).resolves.toEqual({
      alreadyReady: false,
      numberId: "number_1",
      subscriptionId: "subscription_1",
      workspaceId: "workspace_1",
    });
    expect(ensureSubscription).toHaveBeenCalledWith("workspace_1");
    expect(repository.completeApprovedNumber).toHaveBeenCalledWith({
      activationId: "activation_1",
      adminUserId: "admin_1",
      completedAt: NOW,
      numberId: "number_1",
      periodEndsAt: "2026-09-10T12:00:00.000Z",
      periodStartsAt: NOW,
      subscriptionId: "subscription_1",
      workspaceId: "workspace_1",
    });
    expect(repository.failApprovedNumber).not.toHaveBeenCalled();
  });

  it("reuses an already active subscription for a later number", async () => {
    const { ensureSubscription, repository, service } = fixtures();
    ensureSubscription.mockResolvedValue({
      active: true,
      periodEndsAt: "2026-09-10T12:00:00.000Z",
      periodStartsAt: NOW,
      subscriptionId: "subscription_existing",
    });

    await service.activate({ adminUserId: "admin_1", numberId: "number_1" });
    expect(ensureSubscription).toHaveBeenCalledTimes(1);
    expect(repository.completeApprovedNumber).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "subscription_existing" }),
    );
  });

  it("does not touch billing when setup approval is missing", async () => {
    const { ensureSubscription, repository, service } = fixtures();
    vi.mocked(repository.claimApprovedNumber).mockResolvedValue({
      activationId: null,
      disposition: "not_approved",
      numberId: "number_1",
      workspaceId: "workspace_1",
    });

    await expect(service.activate({
      adminUserId: "admin_1",
      numberId: "number_1",
    })).rejects.toMatchObject({ code: "NUMBER_NOT_APPROVED" });
    expect(ensureSubscription).not.toHaveBeenCalled();
    expect(repository.completeApprovedNumber).not.toHaveBeenCalled();
    expect(repository.failApprovedNumber).not.toHaveBeenCalled();
  });

  it("keeps the number Pending and records a safe code when billing fails", async () => {
    const { ensureSubscription, repository, service } = fixtures();
    ensureSubscription.mockRejectedValue(
      new ProductBillingError("BILLING_ACTIVATION_FAILED"),
    );

    const error = await service.activate({
      adminUserId: "admin_1",
      numberId: "number_1",
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AdminNumberActivationError);
    expect(error).toMatchObject({
      code: "NUMBER_ACTIVATION_FAILED",
      message: "The phone number couldn't be activated. It remains Pending.",
    });
    expect(repository.completeApprovedNumber).not.toHaveBeenCalled();
    expect(repository.failApprovedNumber).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "BILLING_ACTIVATION_FAILED" }),
    );
  });

  it("fails closed if the subscription period is missing or invalid", async () => {
    const { ensureSubscription, repository, service } = fixtures();
    ensureSubscription.mockResolvedValue({
      active: true,
      periodEndsAt: NOW,
      periodStartsAt: NOW,
      subscriptionId: "subscription_1",
    });

    await expect(service.activate({
      adminUserId: "admin_1",
      numberId: "number_1",
    })).rejects.toMatchObject({ code: "NUMBER_ACTIVATION_FAILED" });
    expect(repository.completeApprovedNumber).not.toHaveBeenCalled();
    expect(repository.failApprovedNumber).toHaveBeenCalledTimes(1);
  });

  it("returns safely without another subscription operation when already Ready", async () => {
    const { ensureSubscription, repository, service } = fixtures();
    vi.mocked(repository.claimApprovedNumber).mockResolvedValue({
      activationId: null,
      disposition: "already_ready",
      numberId: "number_1",
      workspaceId: "workspace_1",
    });

    await expect(service.activate({
      adminUserId: "admin_1",
      numberId: "number_1",
    })).resolves.toMatchObject({ alreadyReady: true, subscriptionId: null });
    expect(ensureSubscription).not.toHaveBeenCalled();
  });
});
