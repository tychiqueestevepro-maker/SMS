// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ConfiguredNumberService } from "./configured-number-service.server";
import type { ConfiguredNumberRepository } from "../numbers/configured-number-repository.server";
import type { TwilioConfiguredNumberConnector } from "../providers/twilio/existing-number";

function harness(disposition: "claimed" | "completed" = "claimed") {
  const repository = {
    claim: vi.fn().mockResolvedValue({
      disposition,
      operationId: disposition === "claimed" ? "operation-1" : "existing-operation",
      phoneNumberId: "number-1",
    }),
    complete: vi.fn().mockResolvedValue({ completed: true, phoneNumberId: "number-1" }),
    markUnknown: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConfiguredNumberRepository;
  const connector = {
    connect: vi.fn().mockResolvedValue({
      phoneNumber: "+33939245110",
      providerNumberId: "PNe5c6311d0e30ca70e0c49e923757e8e9",
      status: "active",
    }),
  } as unknown as TwilioConfiguredNumberConnector;
  const ensureWorkspaceReady = vi.fn().mockResolvedValue(undefined);
  const service = new ConfiguredNumberService(repository, connector, {
    applicationOrigin: "https://www.riink.app/path",
    ensureWorkspaceReady,
    now: () => new Date("2026-08-13T17:00:00.000Z"),
    operationId: () => "operation-1",
    providerName: "internal-provider",
  });
  return { connector, ensureWorkspaceReady, repository, service };
}

describe("ConfiguredNumberService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("moves the configured number and records it as ready", async () => {
    const test = harness();

    await expect(test.service.connect("workspace-1")).resolves.toEqual({
      phoneNumberId: "number-1",
    });
    expect(test.ensureWorkspaceReady).toHaveBeenCalledWith("workspace-1");
    expect(test.connector.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        inboundWebhookUrl: "https://www.riink.app/api/webhooks/sms",
        phoneNumber: "+33939245110",
        workspaceId: "workspace-1",
      }),
    );
    expect(test.repository.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        completedAt: "2026-08-13T17:00:00.000Z",
        operationId: "operation-1",
        workspaceId: "workspace-1",
      }),
    );
  });

  it("does not move a number that is already connected", async () => {
    const test = harness("completed");

    await expect(test.service.connect("workspace-1")).resolves.toEqual({
      phoneNumberId: "number-1",
    });
    expect(test.connector.connect).not.toHaveBeenCalled();
  });

  it("marks an ambiguous provider result for reconciliation", async () => {
    const test = harness();
    vi.mocked(test.connector.connect).mockRejectedValue(new Error("network interrupted"));

    await expect(test.service.connect("workspace-1")).rejects.toMatchObject({
      code: "PHONE_NUMBER_OPERATION_FAILED",
    });
    expect(test.repository.markUnknown).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "operation-1",
        providerMessage: "network interrupted",
        workspaceId: "workspace-1",
      }),
    );
  });
});
