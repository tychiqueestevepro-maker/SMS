import type { SmsProvider } from "./provider";
import {
  getProviderFailureDetails,
  ProductMessagingError,
  toProductMessagingError,
  type ProviderFailureDetails,
  type ProviderOperation,
} from "./errors";
import type {
  ActualSegmentsResult,
  AvailablePhoneNumber,
  MessageCostResult,
  MessageStatusResult,
  ProviderMessageLookupInput,
  PurchaseNumberInput,
  PurchaseNumberResult,
  ReleaseNumberInput,
  ReleaseNumberResult,
  SearchNumbersInput,
  SendMessageInput,
  SendMessageResult,
  VerifyWebhookInput,
  VerifyWebhookResult,
} from "./types";

export interface ProviderFailureEvent {
  operation: ProviderOperation;
  workspaceId: string | null;
  messageId: string | null;
  providerMessageId: string | null;
  occurredAt: string;
  failure: ProviderFailureDetails;
}

export type ProviderFailureReporter = (
  event: ProviderFailureEvent,
) => void | Promise<void>;

export interface MessagingServiceOptions {
  reportProviderFailure?: ProviderFailureReporter;
  now?: () => Date;
}

interface OperationContext {
  workspaceId?: string;
  messageId?: string;
  providerMessageId?: string;
}

/**
 * Messaging-domain orchestration. Product code calls this service rather than
 * importing an external SDK or adapter directly.
 */
export class MessagingService {
  private readonly now: () => Date;

  constructor(
    private readonly provider: SmsProvider,
    private readonly options: MessagingServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    return this.execute(
      "sendMessage",
      { workspaceId: input.workspaceId, messageId: input.messageId },
      () => this.provider.sendMessage(input),
    );
  }

  searchNumbers(input: SearchNumbersInput): Promise<AvailablePhoneNumber[]> {
    return this.execute(
      "searchNumbers",
      { workspaceId: input.workspaceId },
      () => this.provider.searchNumbers(input),
    );
  }

  purchaseNumber(input: PurchaseNumberInput): Promise<PurchaseNumberResult> {
    return this.execute(
      "purchaseNumber",
      { workspaceId: input.workspaceId },
      () => this.provider.purchaseNumber(input),
    );
  }

  releaseNumber(input: ReleaseNumberInput): Promise<ReleaseNumberResult> {
    return this.execute(
      "releaseNumber",
      { workspaceId: input.workspaceId },
      () => this.provider.releaseNumber(input),
    );
  }

  getMessageStatus(
    input: ProviderMessageLookupInput,
  ): Promise<MessageStatusResult> {
    return this.execute(
      "getMessageStatus",
      {
        workspaceId: input.workspaceId,
        providerMessageId: input.providerMessageId,
      },
      () => this.provider.getMessageStatus(input),
    );
  }

  getMessageCost(
    input: ProviderMessageLookupInput,
  ): Promise<MessageCostResult> {
    return this.execute(
      "getMessageCost",
      {
        workspaceId: input.workspaceId,
        providerMessageId: input.providerMessageId,
      },
      () => this.provider.getMessageCost(input),
    );
  }

  getActualSegments(
    input: ProviderMessageLookupInput,
  ): Promise<ActualSegmentsResult> {
    return this.execute(
      "getActualSegments",
      {
        workspaceId: input.workspaceId,
        providerMessageId: input.providerMessageId,
      },
      () => this.provider.getActualSegments(input),
    );
  }

  verifyWebhook(input: VerifyWebhookInput): Promise<VerifyWebhookResult> {
    return this.execute(
      "verifyWebhook",
      { workspaceId: input.workspaceId },
      () => this.provider.verifyWebhook(input),
    );
  }

  private async execute<T>(
    operation: ProviderOperation,
    context: OperationContext,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof ProductMessagingError) {
        throw error;
      }

      await this.reportFailure(error, operation, context);
      throw toProductMessagingError(error, operation);
    }
  }

  private async reportFailure(
    error: unknown,
    operation: ProviderOperation,
    context: OperationContext,
  ): Promise<void> {
    if (!this.options.reportProviderFailure) {
      return;
    }

    try {
      await this.options.reportProviderFailure({
        operation,
        workspaceId: context.workspaceId ?? null,
        messageId: context.messageId ?? null,
        providerMessageId: context.providerMessageId ?? null,
        occurredAt: this.now().toISOString(),
        failure: getProviderFailureDetails(error, operation),
      });
    } catch {
      // Observability must never alter product behavior or leak its own failure.
    }
  }
}
