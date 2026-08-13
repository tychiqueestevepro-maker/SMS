import { describe, expect, it, vi } from "vitest";

import { ProviderOperationError } from "../messaging/errors";
import { SimulatedMessagingProvider } from "../providers/simulated/provider";
import {
  dispatchClaim,
  FIXED_NOW,
  MemoryDispatchRepository,
  successfulProvider,
  validFinalSnapshot,
} from "./test-fixtures";
import type { DispatchLogEvent } from "./types";
import { DispatchWorker } from "./worker";

function worker(
  repository: MemoryDispatchRepository,
  provider = successfulProvider(),
  logger?: (event: DispatchLogEvent) => void,
  workerId = "worker-1",
) {
  return new DispatchWorker(repository, provider, {
    workerId,
    now: () => FIXED_NOW,
    logger,
  });
}

describe("provider-neutral dispatch worker", () => {
  it("lets two workers race while only one claim reaches the provider", async () => {
    const repository = new MemoryDispatchRepository({
      dispatchClaims: [dispatchClaim()],
    });
    const provider = successfulProvider();
    const send = vi.spyOn(provider, "sendMessage");

    const results = await Promise.all([
      worker(repository, provider, undefined, "worker-a").runOnce(),
      worker(repository, provider, undefined, "worker-b").runOnce(),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "accepted",
      "idle",
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(repository.accepted).toHaveLength(1);
    expect(repository.begunProviderAttempts).toEqual(["message-1"]);
  });

  it("catches a deleted-campaign race during final validation", async () => {
    const repository = new MemoryDispatchRepository({
      dispatchClaims: [dispatchClaim()],
    });
    repository.validationSnapshot = validFinalSnapshot({
      campaignActive: false,
    });
    const provider = successfulProvider();
    const send = vi.spyOn(provider, "sendMessage");

    await expect(worker(repository, provider).runOnce()).resolves.toEqual({
      outcome: "blocked",
      messageId: "message-1",
      reason: "campaign_inactive",
    });
    expect(send).not.toHaveBeenCalled();
    expect(repository.validationReleases).toEqual(["reservation-1"]);
  });

  it("catches an opt-out race during final validation", async () => {
    const repository = new MemoryDispatchRepository({
      dispatchClaims: [dispatchClaim()],
    });
    repository.validationSnapshot = validFinalSnapshot({ suppressed: true });
    const provider = successfulProvider();
    const send = vi.spyOn(provider, "sendMessage");

    await expect(worker(repository, provider).runOnce()).resolves.toMatchObject({
      outcome: "blocked",
      reason: "suppressed",
    });
    expect(send).not.toHaveBeenCalled();
    expect(repository.validationReleases).toEqual(["reservation-1"]);
  });

  it("blocks at the safety cap before making a provider call", async () => {
    const repository = new MemoryDispatchRepository({
      dispatchClaims: [dispatchClaim()],
    });
    repository.validationSnapshot = validFinalSnapshot({
      actualOutboundSegments: 10_000,
      reservedOutboundSegments: 1,
    });
    const provider = successfulProvider();
    const send = vi.spyOn(provider, "sendMessage");

    await expect(worker(repository, provider).runOnce()).resolves.toMatchObject({
      outcome: "blocked",
      reason: "safety_cap_reached",
    });
    expect(send).not.toHaveBeenCalled();
    expect(repository.validationReleases).toEqual(["reservation-1"]);
  });

  it("persists an accepted provider result exactly once", async () => {
    const repository = new MemoryDispatchRepository({
      dispatchClaims: [dispatchClaim()],
    });
    const provider = successfulProvider();
    const send = vi.spyOn(provider, "sendMessage");
    const dispatchWorker = worker(repository, provider);

    const first = await dispatchWorker.runOnce();
    const second = await dispatchWorker.runOnce();

    expect(first).toMatchObject({ outcome: "accepted", messageId: "message-1" });
    expect(second).toEqual({ outcome: "idle" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(repository.accepted).toHaveLength(1);
    expect(repository.knownFailures).toHaveLength(0);
    expect(repository.unknown).toHaveLength(0);
  });

  it("makes an ambiguous result terminal, stops the recipient, and never retries", async () => {
    const repository = new MemoryDispatchRepository({
      dispatchClaims: [dispatchClaim()],
    });
    const provider = successfulProvider();
    const send = vi
      .spyOn(provider, "sendMessage")
      .mockRejectedValue(
        new ProviderOperationError({
          operation: "sendMessage",
          kind: "ambiguous_result",
          providerCode: null,
          providerMessage: "connection ended without a response",
          providerResourceId: null,
          retryable: false,
        }),
      );
    const dispatchWorker = worker(repository, provider);

    await expect(dispatchWorker.runOnce()).resolves.toEqual({
      outcome: "dispatch_unknown",
      messageId: "message-1",
      reason: "provider_result_ambiguous",
    });
    await expect(dispatchWorker.runOnce()).resolves.toEqual({ outcome: "idle" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(repository.unknown).toHaveLength(1);
    expect(repository.unknown[0]).toMatchObject({
      reason: "provider_result_ambiguous",
      providerMessageId: null,
    });
    expect(repository.knownFailures).toHaveLength(0);
  });

  it("treats an untyped provider exception as ambiguous", async () => {
    const repository = new MemoryDispatchRepository({
      dispatchClaims: [dispatchClaim()],
    });
    const provider = successfulProvider();
    vi.spyOn(provider, "sendMessage").mockRejectedValue(new Error("socket closed"));

    await expect(worker(repository, provider).runOnce()).resolves.toMatchObject({
      outcome: "dispatch_unknown",
      reason: "provider_result_ambiguous",
    });
    expect(repository.unknown[0]?.failure?.kind).toBe("unknown");
  });

  it("releases a reservation after a known pre-accept failure", async () => {
    const repository = new MemoryDispatchRepository({
      dispatchClaims: [dispatchClaim()],
    });
    const provider = new SimulatedMessagingProvider({
      failureFor: (operation) =>
        operation === "sendMessage"
          ? {
              kind: "invalid_recipient",
              providerCode: "INVALID_DESTINATION",
              providerMessage: "Destination cannot receive messages",
              providerResourceId: null,
              retryable: false,
            }
          : null,
    });

    await expect(worker(repository, provider).runOnce()).resolves.toEqual({
      outcome: "known_failed",
      messageId: "message-1",
      failureKind: "invalid_recipient",
    });
    expect(repository.knownFailures).toHaveLength(1);
    expect(repository.unknown).toHaveLength(0);
  });

  it("falls back to dispatch_unknown when accepted persistence fails", async () => {
    const repository = new MemoryDispatchRepository({
      dispatchClaims: [dispatchClaim()],
    });
    repository.failMarkAccepted = true;
    const provider = successfulProvider();
    const send = vi.spyOn(provider, "sendMessage");

    await expect(worker(repository, provider).runOnce()).resolves.toEqual({
      outcome: "dispatch_unknown",
      messageId: "message-1",
      reason: "post_provider_persistence_failed",
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(repository.accepted).toHaveLength(0);
    expect(repository.unknown[0]).toMatchObject({
      reason: "post_provider_persistence_failed",
      providerMessageId: "sim-message-000001",
    });
  });

  it("emits correlation logs without message content or phone numbers", async () => {
    const repository = new MemoryDispatchRepository({
      dispatchClaims: [dispatchClaim()],
    });
    const events: DispatchLogEvent[] = [];
    await worker(repository, successfulProvider(), (event) => events.push(event)).runOnce();

    expect(events.map((event) => event.event)).toEqual([
      "dispatch_claimed",
      "provider_send_started",
      "provider_send_accepted",
    ]);
    expect(events[2]).toMatchObject({
      workspace_id: "workspace-1",
      campaign_id: "campaign-1",
      campaign_recipient_id: "recipient-1",
      contact_id: "contact-1",
      message_id: "message-1",
      provider_message_id: "sim-message-000001",
      dispatch_state: "accepted",
      timestamp: FIXED_NOW.toISOString(),
    });
    expect(JSON.stringify(events)).not.toContain("Hello from Riink");
    expect(JSON.stringify(events)).not.toContain("+12025550199");
  });
});

