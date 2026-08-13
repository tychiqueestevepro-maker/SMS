import { describe, expect, it, vi } from "vitest";

import { calculateCampaignStatistics } from "../../campaigns/statistics";
import { DispatchWorker } from "../../dispatch/worker";
import {
  dispatchClaim,
  MemoryDispatchRepository,
  successfulProvider,
  validFinalSnapshot,
} from "../../dispatch/test-fixtures";
import { groupInboxConversations } from "../../inbox/conversations";
import {
  SMS_WEBHOOK_ACKNOWLEDGEMENT,
  SmsWebhookOrchestrator,
} from "./orchestrator";
import {
  CONTACT_NUMBER,
  inboundEvent,
  MemorySmsWebhookRepository,
  RIINK_NUMBER,
  statusEvent,
  WEBHOOK_NOW,
  webhookProvider,
  webhookRequest,
} from "./test-fixtures";

function orchestrator(
  repository: MemorySmsWebhookRepository,
  provider = webhookProvider(),
) {
  return new SmsWebhookOrchestrator(repository, provider, {
    now: () => WEBHOOK_NOW,
  });
}

function existingContact(deletedAt: string | null = null) {
  return {
    id: "contact-existing",
    phoneE164: CONTACT_NUMBER,
    deletedAt,
    hasUnreadMessages: false,
  };
}

function relevantOutbound(overrides: Record<string, unknown> = {}) {
  return {
    id: "outbound-1",
    contactId: "contact-existing",
    phoneNumberId: "number-1",
    campaignId: "campaign-1",
    campaignRecipientId: "recipient-1",
    dispatchState: "accepted" as const,
    deliveryState: null,
    acceptedAt: "2026-08-10T11:00:00.000Z",
    ...overrides,
  };
}

describe("provider-neutral SMS webhook orchestration", () => {
  it("resolves the workspace server-side and verifies the signature before mutation", async () => {
    const repository = new MemorySmsWebhookRepository();
    repository.contacts.push(existingContact());
    const provider = webhookProvider();
    const verify = vi.spyOn(provider, "verifyWebhook").mockImplementation(async (input) => {
      repository.operationOrder.push("verify");
      return { valid: input.signature === "valid-signature" };
    });

    await expect(
      orchestrator(repository, provider).handle(webhookRequest()),
    ).resolves.toBe(SMS_WEBHOOK_ACKNOWLEDGEMENT);
    expect(repository.resolvedRoutingKeys).toEqual([
      { kind: "inbound_number", value: RIINK_NUMBER },
    ]);
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1" }),
    );
    expect(repository.operationOrder).toEqual(["verify", "transaction"]);
  });

  it("acknowledges an invalid signature without processing or usage lookup", async () => {
    const repository = new MemorySmsWebhookRepository();
    const provider = webhookProvider();
    const segments = vi.spyOn(provider, "getActualSegments");

    const response = await orchestrator(repository, provider).handle(
      webhookRequest(inboundEvent(), "invalid-signature"),
    );
    expect(response).toEqual({ received: true });
    expect(Object.keys(response)).toEqual(["received"]);
    expect(repository.transactionAttempts).toBe(0);
    expect(segments).not.toHaveBeenCalled();
  });

  it("deduplicates an inbound event transactionally", async () => {
    const repository = new MemorySmsWebhookRepository();
    repository.contacts.push(existingContact());
    const handler = orchestrator(repository);
    const request = webhookRequest();

    await handler.handle(request);
    await handler.handle(request);

    expect(repository.transactionAttempts).toBe(2);
    expect(repository.transactionProcesses).toBe(1);
    expect(repository.inboundMessages).toHaveLength(1);
  });

  it("creates an unknown contact minimally in the default stage", async () => {
    const repository = new MemorySmsWebhookRepository();
    repository.defaultPipelineStageId = "stage-default";

    await orchestrator(repository).handle(webhookRequest());

    expect(repository.createdContacts).toEqual([
      {
        contactId: "contact-1",
        phoneE164: CONTACT_NUMBER,
        pipelineStageId: "stage-default",
        firstName: "",
        lastName: "",
        company: "",
      },
    ]);
    expect(repository.inboundMessages[0]?.contactId).toBe("contact-1");
  });

  it("reuses a soft-deleted contact without restoring it", async () => {
    const repository = new MemorySmsWebhookRepository();
    const deletedAt = "2026-07-01T00:00:00.000Z";
    repository.contacts.push(existingContact(deletedAt));

    await orchestrator(repository).handle(webhookRequest());

    expect(repository.createdContacts).toHaveLength(0);
    expect(repository.inboundMessages[0]?.contactId).toBe("contact-existing");
    expect(repository.contacts[0]?.deletedAt).toBe(deletedAt);
    expect(
      groupInboxConversations(
        [
          {
            id: repository.inboundMessages[0]!.id,
            contactId: "contact-existing",
            phoneNumberId: "number-1",
            direction: "inbound",
            body: "Interested",
            occurredAt: WEBHOOK_NOW.toISOString(),
            deliveryStatus: "delivered",
          },
        ],
        [
          {
            ...existingContact(deletedAt),
            firstName: "Old",
            lastName: "MacDonald",
            company: "",
            jobTitle: "",
            notes: "",
            isSuppressed: false,
          },
        ],
        [
          {
            id: "number-1",
            phoneNumber: RIINK_NUMBER,
            status: "ready",
          },
        ],
      )[0],
    ).toMatchObject({ contactLabel: "Deleted contact", readOnly: true });
  });

  it("records inbound usage as provider cost but always zero customer charge", async () => {
    const repository = new MemorySmsWebhookRepository();
    repository.contacts.push(existingContact());

    await orchestrator(
      repository,
      webhookProvider({ segments: 3, costMicroUsd: 24_000 }),
    ).handle(webhookRequest());

    expect(repository.inboundMessages[0]?.usage).toEqual({
      direction: "inbound",
      numSegments: 3,
      providerCostMicroUsd: 24_000,
      includedSegments: 0,
      overageSegments: 0,
      customerBillableAmountMicroUsd: 0,
    });
  });

  it.each(["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"])(
    "suppresses and stops active recipients for %s",
    async (keyword) => {
      const repository = new MemorySmsWebhookRepository();
      repository.contacts.push(existingContact());

      await orchestrator(repository).handle(
        webhookRequest(inboundEvent({ body: keyword })),
      );

      expect(repository.suppressedPhoneNumbers.has(CONTACT_NUMBER)).toBe(true);
      expect(repository.activeRecipient).toBe(false);
      expect(repository.reservationActive).toBe(false);
      expect(repository.recipientStopReason).toBe("opt_out");
    },
  );

  it("does not remove suppression for an unconfirmed START", async () => {
    const repository = new MemorySmsWebhookRepository();
    repository.contacts.push(existingContact());
    repository.suppressedPhoneNumbers.add(CONTACT_NUMBER);

    await orchestrator(repository).handle(
      webhookRequest(inboundEvent({ body: "START", confirmedConsent: null })),
    );

    expect(repository.suppressedPhoneNumbers.has(CONTACT_NUMBER)).toBe(true);
    expect(repository.resumeCount).toBe(0);
  });

  it.each(["START", "UNSTOP"])(
    "removes suppression only after confirmed %s and never resumes a campaign",
    async (keyword) => {
      const repository = new MemorySmsWebhookRepository();
      repository.contacts.push(existingContact());
      repository.suppressedPhoneNumbers.add(CONTACT_NUMBER);
      repository.activeRecipient = false;

      await orchestrator(repository).handle(
        webhookRequest(
          inboundEvent({ body: keyword, confirmedConsent: "opt_in" }),
        ),
      );

      expect(repository.suppressedPhoneNumbers.has(CONTACT_NUMBER)).toBe(false);
      expect(repository.activeRecipient).toBe(false);
      expect(repository.resumeCount).toBe(0);
    },
  );

  it("applies a late Failed state, recalculates reply-rate eligibility, and retains consumed usage", async () => {
    const repository = new MemorySmsWebhookRepository();
    repository.context = {
      workspaceId: "workspace-1",
      phoneNumberId: "number-1",
      messageId: "message-1",
      campaignId: "campaign-1",
      campaignRecipientId: "recipient-1",
      contactId: "contact-existing",
    };
    const request = webhookRequest(statusEvent({ status: "failed" }));
    const handler = orchestrator(
      repository,
      webhookProvider({ segments: 2, costMicroUsd: 16_000 }),
    );

    await handler.handle(request);
    await handler.handle(request);

    expect(repository.deliveryUpdates).toEqual([
      expect.objectContaining({
        deliveryState: "failed",
        providerStatus: "failed",
      }),
    ]);
    expect(repository.usageReconciliations).toEqual([
      expect.objectContaining({
        actualSegments: 2,
        providerCostMicroUsd: 16_000,
      }),
    ]);
    expect(repository.transactionProcesses).toBe(1);
    expect(
      calculateCampaignStatistics(
        [
          {
            id: "recipient-1",
            state: "stopped",
            hasPendingStep: false,
            repliedAt: null,
          },
        ],
        [
          {
            campaignRecipientId: "recipient-1",
            dispatchState: "accepted",
            deliveryState: repository.deliveryUpdates[0]!.deliveryState,
            acceptedAt: "2026-08-10T11:00:00.000Z",
          },
        ],
      ).sentRecipients,
    ).toBe(0);
  });

  it("associates the last relevant outbound on the same contact and Riink number", async () => {
    const repository = new MemorySmsWebhookRepository();
    repository.contacts.push(existingContact());
    repository.outbounds.push(
      relevantOutbound({
        id: "right-older",
        acceptedAt: "2026-08-10T10:00:00.000Z",
      }),
      relevantOutbound({
        id: "wrong-number-newer",
        phoneNumberId: "number-2",
        acceptedAt: "2026-08-10T11:50:00.000Z",
      }),
      relevantOutbound({
        id: "failed-newer",
        deliveryState: "failed",
        acceptedAt: "2026-08-10T11:55:00.000Z",
      }),
    );

    await orchestrator(repository).handle(webhookRequest());

    expect(repository.attachments[0]).toMatchObject({
      inboundMessageId: "inbound-1",
      association: { outboundMessageId: "right-older" },
    });
  });

  it("wins a reply race by stopping the recipient before dispatch final validation", async () => {
    const webhookRepository = new MemorySmsWebhookRepository();
    webhookRepository.contacts.push(existingContact());
    webhookRepository.outbounds.push(relevantOutbound());
    // The outbound has already been reserved when the reply arrives.
    expect(webhookRepository.reservationActive).toBe(true);

    await orchestrator(webhookRepository).handle(webhookRequest());
    expect(webhookRepository.recipientStopReason).toBe("reply");
    expect(webhookRepository.reservationActive).toBe(false);

    const dispatchRepository = new MemoryDispatchRepository({
      dispatchClaims: [dispatchClaim()],
    });
    dispatchRepository.validationSnapshot = validFinalSnapshot({
      recipientActive: webhookRepository.activeRecipient,
      reservationValid: webhookRepository.reservationActive,
    });
    const provider = successfulProvider();
    const send = vi.spyOn(provider, "sendMessage");
    const dispatchWorker = new DispatchWorker(dispatchRepository, provider, {
      workerId: "dispatch-after-reply",
      now: () => WEBHOOK_NOW,
    });

    await expect(dispatchWorker.runOnce()).resolves.toMatchObject({
      outcome: "blocked",
      reason: "recipient_inactive",
    });
    expect(send).not.toHaveBeenCalled();
  });
});
