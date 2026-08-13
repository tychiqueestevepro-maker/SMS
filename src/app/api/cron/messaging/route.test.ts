// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAuthorized: vi.fn(),
  log: vi.fn(),
  runtime: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/logger", () => ({ logServerEvent: mocks.log }));
vi.mock("@/lib/runtime/cron-auth.server", () => ({
  isAuthorizedCronRequest: mocks.isAuthorized,
}));
vi.mock("@/lib/runtime/messaging.server", () => ({
  messagingRuntimeFromEnvironment: mocks.runtime,
}));

import { GET } from "./route";

describe("messaging cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthorized.mockReturnValue(true);
  });

  it("logs a stable failure code without recording the raw exception", async () => {
    const privateFailure = "provider credential and transport details";
    mocks.runtime.mockImplementation(() => {
      throw new Error(privateFailure);
    });

    const response = await GET(
      new Request("https://www.riink.app/api/cron/messaging", {
        headers: { authorization: "Bearer configured-secret" },
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Messaging maintenance couldn't be completed.",
    });
    expect(mocks.log).toHaveBeenCalledWith(
      "error",
      { event: "messaging_cron_failed" },
      { failure_code: "MESSAGING_MAINTENANCE_FAILED" },
    );
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(privateFailure);
  });
});
