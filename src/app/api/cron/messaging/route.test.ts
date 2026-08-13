// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAuthorized: vi.fn(),
  maintenance: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/runtime/cron-auth.server", () => ({
  isAuthorizedCronRequest: mocks.isAuthorized,
}));
vi.mock("@/lib/runtime/messaging-maintenance.server", () => ({
  runMessagingMaintenance: mocks.maintenance,
}));

import { GET } from "./route";

describe("messaging cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthorized.mockReturnValue(true);
    mocks.maintenance.mockResolvedValue({
      dispatched: 0,
      inboundReconciled: 0,
      reconciled: 0,
    });
  });

  it("keeps the protected route as an operator fallback", async () => {
    const response = await GET(
      new Request("https://www.riink.app/api/cron/messaging", {
        headers: { authorization: "Bearer configured-secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      dispatched: 0,
      inboundReconciled: 0,
      reconciled: 0,
    });
    expect(mocks.maintenance).toHaveBeenCalledTimes(1);
  });

  it("returns a neutral error without recording raw maintenance failures", async () => {
    mocks.maintenance.mockRejectedValue(
      new Error("provider credential and transport details"),
    );

    const response = await GET(
      new Request("https://www.riink.app/api/cron/messaging", {
        headers: { authorization: "Bearer configured-secret" },
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Messaging maintenance couldn't be completed.",
    });
  });

  it("rejects unauthorized fallback calls before maintenance", async () => {
    mocks.isAuthorized.mockReturnValue(false);

    const response = await GET(
      new Request("https://www.riink.app/api/cron/messaging"),
    );

    expect(response.status).toBe(401);
    expect(mocks.maintenance).not.toHaveBeenCalled();
  });
});
