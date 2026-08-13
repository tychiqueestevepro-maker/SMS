// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  serviceFactory: vi.fn(),
}));

vi.mock("@/lib/billing/cron-http.server", () => ({
  processBillingCronRequest: mocks.process,
}));
vi.mock("@/lib/runtime/billing-webhook.server", () => ({
  billingSubscriptionServiceFromEnvironment: mocks.serviceFactory,
}));

import { GET, maxDuration, runtime } from "./route";

describe("billing cron route", () => {
  it("delegates authorization and maintenance to the hardened handler lazily", async () => {
    const expected = Response.json({ expiredGracePeriods: 0 });
    mocks.process.mockResolvedValue(expected);
    const request = new Request("https://www.riink.app/api/cron/billing", {
      headers: { authorization: "Bearer secret" },
    });

    await expect(GET(request)).resolves.toBe(expected);
    expect(mocks.process).toHaveBeenCalledWith(request, {
      service: mocks.serviceFactory,
    });
    expect(mocks.serviceFactory).not.toHaveBeenCalled();
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(30);
  });
});
