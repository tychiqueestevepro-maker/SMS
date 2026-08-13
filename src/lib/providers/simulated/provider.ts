import { estimateSmsCredits } from "../../messaging/credits";
import {
  ProviderOperationError,
  type ProviderFailureDetails,
  type ProviderOperation,
} from "../../messaging/errors";
import type { SmsProvider } from "../../messaging/provider";
import type {
  ActualSegmentsResult,
  AvailablePhoneNumber,
  MessageCostResult,
  MessageStatusResult,
  ProviderMessageLookupInput,
  ProviderMessageStatus,
  PurchaseNumberInput,
  PurchaseNumberResult,
  ReleaseNumberInput,
  ReleaseNumberResult,
  SearchNumbersInput,
  SendMessageInput,
  SendMessageResult,
  VerifyWebhookInput,
  VerifyWebhookResult,
} from "../../messaging/types";

export type SimulatedFailure = Omit<ProviderFailureDetails, "operation">;

export type SimulatedNumberInventoryItem = AvailablePhoneNumber;

export interface SimulatedProviderOptions {
  now?: () => Date;
  availableNumbers?: readonly SimulatedNumberInventoryItem[];
  validWebhookSignature?: string;
  outboundCostPerSegmentMicroUsd?: number;
  failureFor?: (
    operation: ProviderOperation,
    input: unknown,
  ) => SimulatedFailure | null;
}

interface StoredMessage {
  result: SendMessageResult;
  input: SendMessageInput;
  status: ProviderMessageStatus;
  actualSegments: number;
  costMicroUsd: number;
}

const DEFAULT_NUMBERS: readonly SimulatedNumberInventoryItem[] = [
  {
    providerNumberId: "sim-number-0001",
    phoneNumber: "+12025550101",
    locality: "Washington",
    region: "DC",
    supportsSms: true,
  },
  {
    providerNumberId: "sim-number-0002",
    phoneNumber: "+12125550102",
    locality: "New York",
    region: "NY",
    supportsSms: true,
  },
  {
    providerNumberId: "sim-number-0003",
    phoneNumber: "+13105550103",
    locality: "Los Angeles",
    region: "CA",
    supportsSms: true,
  },
];

/** Deterministic, in-memory provider used by local development and tests. */
export class SimulatedMessagingProvider implements SmsProvider {
  private readonly now: () => Date;
  private readonly inventory: SimulatedNumberInventoryItem[];
  private readonly validWebhookSignature: string;
  private readonly outboundCostPerSegmentMicroUsd: number;
  private readonly messages = new Map<string, StoredMessage>();
  private readonly messageIdsByIdempotencyKey = new Map<string, string>();
  private readonly purchases = new Map<string, PurchaseNumberResult>();
  private readonly purchaseIdsByIdempotencyKey = new Map<string, string>();
  private readonly releasedNumbers = new Map<string, ReleaseNumberResult>();
  private messageSequence = 0;

  constructor(private readonly options: SimulatedProviderOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.inventory = [...(options.availableNumbers ?? DEFAULT_NUMBERS)];
    this.validWebhookSignature =
      options.validWebhookSignature ?? "simulated-valid-signature";
    this.outboundCostPerSegmentMicroUsd =
      options.outboundCostPerSegmentMicroUsd ?? 8_000;
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    this.maybeFail("sendMessage", input);

    const existingId = this.messageIdsByIdempotencyKey.get(
      input.idempotencyKey,
    );
    if (existingId) {
      return this.getStoredMessage(existingId).result;
    }

    if (input.body.trim().length === 0) {
      throw this.failure("sendMessage", {
        kind: "invalid_request",
        providerCode: "EMPTY_MESSAGE",
        providerMessage: "A message body is required",
        providerResourceId: null,
        retryable: false,
      });
    }

    this.messageSequence += 1;
    const providerMessageId = `sim-message-${String(this.messageSequence).padStart(6, "0")}`;
    const actualSegments = estimateSmsCredits(input.body);
    const result: SendMessageResult = {
      providerMessageId,
      acceptedAt: this.now().toISOString(),
      status: "accepted",
    };

    this.messages.set(providerMessageId, {
      result,
      input,
      status: "accepted",
      actualSegments,
      costMicroUsd: actualSegments * this.outboundCostPerSegmentMicroUsd,
    });
    this.messageIdsByIdempotencyKey.set(input.idempotencyKey, providerMessageId);

    return result;
  }

  async searchNumbers(
    input: SearchNumbersInput,
  ): Promise<AvailablePhoneNumber[]> {
    this.maybeFail("searchNumbers", input);

    const purchasedIds = new Set(
      Array.from(this.purchases.values(), (purchase) => purchase.providerNumberId),
    );
    const areaCode = input.areaCode?.replace(/\D/g, "");
    const limit = Math.max(1, Math.min(input.limit ?? 10, 50));

    return this.inventory
      .filter((number) => !purchasedIds.has(number.providerNumberId))
      .filter(
        (number) =>
          !areaCode || number.phoneNumber.slice(2, 5) === areaCode,
      )
      .slice(0, limit)
      .map((number) => ({ ...number }));
  }

  async purchaseNumber(
    input: PurchaseNumberInput,
  ): Promise<PurchaseNumberResult> {
    this.maybeFail("purchaseNumber", input);

    const existingProviderNumberId = this.purchaseIdsByIdempotencyKey.get(
      input.idempotencyKey,
    );
    if (existingProviderNumberId) {
      return this.getPurchasedNumber(existingProviderNumberId);
    }

    const inventoryNumber = this.inventory.find(
      (number) =>
        number.providerNumberId === input.providerNumberId &&
        number.phoneNumber === input.phoneNumber,
    );
    if (!inventoryNumber) {
      throw this.failure("purchaseNumber", {
        kind: "not_found",
        providerCode: "NUMBER_NOT_FOUND",
        providerMessage: "The requested number is not available",
        providerResourceId: input.providerNumberId,
        retryable: false,
      });
    }

    if (this.purchases.has(input.providerNumberId)) {
      throw this.failure("purchaseNumber", {
        kind: "conflict",
        providerCode: "NUMBER_UNAVAILABLE",
        providerMessage: "The requested number is no longer available",
        providerResourceId: input.providerNumberId,
        retryable: false,
      });
    }

    const result: PurchaseNumberResult = {
      providerNumberId: input.providerNumberId,
      phoneNumber: input.phoneNumber,
      purchasedAt: this.now().toISOString(),
      state: "provisioning",
    };
    this.purchases.set(input.providerNumberId, result);
    this.purchaseIdsByIdempotencyKey.set(
      input.idempotencyKey,
      input.providerNumberId,
    );
    return result;
  }

  async releaseNumber(
    input: ReleaseNumberInput,
  ): Promise<ReleaseNumberResult> {
    this.maybeFail("releaseNumber", input);

    const existing = this.releasedNumbers.get(input.providerNumberId);
    if (existing) {
      return existing;
    }

    this.getPurchasedNumber(input.providerNumberId);
    const result: ReleaseNumberResult = {
      providerNumberId: input.providerNumberId,
      releasedAt: this.now().toISOString(),
    };
    this.releasedNumbers.set(input.providerNumberId, result);
    return result;
  }

  async getMessageStatus(
    input: ProviderMessageLookupInput,
  ): Promise<MessageStatusResult> {
    this.maybeFail("getMessageStatus", input);
    const message = this.getStoredMessage(input.providerMessageId);
    return {
      providerMessageId: input.providerMessageId,
      status: message.status,
      updatedAt: this.now().toISOString(),
    };
  }

  async getMessageCost(
    input: ProviderMessageLookupInput,
  ): Promise<MessageCostResult> {
    this.maybeFail("getMessageCost", input);
    const message = this.getStoredMessage(input.providerMessageId);
    return {
      providerMessageId: input.providerMessageId,
      amountMicroUsd: message.costMicroUsd,
      currency: "USD",
    };
  }

  async getActualSegments(
    input: ProviderMessageLookupInput,
  ): Promise<ActualSegmentsResult> {
    this.maybeFail("getActualSegments", input);
    const message = this.getStoredMessage(input.providerMessageId);
    return {
      providerMessageId: input.providerMessageId,
      numSegments: message.actualSegments,
    };
  }

  async verifyWebhook(
    input: VerifyWebhookInput,
  ): Promise<VerifyWebhookResult> {
    this.maybeFail("verifyWebhook", input);
    return { valid: input.signature === this.validWebhookSignature };
  }

  /** Test helper for deterministic delivery callbacks. */
  setMessageStatus(
    providerMessageId: string,
    status: ProviderMessageStatus,
  ): void {
    this.getStoredMessage(providerMessageId).status = status;
  }

  private maybeFail(operation: ProviderOperation, input: unknown): void {
    const configuredFailure = this.options.failureFor?.(operation, input);
    if (configuredFailure) {
      throw this.failure(operation, configuredFailure);
    }
  }

  private failure(
    operation: ProviderOperation,
    failure: SimulatedFailure,
  ): ProviderOperationError {
    return new ProviderOperationError({ operation, ...failure });
  }

  private getStoredMessage(providerMessageId: string): StoredMessage {
    const message = this.messages.get(providerMessageId);
    if (!message) {
      throw this.failure("getMessageStatus", {
        kind: "not_found",
        providerCode: "MESSAGE_NOT_FOUND",
        providerMessage: "The requested message does not exist",
        providerResourceId: providerMessageId,
        retryable: false,
      });
    }
    return message;
  }

  private getPurchasedNumber(providerNumberId: string): PurchaseNumberResult {
    const purchasedNumber = this.purchases.get(providerNumberId);
    if (!purchasedNumber) {
      throw this.failure("releaseNumber", {
        kind: "not_found",
        providerCode: "NUMBER_NOT_FOUND",
        providerMessage: "The requested number does not exist",
        providerResourceId: providerNumberId,
        retryable: false,
      });
    }
    return purchasedNumber;
  }
}
