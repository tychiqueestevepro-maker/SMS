// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/logger", () => ({ logServerEvent: vi.fn() }));

import { logServerEvent } from "@/lib/observability/logger";

import { processBillingCronRequest } from "./cron-http.server";

function request(authorization?: string) {
  return new Request("https://www.riink.app/api/cron/billing", {
    headers: authorization ? { authorization } : {},
  });
}

describe("processBillingCronRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthorized requests before touching billing state", async () => {
    const expireGracePeriods = vi.fn();
    const response = await processBillingCronRequest(
      request("Bearer wrong"),
      { service: () => ({ expireGracePeriods }) },
      "expected",
    );

    expect(response.status).toBe(401);
    expect(expireGracePeriods).not.toHaveBeenCalled();
  });

  it("expires grace periods through one bounded idempotent RPC service call", async () => {
    const expireGracePeriods = vi.fn(async () => ({ expiredCount: 4 }));
    const response = await processBillingCronRequest(
      request("Bearer expected"),
      { service: () => ({ expireGracePeriods }) },
      "expected",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ expiredGracePeriods: 4 });
    expect(expireGracePeriods).toHaveBeenCalledWith(250);
    expect(logServerEvent).toHaveBeenCalledWith(
      "info",
      { event: "billing_cron_completed" },
      { expired_grace_periods: 4 },
    );
  });

  it("returns a neutral retryable response and never serializes raw errors", async () => {
    const expireGracePeriods = vi.fn(async () => {
      throw new Error("raw database detail");
    });
    const response = await processBillingCronRequest(
      request("Bearer expected"),
      { service: () => ({ expireGracePeriods }) },
      "expected",
    );

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("raw database detail");
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      { event: "billing_cron_failed" },
      { failure_code: "billing_maintenance_failed" },
    );
  });
});
