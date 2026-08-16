// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BILLING_MAINTENANCE_CRON,
  handleScheduledBilling,
  handleScheduledMessaging,
  MESSAGING_MAINTENANCE_CRON,
  scheduledBillingMaintenance,
  scheduledMessagingMaintenance,
} from "./functions";

function stepRunner<T>() {
  return {
    run: vi.fn(async (_id: string, action: () => Promise<T>): Promise<T> =>
      action(),
    ),
  };
}

describe("Inngest maintenance functions", () => {
  it("polls messaging every minute and billing every hour", () => {
    expect(MESSAGING_MAINTENANCE_CRON).toBe("* * * * *");
    expect(BILLING_MAINTENANCE_CRON).toBe("0 * * * *");
    expect(scheduledMessagingMaintenance.opts).toMatchObject({
      concurrency: 1,
      retries: 2,
    });
    expect(scheduledBillingMaintenance.opts).toMatchObject({
      concurrency: 1,
      retries: 2,
    });
  });

  it("runs messaging directly and returns its bounded result", async () => {
    const run = vi.fn(async () => ({
      dispatched: 3,
      inboundReconciled: 2,
      reconciled: 1,
    }));

    await expect(handleScheduledMessaging(run)).resolves.toEqual({
      dispatched: 3,
      inboundReconciled: 2,
      reconciled: 1,
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("lets messaging failures escape so Inngest retries the function", async () => {
    const run = vi.fn(async () => {
      throw new Error("temporary failure");
    });

    await expect(handleScheduledMessaging(run)).rejects.toThrow(
      "temporary failure",
    );
  });

  it("runs billing as one durable step and lets retryable failures escape", async () => {
    const successfulStep = stepRunner<{ expiredGracePeriods: number }>();
    await expect(
      handleScheduledBilling(successfulStep, async () => ({
        expiredGracePeriods: 4,
      })),
    ).resolves.toEqual({ expiredGracePeriods: 4 });
    expect(successfulStep.run).toHaveBeenCalledTimes(1);

    const failedStep = stepRunner<{ expiredGracePeriods: number }>();
    await expect(
      handleScheduledBilling(failedStep, async () => {
        throw new Error("database unavailable");
      }),
    ).rejects.toThrow("database unavailable");
  });
});
