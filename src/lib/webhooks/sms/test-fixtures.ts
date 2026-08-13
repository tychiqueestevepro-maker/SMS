import { associateReplyWithCampaign } from "../../inbox/replies";
import type { CampaignOutboundForReply } from "../../inbox/types";
import { SimulatedMessagingProvider } from "../../providers/simulated/provider";
import type {
  ApplyVerifiedEventResult,
  SmsWebhookRepository,
} from "./repository";
import type {
  ApplyDeliveryStatusInput,
  CreateMinimalContactInput,
  FindReplyAssociationInput,
  InsertedInboundMessage,
  InsertInboundMessageInput,
  NormalizedSmsWebhookEvent,
  ReconcileOutboundUsageInput,
  ResolvedSmsWebhookContext,
  SmsWebhookRequest,
  SmsWebhookRoutingKey,
  VerifiedSmsWebhookMutation,
  WebhookContact,
  WebhookReplyAssociation,
} from "./types";

export const WEBHOOK_NOW = new Date("2026-08-10T12:00:00.000Z");
export const RIINK_NUMBER = "+12025550101";
export const CONTACT_NUMBER = "+12025550199";

export function inboundEvent(
  overrides: Partial<Extract<NormalizedSmsWebhookEvent, { kind: "inbound" }>> = {},
): Extract<NormalizedSmsWebhookEvent, { kind: "inbound" }> {
  return {
    kind: "inbound",
    eventId: "event-inbound-1",
    providerMessageId: "provider-inbound-1",
    fromPhoneNumber: CONTACT_NUMBER,
    toPhoneNumber: RIINK_NUMBER,
    body: "Interested",
    occurredAt: WEBHOOK_NOW.toISOString(),
    confirmedConsent: null,
    ...overrides,
  };
}

export function statusEvent(
  overrides: Partial<Extract<NormalizedSmsWebhookEvent, { kind: "status" }>> = {},
): Extract<NormalizedSmsWebhookEvent, { kind: "status" }> {
  return {
    kind: "status",
    eventId: "event-status-1",
    providerMessageId: "provider-outbound-1",
    status: "delivered",
    occurredAt: WEBHOOK_NOW.toISOString(),
    providerErrorCode: null,
    ...overrides,
  };
}

export function webhookRequest(
  event: NormalizedSmsWebhookEvent = inboundEvent(),
  signature = "valid-signature",
): SmsWebhookRequest {
  return {
    requestUrl: "https://api.riink.test/webhooks/sms",
    signature,
    signatureParameters: { opaque: "internal-only" },
    event,
  };
}

export function webhookProvider(options: {
  segments?: number | null;
  costMicroUsd?: number | null;
} = {}) {
  const provider = new SimulatedMessagingProvider({
    now: () => WEBHOOK_NOW,
    validWebhookSignature: "valid-signature",
  });
  provider.getActualSegments = async (input) => ({
    providerMessageId: input.providerMessageId,
    numSegments: options.segments ?? 1,
  });
  provider.getMessageCost = async (input) => ({
    providerMessageId: input.providerMessageId,
    amountMicroUsd: options.costMicroUsd ?? 8_000,
    currency: "USD",
  });
  return provider;
}

export class MemorySmsWebhookRepository implements SmsWebhookRepository {
  context: ResolvedSmsWebhookContext | null = {
    workspaceId: "workspace-1",
    phoneNumberId: "number-1",
    messageId: null,
    campaignId: null,
    campaignRecipientId: null,
    contactId: null,
  };
  readonly contacts: WebhookContact[] = [];
  readonly createdContacts: Array<
    CreateMinimalContactInput & { contactId: string }
  > = [];
  readonly inboundMessages: Array<InsertInboundMessageInput & { id: string }> = [];
  readonly attachments: Array<{
    inboundMessageId: string;
    association: WebhookReplyAssociation;
  }> = [];
  readonly deliveryUpdates: ApplyDeliveryStatusInput[] = [];
  readonly usageReconciliations: ReconcileOutboundUsageInput[] = [];
  readonly processedEventKeys = new Set<string>();
  readonly resolvedRoutingKeys: SmsWebhookRoutingKey[] = [];
  readonly outbounds: CampaignOutboundForReply[] = [];
  readonly operationOrder: string[] = [];
  suppressedPhoneNumbers = new Set<string>();
  defaultPipelineStageId = "stage-new";
  activeRecipient = true;
  reservationActive = true;
  recipientStopReason: "reply" | "opt_out" | null = null;
  resumeCount = 0;
  transactionAttempts = 0;
  transactionProcesses = 0;

  async resolveWebhookContext(
    routingKey: SmsWebhookRoutingKey,
  ): Promise<ResolvedSmsWebhookContext | null> {
    this.resolvedRoutingKeys.push(routingKey);
    return this.context;
  }

  async applyVerifiedEvent(
    mutation: VerifiedSmsWebhookMutation,
  ): Promise<ApplyVerifiedEventResult> {
    this.operationOrder.push("transaction");
    this.transactionAttempts += 1;
    if (
      !this.context ||
      this.context.workspaceId !== mutation.expectedContext.workspaceId ||
      this.context.phoneNumberId !== mutation.expectedContext.phoneNumberId
    ) {
      throw new Error("Webhook routing context changed before the atomic RPC.");
    }
    const eventKey = `${mutation.expectedContext.workspaceId}:${mutation.event.kind}:${mutation.event.eventId}`;
    if (this.processedEventKeys.has(eventKey)) {
      return {
        duplicate: true,
        contactId: null,
        inboundMessageId: null,
        deletedContact: false,
        associatedCampaignRecipientId: null,
      };
    }
    this.processedEventKeys.add(eventKey);
    try {
      this.transactionProcesses += 1;
      return mutation.kind === "inbound"
        ? await this.applyInbound(mutation)
        : this.applyStatus(mutation);
    } catch (error) {
      this.processedEventKeys.delete(eventKey);
      throw error;
    }
  }

  private async applyInbound(
    mutation: Extract<VerifiedSmsWebhookMutation, { kind: "inbound" }>,
  ): Promise<ApplyVerifiedEventResult> {
    let contact = await this.findContactIncludingDeleted(
      mutation.event.fromPhoneNumber,
    );
    if (!contact) {
      contact = await this.createMinimalContact({
        phoneE164: mutation.event.fromPhoneNumber,
        pipelineStageId: this.defaultPipelineStageId,
        firstName: "",
        lastName: "",
        company: "",
      });
    }
    const inbound = await this.insertInboundMessage({
      eventId: mutation.event.eventId,
      providerMessageId: mutation.event.providerMessageId,
      contactId: contact.id,
      phoneNumberId: mutation.expectedContext.phoneNumberId,
      body: mutation.event.body,
      receivedAt: mutation.event.occurredAt,
      usage: mutation.usage,
    });
    const association = await this.findLastRelevantOutbound({
      contactId: contact.id,
      phoneNumberId: mutation.expectedContext.phoneNumberId,
      receivedAt: mutation.event.occurredAt,
    });
    if (association) {
      await this.attachInboundToCampaign(inbound.id, association);
    }

    if (mutation.consent.suppressionAction === "upsert_and_stop") {
      await this.suppressAndStopActiveRecipients(
        contact.id,
        mutation.event.fromPhoneNumber,
      );
    } else {
      if (mutation.consent.suppressionAction === "remove_without_resume") {
        await this.removeSuppressionWithoutResume(
          contact.id,
          mutation.event.fromPhoneNumber,
        );
      }
      if (association && mutation.consent.stopForReplyWhenAssociated) {
        await this.stopRecipientForReply();
      }
    }

    return {
      duplicate: false,
      contactId: contact.id,
      inboundMessageId: inbound.id,
      deletedContact: contact.deletedAt !== null,
      associatedCampaignRecipientId:
        association?.campaignRecipientId ?? null,
    };
  }

  private applyStatus(
    mutation: Extract<VerifiedSmsWebhookMutation, { kind: "status" }>,
  ): ApplyVerifiedEventResult {
    this.deliveryUpdates.push({
      providerMessageId: mutation.event.providerMessageId,
      providerStatus: mutation.event.status,
      deliveryState: mutation.deliveryState,
      occurredAt: mutation.event.occurredAt,
    });
    this.usageReconciliations.push({
      providerMessageId: mutation.event.providerMessageId,
      actualSegments: mutation.usage.actualSegments,
      providerCostMicroUsd: mutation.usage.providerCostMicroUsd,
      observedAt: mutation.event.occurredAt,
    });
    return {
      duplicate: false,
      contactId: mutation.expectedContext.contactId,
      inboundMessageId: null,
      deletedContact: false,
      associatedCampaignRecipientId:
        mutation.expectedContext.campaignRecipientId,
    };
  }

  async findContactIncludingDeleted(
    phoneE164: string,
  ): Promise<WebhookContact | null> {
    return this.contacts.find((contact) => contact.phoneE164 === phoneE164) ?? null;
  }

  async isPhoneSuppressed(phoneE164: string): Promise<boolean> {
    return this.suppressedPhoneNumbers.has(phoneE164);
  }

  async getDefaultPipelineStageId(): Promise<string> {
    return this.defaultPipelineStageId;
  }

  async createMinimalContact(
    input: CreateMinimalContactInput,
  ): Promise<WebhookContact> {
    const existing = await this.findContactIncludingDeleted(input.phoneE164);
    if (existing) return existing;
    const contact: WebhookContact = {
      id: `contact-${this.contacts.length + 1}`,
      phoneE164: input.phoneE164,
      deletedAt: null,
    };
    this.contacts.push(contact);
    this.createdContacts.push({ ...input, contactId: contact.id });
    return contact;
  }

  async insertInboundMessage(
    input: InsertInboundMessageInput,
  ): Promise<InsertedInboundMessage> {
    const inserted = {
      ...input,
      id: `inbound-${this.inboundMessages.length + 1}`,
    };
    this.inboundMessages.push(inserted);
    return { id: inserted.id };
  }

  async findLastRelevantOutbound(
    input: FindReplyAssociationInput,
  ): Promise<WebhookReplyAssociation | null> {
    return associateReplyWithCampaign(
      {
        contactId: input.contactId,
        phoneNumberId: input.phoneNumberId,
        receivedAt: input.receivedAt,
      },
      this.outbounds,
    );
  }

  async attachInboundToCampaign(
    inboundMessageId: string,
    association: WebhookReplyAssociation,
  ): Promise<void> {
    this.attachments.push({ inboundMessageId, association });
  }

  async suppressAndStopActiveRecipients(
    _contactId: string,
    phoneE164: string,
  ): Promise<void> {
    this.suppressedPhoneNumbers.add(phoneE164);
    this.activeRecipient = false;
    this.reservationActive = false;
    this.recipientStopReason = "opt_out";
  }

  async removeSuppressionWithoutResume(
    _contactId: string,
    phoneE164: string,
  ): Promise<void> {
    this.suppressedPhoneNumbers.delete(phoneE164);
    // Deliberately no state change and no resume.
  }

  async stopRecipientForReply(): Promise<void> {
    if (this.activeRecipient) {
      this.activeRecipient = false;
      this.reservationActive = false;
      this.recipientStopReason = "reply";
    }
  }

  async applyDeliveryStatus(input: ApplyDeliveryStatusInput): Promise<void> {
    this.deliveryUpdates.push(input);
  }

  async reconcileOutboundUsage(
    input: ReconcileOutboundUsageInput,
  ): Promise<void> {
    this.usageReconciliations.push(input);
  }
}
