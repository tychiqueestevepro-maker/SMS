import "server-only";

import {
  ProviderOperationError,
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
import { isTwilioNotFoundError, toTwilioProviderError } from "./errors";
import type {
  ResolveTwilioWorkspaceCredentials,
  TwilioClientFactory,
  TwilioClientLike,
  TwilioMessageResource,
  TwilioWebhookValidator,
  TwilioWorkspaceCredentials,
} from "./types";

export interface TwilioSmsProviderOptions {
  resolveCredentials: ResolveTwilioWorkspaceCredentials;
  clientFactory: TwilioClientFactory;
  validateWebhook: TwilioWebhookValidator;
  now?: () => Date;
}

interface WorkspaceContext {
  credentials: TwilioWorkspaceCredentials;
  client: TwilioClientLike;
}

function validDate(value: Date | null | undefined, fallback: Date): Date {
  return value && Number.isFinite(value.getTime()) ? value : fallback;
}

export function mapTwilioMessageStatus(status: string): ProviderMessageStatus {
  if (status === "accepted") return "accepted";
  if (status === "sent" || status === "partially_delivered") return "sent";
  if (status === "delivered" || status === "read" || status === "received") {
    return "delivered";
  }
  if (status === "failed" || status === "undelivered" || status === "canceled") {
    return "failed";
  }
  if (
    status === "queued" ||
    status === "sending" ||
    status === "scheduled" ||
    status === "receiving"
  ) {
    return "queued";
  }
  return "unknown";
}

function actualSegments(message: TwilioMessageResource): number | null {
  if (!message.numSegments) return null;
  const parsed = Number.parseInt(message.numSegments, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function costMicroUsd(
  message: TwilioMessageResource,
  providerMessageId: string,
): number | null {
  if (message.price === null || message.price.trim() === "") return null;
  const currency = message.priceUnit?.toUpperCase();
  if (currency && currency !== "USD") {
    throw new ProviderOperationError({
      operation: "getMessageCost",
      kind: "invalid_request",
      providerCode: "UNSUPPORTED_CURRENCY",
      providerMessage: `Unsupported message cost currency: ${currency}`,
      providerResourceId: providerMessageId,
      retryable: false,
    });
  }
  const dollars = Number(message.price);
  return Number.isFinite(dollars) ? Math.round(Math.abs(dollars) * 1_000_000) : null;
}

function assertCredentials(
  credentials: TwilioWorkspaceCredentials,
  operation: ProviderOperation,
  providerResourceId: string | null,
): void {
  if (
    !credentials.accountSid ||
    !credentials.authToken ||
    !credentials.messagingServiceSid
  ) {
    throw new ProviderOperationError({
      operation,
      kind: "authentication",
      providerCode: "CREDENTIALS_UNAVAILABLE",
      providerMessage: "Workspace messaging credentials are unavailable",
      providerResourceId,
      retryable: false,
    });
  }
}

export class TwilioSmsProvider implements SmsProvider {
  private readonly now: () => Date;

  constructor(private readonly options: TwilioSmsProviderOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const context = await this.workspaceContext(
      "sendMessage",
      input.workspaceId,
      null,
    );
    try {
      const message = await context.client.messages.create({
        to: input.to,
        from: input.from,
        body: input.body,
        messagingServiceSid: context.credentials.messagingServiceSid,
        ...(input.statusCallbackUrl
          ? { statusCallback: input.statusCallbackUrl }
          : {}),
      });
      return {
        providerMessageId: message.sid,
        acceptedAt: validDate(message.dateCreated, this.now()).toISOString(),
        status: "accepted",
      };
    } catch (error) {
      throw toTwilioProviderError(error, {
        operation: "sendMessage",
        ambiguousWithoutResponse: true,
      });
    }
  }

  async searchNumbers(
    input: SearchNumbersInput,
  ): Promise<AvailablePhoneNumber[]> {
    return this.execute("searchNumbers", input.workspaceId, null, async (context) => {
      const areaCode = input.areaCode?.trim();
      if (areaCode && !/^\d{3}$/.test(areaCode)) {
        throw new ProviderOperationError({
          operation: "searchNumbers",
          kind: "invalid_request",
          providerCode: "INVALID_AREA_CODE",
          providerMessage: "Area code must contain exactly three digits",
          providerResourceId: null,
          retryable: false,
        });
      }
      const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 10), 50));
      const numbers = await context.client
        .availablePhoneNumbers(input.countryCode)
        .local.list({
          ...(areaCode ? { areaCode: Number(areaCode) } : {}),
          smsEnabled: true,
          limit,
        });

      return numbers.map((number) => ({
        // Available-number resources do not have a persistent SID before purchase.
        providerNumberId: number.phoneNumber,
        phoneNumber: number.phoneNumber,
        locality: number.locality,
        region: number.region,
        supportsSms: number.capabilities.sms,
      }));
    });
  }

  async purchaseNumber(
    input: PurchaseNumberInput,
  ): Promise<PurchaseNumberResult> {
    return this.execute(
      "purchaseNumber",
      input.workspaceId,
      input.providerNumberId,
      async (context) => {
        let purchased;
        try {
          purchased = await context.client.incomingPhoneNumbers.create({
            phoneNumber: input.phoneNumber,
            smsUrl: input.inboundWebhookUrl,
            smsMethod: "POST",
            statusCallback: input.statusCallbackUrl,
            statusCallbackMethod: "POST",
          });
        } catch (error) {
          throw toTwilioProviderError(error, {
            operation: "purchaseNumber",
            ambiguousWithoutResponse: true,
          });
        }

        try {
          await context.client.messaging.v1
            .services(context.credentials.messagingServiceSid)
            .phoneNumbers.create({ phoneNumberSid: purchased.sid });
        } catch (error) {
          throw toTwilioProviderError(error, {
            operation: "purchaseNumber",
            ambiguousWithoutResponse: true,
            providerResourceId: purchased.sid,
          });
        }

        return {
          providerNumberId: purchased.sid,
          phoneNumber: purchased.phoneNumber,
          purchasedAt: validDate(purchased.dateCreated, this.now()).toISOString(),
          state: "provisioning",
        };
      },
    );
  }

  async releaseNumber(
    input: ReleaseNumberInput,
  ): Promise<ReleaseNumberResult> {
    return this.execute(
      "releaseNumber",
      input.workspaceId,
      input.providerNumberId,
      async (context) => {
        try {
          await context.client.messaging.v1
            .services(context.credentials.messagingServiceSid)
            .phoneNumbers(input.providerNumberId)
            .remove();
        } catch (error) {
          if (!isTwilioNotFoundError(error)) throw error;
        }

        await context.client.incomingPhoneNumbers(input.providerNumberId).remove();
        return {
          providerNumberId: input.providerNumberId,
          releasedAt: this.now().toISOString(),
        };
      },
    );
  }

  async getMessageStatus(
    input: ProviderMessageLookupInput,
  ): Promise<MessageStatusResult> {
    return this.execute(
      "getMessageStatus",
      input.workspaceId,
      input.providerMessageId,
      async (context) => {
        const message = await context.client.messages(input.providerMessageId).fetch();
        return {
          providerMessageId: input.providerMessageId,
          status: mapTwilioMessageStatus(message.status),
          updatedAt: validDate(message.dateUpdated, this.now()).toISOString(),
        };
      },
    );
  }

  async getMessageCost(
    input: ProviderMessageLookupInput,
  ): Promise<MessageCostResult> {
    return this.execute(
      "getMessageCost",
      input.workspaceId,
      input.providerMessageId,
      async (context) => {
        const message = await context.client.messages(input.providerMessageId).fetch();
        return {
          providerMessageId: input.providerMessageId,
          amountMicroUsd: costMicroUsd(message, input.providerMessageId),
          currency: "USD",
        };
      },
    );
  }

  async getActualSegments(
    input: ProviderMessageLookupInput,
  ): Promise<ActualSegmentsResult> {
    return this.execute(
      "getActualSegments",
      input.workspaceId,
      input.providerMessageId,
      async (context) => {
        const message = await context.client.messages(input.providerMessageId).fetch();
        return {
          providerMessageId: input.providerMessageId,
          numSegments: actualSegments(message),
        };
      },
    );
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<VerifyWebhookResult> {
    try {
      const credentials = await this.options.resolveCredentials(input.workspaceId);
      assertCredentials(credentials, "verifyWebhook", null);
      return {
        valid: this.options.validateWebhook(
          credentials.authToken,
          input.signature,
          input.url,
          { ...input.parameters },
        ),
      };
    } catch (error) {
      throw toTwilioProviderError(error, { operation: "verifyWebhook" });
    }
  }

  private async execute<T>(
    operation: ProviderOperation,
    workspaceId: string,
    providerResourceId: string | null,
    action: (context: WorkspaceContext) => Promise<T>,
  ): Promise<T> {
    const context = await this.workspaceContext(
      operation,
      workspaceId,
      providerResourceId,
    );
    try {
      return await action(context);
    } catch (error) {
      throw toTwilioProviderError(error, { operation, providerResourceId });
    }
  }

  private async workspaceContext(
    operation: ProviderOperation,
    workspaceId: string,
    providerResourceId: string | null,
  ): Promise<WorkspaceContext> {
    try {
      const credentials = await this.options.resolveCredentials(workspaceId);
      assertCredentials(credentials, operation, providerResourceId);
      return {
        credentials,
        client: this.options.clientFactory(credentials),
      };
    } catch (error) {
      throw toTwilioProviderError(error, { operation, providerResourceId });
    }
  }
}
