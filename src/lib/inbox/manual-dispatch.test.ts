import { describe, expect, it, vi } from "vitest";

import { ProviderOperationError } from "../messaging/errors";
import type { SmsProvider } from "../messaging/provider";
import { InboxProductError } from "./errors";
import {
  ManualMessageSender,
  type ManualDispatchClaim,
  type ManualDispatchRepository,
} from "./manual-dispatch";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function claim(
  overrides: Partial<ManualDispatchClaim> = {},
): ManualDispatchClaim {
  return {
    claimToken: "claim-1",
    contactId: "contact-1",
    dispatchState: "reserved",
    disposition: "claimed",
    estimatedSegments: 1,
    messageId: "message-1",
    reservationId: "reservation-1",
    workspaceId: "workspace-1",
    ...overrides,
  };
}

function repositoryMock(): ManualDispatchRepository {
  return {
    claimAndReserve: vi.fn().mockResolvedValue(claim()),
    finalValidateAndBeginProviderAttempt: vi.fn().mockResolvedValue({
      authorized: true,
      sendInput: {
        workspaceId: "workspace-1",
        messageId: "message-1",
        from: "+15125550101",
        to: "+15125550199",
        body: "Hello",
        idempotencyKey: "claim-1",
        statusCallbackUrl: "https://www.riink.app/api/webhooks/sms",
      },
    }),
    markAccepted: vi.fn().mockResolvedValue(undefined),
    markKnownFailureAndRelease: vi.fn().mockResolvedValue(undefined),
    markDispatchUnknown: vi.fn().mockResolvedValue(undefined),
  };
}

function providerMock(): SmsProvider {
  return {
    sendMessage: vi.fn().mockResolvedValue({
      providerMessageId: "provider-message-1",
      acceptedAt: NOW.toISOString(),
      status: "accepted",
    }),
    searchNumbers: vi.fn(),
    purchaseNumber: vi.fn(),
    releaseNumber: vi.fn(),
    getMessageStatus: vi.fn(),
    getMessageCost: vi.fn(),
    getActualSegments: vi.fn(),
    verifyWebhook: vi.fn(),
  };
}

const INPUT = {
  body: "Hello",
  contactId: "contact-1",
  phoneNumberId: "number-1",
  requestId: "request-1",
  workspaceId: "workspace-1",
};

describe("ManualMessageSender", () => {
  it("reserves, revalidates, fences, sends once, then persists acceptance", async () => {
    const repository = repositoryMock();
    const provider = providerMock();
    const sender = new ManualMessageSender(repository, provider, {
      now: () => NOW,
    });

    await expect(sender.send(INPUT)).resolves.toEqual({ messageId: "message-1" });
    expect(repository.claimAndReserve).toHaveBeenCalledWith({
      ...INPUT,
      body: "Hello",
      estimatedSegments: 1,
      now: NOW.toISOString(),
    });
    expect(repository.claimAndReserve).toHaveBeenCalledBefore(
      vi.mocked(repository.finalValidateAndBeginProviderAttempt),
    );
    expect(repository.finalValidateAndBeginProviderAttempt).toHaveBeenCalledBefore(
      vi.mocked(provider.sendMessage),
    );
    expect(provider.sendMessage).toHaveBeenCalledOnce();
    expect(repository.markAccepted).toHaveBeenCalledWith({
      claim: claim(),
      persistedAt: NOW.toISOString(),
      result: {
        providerMessageId: "provider-message-1",
        acceptedAt: NOW.toISOString(),
        status: "accepted",
      },
    });
  });

  it("returns an accepted replay without another provider call", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.claimAndReserve).mockResolvedValue(
      claim({ disposition: "already_claimed", dispatchState: "accepted" }),
    );
    const provider = providerMock();
    const sender = new ManualMessageSender(repository, provider);

    await expect(sender.send(INPUT)).resolves.toEqual({ messageId: "message-1" });
    expect(repository.finalValidateAndBeginProviderAttempt).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it("records an ambiguous result and never treats its replay as sendable", async () => {
    const repository = repositoryMock();
    const provider = providerMock();
    vi.mocked(provider.sendMessage).mockRejectedValue(
      new ProviderOperationError({
        operation: "sendMessage",
        kind: "ambiguous_result",
        providerCode: null,
        providerMessage: "result unavailable",
        providerResourceId: null,
        retryable: false,
      }),
    );
    const sender = new ManualMessageSender(repository, provider, {
      now: () => NOW,
    });

    await expect(sender.send(INPUT)).rejects.toMatchObject({
      canRetryWithNewRequest: false,
      code: "MESSAGE_SEND_FAILED",
    });
    expect(repository.markDispatchUnknown).toHaveBeenCalledWith({
      claim: claim(),
      failure: expect.objectContaining({ kind: "ambiguous_result" }),
      markedAt: NOW.toISOString(),
      providerMessageId: null,
      reason: "provider_result_ambiguous",
    });

    vi.mocked(repository.claimAndReserve).mockResolvedValue(
      claim({ disposition: "already_claimed", dispatchState: "dispatch_unknown" }),
    );
    await expect(sender.send(INPUT)).rejects.toBeInstanceOf(InboxProductError);
    expect(provider.sendMessage).toHaveBeenCalledOnce();
  });

  it("allows a fresh request only after a confirmed retryable pre-accept failure", async () => {
    const repository = repositoryMock();
    const provider = providerMock();
    vi.mocked(provider.sendMessage).mockRejectedValue(
      new ProviderOperationError({
        operation: "sendMessage",
        kind: "temporary",
        providerCode: "temporary",
        providerMessage: "temporarily unavailable",
        providerResourceId: null,
        retryable: true,
      }),
    );
    const sender = new ManualMessageSender(repository, provider, {
      now: () => NOW,
    });

    await expect(sender.send(INPUT)).rejects.toMatchObject({
      canRetryWithNewRequest: true,
      code: "MESSAGE_SEND_FAILED",
    });
    expect(repository.markKnownFailureAndRelease).toHaveBeenCalledOnce();
    expect(repository.markDispatchUnknown).not.toHaveBeenCalled();
  });

  it("allows a fresh request for a replay whose failure was already persisted", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.claimAndReserve).mockResolvedValue(
      claim({ disposition: "already_claimed", dispatchState: "failed" }),
    );
    const provider = providerMock();
    const sender = new ManualMessageSender(repository, provider);

    await expect(sender.send(INPUT)).rejects.toMatchObject({
      canRetryWithNewRequest: true,
      code: "MESSAGE_SEND_FAILED",
    });
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it("rechecks suppression immediately before the provider", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.finalValidateAndBeginProviderAttempt).mockResolvedValue({
      authorized: false,
      code: "contact_opted_out",
    });
    const provider = providerMock();
    const sender = new ManualMessageSender(repository, provider);

    await expect(sender.send(INPUT)).rejects.toMatchObject({
      code: "CONTACT_CANNOT_RECEIVE_MESSAGES",
    });
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it("releases a known pre-accept failure", async () => {
    const repository = repositoryMock();
    const provider = providerMock();
    const failure = new ProviderOperationError({
      operation: "sendMessage",
      kind: "invalid_recipient",
      providerCode: "invalid",
      providerMessage: "invalid destination",
      providerResourceId: null,
      retryable: false,
    });
    vi.mocked(provider.sendMessage).mockRejectedValue(failure);
    const sender = new ManualMessageSender(repository, provider, {
      now: () => NOW,
    });

    await expect(sender.send(INPUT)).rejects.toMatchObject({
      code: "CONTACT_CANNOT_RECEIVE_MESSAGES",
    });
    expect(repository.markKnownFailureAndRelease).toHaveBeenCalledWith({
      claim: claim(),
      failedAt: NOW.toISOString(),
      failure: failure.details,
    });
    expect(repository.markDispatchUnknown).not.toHaveBeenCalled();
  });

  it("fences post-provider persistence failure as dispatch unknown", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.markAccepted).mockRejectedValue(new Error("database down"));
    const provider = providerMock();
    const sender = new ManualMessageSender(repository, provider, {
      now: () => NOW,
    });

    await expect(sender.send(INPUT)).rejects.toMatchObject({
      canRetryWithNewRequest: false,
      code: "MESSAGE_SEND_FAILED",
    });
    expect(provider.sendMessage).toHaveBeenCalledOnce();
    expect(repository.markDispatchUnknown).toHaveBeenCalledWith({
      claim: claim(),
      failure: null,
      markedAt: NOW.toISOString(),
      providerMessageId: "provider-message-1",
      reason: "post_provider_persistence_failed",
    });
  });
});
