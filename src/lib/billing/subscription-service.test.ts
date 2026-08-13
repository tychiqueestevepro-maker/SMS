import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BillingProviderError, type BillingGateway } from "./gateway";
import type { BillingRuntimeRepository } from "./runtime-repository";
import { BillingSubscriptionService } from "./subscription-service";

function fixtures() {
  const gateway = {
    scheduleSubscriptionCancellation: vi.fn(async () => ({
      cancelAtPeriodEnd: true,
    })),
  } as unknown as BillingGateway;
  const repository = {
    completeSubscriptionCancellation: vi.fn(async () => undefined),
    expireGracePeriods: vi.fn(async () => ({ expiredCount: 3 })),
    prepareSubscriptionCancellation: vi.fn(async () => ({
      cancellationRequestId: "cancel_request_1",
      state: "ready" as const,
      subscriptionId: "sub_1",
      workspaceId: "ws_1",
    })),
  } as unknown as BillingRuntimeRepository;
  const service = new BillingSubscriptionService(repository, gateway, {
    now: () => new Date("2026-08-10T12:00:00.000Z"),
  });
  return { gateway, repository, service };
}

describe("BillingSubscriptionService", () => {
  it("schedules cancellation idempotently and records the local transition", async () => {
    const { gateway, repository, service } = fixtures();

    await expect(service.requestCancellation("ws_1")).resolves.toEqual({
      alreadyScheduled: false,
    });
    expect(gateway.scheduleSubscriptionCancellation).toHaveBeenCalledWith({
      idempotencyKey: "billing-cancel:ws_1:sub_1",
      subscriptionId: "sub_1",
    });
    expect(repository.completeSubscriptionCancellation).toHaveBeenCalledWith({
      cancellationRequestId: "cancel_request_1",
      completedAt: "2026-08-10T12:00:00.000Z",
      subscriptionId: "sub_1",
      workspaceId: "ws_1",
    });
  });

  it("never sends a second cancellation request once it is completed", async () => {
    const { gateway, repository, service } = fixtures();
    vi.mocked(repository.prepareSubscriptionCancellation).mockResolvedValue({
      state: "completed",
    });

    await expect(service.requestCancellation("ws_1")).resolves.toEqual({
      alreadyScheduled: true,
    });
    expect(gateway.scheduleSubscriptionCancellation).not.toHaveBeenCalled();
  });

  it("expires seven-day grace states through one bounded atomic RPC", async () => {
    const { repository, service } = fixtures();

    await expect(service.expireGracePeriods(50)).resolves.toEqual({ expiredCount: 3 });
    expect(repository.expireGracePeriods).toHaveBeenCalledWith({
      limit: 50,
      now: "2026-08-10T12:00:00.000Z",
    });
  });

  it("never exposes a raw cancellation provider error", async () => {
    const { gateway, service } = fixtures();
    vi.mocked(gateway.scheduleSubscriptionCancellation).mockRejectedValue(
      new BillingProviderError({
        operation: "schedule_cancellation",
        providerCode: "raw_code",
        providerMessage: "raw provider cancellation detail",
      }),
    );

    const error = await service.requestCancellation("ws_1").catch(
      (failure: unknown) => failure,
    );
    expect(error).toMatchObject({
      code: "BILLING_CANCELLATION_FAILED",
      message: "Cancellation couldn't be scheduled. Please try again later.",
    });
    expect((error as Error).message).not.toContain("raw provider cancellation detail");
  });
});
