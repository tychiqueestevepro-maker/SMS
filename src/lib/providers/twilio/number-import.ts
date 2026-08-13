import "server-only";

import { createHash } from "node:crypto";

import {
  ProviderOperationError,
  type ProviderOperation,
} from "../../messaging/errors";
import type { ExistingNumberOnboardingProvider } from "../../messaging/provider";
import type {
  CancelExistingNumberImportInput,
  CancelExistingNumberImportResult,
  CheckExistingNumberEligibilityInput,
  ExistingNumberCountryCode,
  ExistingNumberEligibilityResult,
  ExistingNumberImportStatus,
  ExistingNumberImportStatusResult,
  FinalizeExistingNumberImportInput,
  FinalizeExistingNumberImportResult,
  GetExistingNumberImportStatusInput,
  StartExistingNumberImportInput,
  StartExistingNumberImportResult,
} from "../../messaging/types";
import {
  isTwilioNotFoundError,
  toTwilioProviderError,
} from "./errors";
import type {
  ResolveTwilioWorkspaceCredentials,
  TwilioClientFactory,
  TwilioClientLike,
  TwilioHostedEligibilityList,
  TwilioHostedNumberOrderList,
  TwilioHostedNumberOrderResource,
  TwilioHostedNumberOrderStatus,
  TwilioIncomingPhoneNumberResource,
  TwilioMessagingServicePhoneNumberResource,
  TwilioWorkspaceCredentials,
} from "./types";

const CANCELLABLE_ORDER_STATES = new Set<TwilioHostedNumberOrderStatus>([
  "received",
  "pending-verification",
  "verified",
  "pending-loa",
]);

type WorkspaceContext = {
  client: TwilioClientLike;
  credentials: TwilioWorkspaceCredentials;
};

type UnknownRecord = Record<string, unknown>;

export interface TwilioExistingNumberOnboardingProviderOptions {
  resolveCredentials: ResolveTwilioWorkspaceCredentials;
  clientFactory: TwilioClientFactory;
  now?: () => Date;
}

function validDate(value: Date | null | undefined, fallback: Date): Date {
  return value && Number.isFinite(value.getTime()) ? value : fallback;
}

function requiredString(
  value: string,
  operation: ProviderOperation,
  code: string,
): string {
  const normalized = value.trim();
  if (normalized) return normalized;
  throw providerFailure(operation, code, "A required import value is unavailable.");
}

function providerFailure(
  operation: ProviderOperation,
  providerCode: string,
  providerMessage: string,
  providerResourceId: string | null = null,
  kind: "authentication" | "conflict" | "invalid_request" | "number_not_ready" | "unknown" =
    "invalid_request",
): ProviderOperationError {
  return new ProviderOperationError({
    operation,
    kind,
    providerCode,
    providerMessage,
    providerResourceId,
    retryable: false,
  });
}

function assertCredentials(
  credentials: TwilioWorkspaceCredentials,
  operation: ProviderOperation,
  providerResourceId: string | null,
): void {
  if (
    !credentials.accountSid?.trim() ||
    !credentials.authToken?.trim() ||
    !credentials.messagingServiceSid?.trim()
  ) {
    throw providerFailure(
      operation,
      "CREDENTIALS_UNAVAILABLE",
      "Workspace messaging credentials are unavailable.",
      providerResourceId,
      "authentication",
    );
  }
}

function assertImportNumber(
  phoneNumber: string,
  countryCode: ExistingNumberCountryCode,
  operation: ProviderOperation,
): string {
  if (countryCode !== "US" && countryCode !== "CA") {
    throw providerFailure(
      operation,
      "INVALID_EXISTING_NUMBER",
      "The existing number must be a valid US or Canadian E.164 number.",
    );
  }
  return assertNanpNumber(phoneNumber, operation);
}

function assertNanpNumber(
  phoneNumber: string,
  operation: ProviderOperation,
): string {
  const normalized = phoneNumber.trim();
  if (!/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(normalized)) {
    throw providerFailure(
      operation,
      "INVALID_EXISTING_NUMBER",
      "The existing number must be a valid US or Canadian E.164 number.",
    );
  }
  return normalized;
}

function assertHttpsUrl(
  value: string,
  operation: ProviderOperation,
  code: string,
): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("not https");
    return url.toString();
  } catch {
    throw providerFailure(
      operation,
      code,
      "A valid secure callback URL is required.",
    );
  }
}

function nullableIdentifier(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stableUniqueName(workspaceId: string, idempotencyKey: string): string {
  const workspace = workspaceId.trim();
  const key = idempotencyKey.trim();
  if (!workspace || !key) {
    throw providerFailure(
      "startNumberImport",
      "INVALID_IMPORT_CORRELATION",
      "Import correlation values are required.",
    );
  }
  return `riink-${createHash("sha256")
    .update(`${workspace}:${key}`)
    .digest("hex")
    .slice(0, 48)}`;
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function field(row: UnknownRecord, name: string): string | null {
  const value = row[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function countryMatches(
  providerCountry: string | null,
  expected: ExistingNumberCountryCode,
): boolean {
  if (!providerCountry) return true;
  const normalized = providerCountry.toUpperCase();
  return expected === "US"
    ? normalized === "US" || normalized === "USA" || normalized === "UNITED STATES"
    : normalized === "CA" || normalized === "CAN" || normalized === "CANADA";
}

function eligibilityResult(
  response: { results: unknown },
  input: CheckExistingNumberEligibilityInput,
  phoneNumber: string,
  accountSid: string,
): ExistingNumberEligibilityResult {
  const rows = Array.isArray(response.results)
    ? response.results.map(record).filter((row): row is UnknownRecord => row !== null)
    : [];
  const matching = rows.filter(
    (row) => field(row, "phone_number") === phoneNumber,
  );
  if (matching.length !== 1) {
    throw providerFailure(
      "checkNumberImportEligibility",
      "INVALID_ELIGIBILITY_RESPONSE",
      "The hosted-number eligibility response could not be correlated.",
    );
  }

  const row = matching[0]!;
  const targetAccount = field(row, "hosting_account_sid");
  const eligibility = field(row, "eligibility_status")?.toLowerCase();
  const checked = field(row, "date_last_checked");
  const checkedAt = checked ? new Date(checked) : new Date(Number.NaN);
  if (
    (targetAccount && targetAccount !== accountSid) ||
    !countryMatches(field(row, "country"), input.countryCode) ||
    (eligibility !== "eligible" && eligibility !== "ineligible") ||
    !Number.isFinite(checkedAt.getTime())
  ) {
    throw providerFailure(
      "checkNumberImportEligibility",
      "INVALID_ELIGIBILITY_RESPONSE",
      "The hosted-number eligibility response is invalid.",
    );
  }

  const eligible = eligibility === "eligible";
  return {
    countryCode: input.countryCode,
    phoneNumber,
    eligible,
    checkedAt: checkedAt.toISOString(),
    ownershipVerificationRequired: eligible,
  };
}

export function mapTwilioHostedNumberOrderStatus(
  status: string,
): ExistingNumberImportStatus | null {
  if (status === "twilio-processing") return "pending";
  if (
    status === "received" ||
    status === "pending-verification" ||
    status === "verified" ||
    status === "pending-loa"
  ) {
    return "verification";
  }
  if (status === "carrier-processing" || status === "testing") {
    return "importing";
  }
  if (status === "action-required") return "action_required";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return null;
}

function safeVerificationCode(value: string | null | undefined): string | null {
  const normalized = nullableIdentifier(value);
  return normalized && /^\d{4,10}$/.test(normalized) ? normalized : null;
}

function normalizedOrder(
  order: TwilioHostedNumberOrderResource,
  input: {
    accountSid: string;
    operation: ProviderOperation;
    providerImportId: string;
    phoneNumber?: string;
  },
): {
  providerImportId: string;
  providerNumberId: string | null;
  phoneNumber: string;
  rawStatus: TwilioHostedNumberOrderStatus;
  status: ExistingNumberImportStatus;
  verificationCode: string | null;
} {
  const providerImportId = nullableIdentifier(order.sid);
  const accountSid = nullableIdentifier(order.accountSid);
  const phoneNumber = nullableIdentifier(order.phoneNumber);
  const status = mapTwilioHostedNumberOrderStatus(order.status);
  if (
    providerImportId !== input.providerImportId ||
    accountSid !== input.accountSid ||
    !phoneNumber ||
    (input.phoneNumber !== undefined && phoneNumber !== input.phoneNumber) ||
    !status
  ) {
    throw providerFailure(
      input.operation,
      "INVALID_IMPORT_RESPONSE",
      "The hosted-number order response could not be correlated.",
      input.providerImportId,
    );
  }
  return {
    providerImportId,
    providerNumberId: nullableIdentifier(order.incomingPhoneNumberSid),
    phoneNumber,
    rawStatus: order.status as TwilioHostedNumberOrderStatus,
    status,
    verificationCode: safeVerificationCode(order.verificationCode),
  };
}

function assertIncomingNumber(
  number: TwilioIncomingPhoneNumberResource,
  input: FinalizeExistingNumberImportInput,
  accountSid: string,
): void {
  const callback = nullableIdentifier(number.statusCallback);
  const inbound = nullableIdentifier(number.smsUrl);
  if (
    nullableIdentifier(number.sid) !== input.providerNumberId ||
    nullableIdentifier(number.phoneNumber) !== input.phoneNumber ||
    (number.accountSid !== undefined && number.accountSid !== accountSid) ||
    number.capabilities?.sms !== true ||
    (number.origin !== undefined && number.origin.toLowerCase() !== "hosted") ||
    inbound !== new URL(input.inboundWebhookUrl).toString() ||
    callback !== new URL(input.statusCallbackUrl).toString()
  ) {
    throw providerFailure(
      "finalizeNumberImport",
      "IMPORTED_NUMBER_CONFIGURATION_INVALID",
      "The hosted number was not configured for messaging.",
      input.providerNumberId,
      "number_not_ready",
    );
  }
}

function assertServiceAttachment(
  attachment: TwilioMessagingServicePhoneNumberResource,
  input: FinalizeExistingNumberImportInput,
  messagingServiceSid: string,
): void {
  const capabilities = attachment.capabilities?.map((capability) =>
    capability.toUpperCase(),
  );
  if (
    nullableIdentifier(attachment.sid) !== input.providerNumberId ||
    nullableIdentifier(attachment.serviceSid) !== messagingServiceSid ||
    nullableIdentifier(attachment.phoneNumber) !== input.phoneNumber ||
    !capabilities?.includes("SMS")
  ) {
    throw providerFailure(
      "finalizeNumberImport",
      "IMPORTED_NUMBER_ATTACHMENT_INVALID",
      "The hosted number is not attached for messaging.",
      input.providerNumberId,
      "number_not_ready",
    );
  }
}

function isConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = (error as { status?: unknown }).status;
  return value === 409 || value === "409";
}

/**
 * Real Hosted Number adapter. Access to these Preview/Beta APIs is account
 * dependent; absent SDK surfaces or account permissions fail closed.
 */
export class TwilioExistingNumberOnboardingProvider
  implements ExistingNumberOnboardingProvider
{
  private readonly now: () => Date;

  constructor(
    private readonly options: TwilioExistingNumberOnboardingProviderOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async checkEligibility(
    input: CheckExistingNumberEligibilityInput,
  ): Promise<ExistingNumberEligibilityResult> {
    const operation = "checkNumberImportEligibility" as const;
    const phoneNumber = assertImportNumber(
      input.phoneNumber,
      input.countryCode,
      operation,
    );
    const context = await this.workspaceContext(
      input.workspaceId,
      operation,
      null,
    );
    const eligibility = this.eligibilityApi(context.client, operation);

    try {
      const response = await eligibility.create({
        friendly_name: stableUniqueName(
          input.workspaceId,
          `eligibility:${phoneNumber}`,
        ),
        phone_numbers: [
          {
            phone_number: phoneNumber,
            hosting_account_sid: context.credentials.accountSid,
          },
        ],
      });
      return eligibilityResult(
        response,
        input,
        phoneNumber,
        context.credentials.accountSid,
      );
    } catch (error) {
      throw toTwilioProviderError(error, { operation });
    }
  }

  async startImport(
    input: StartExistingNumberImportInput,
  ): Promise<StartExistingNumberImportResult> {
    const operation = "startNumberImport" as const;
    const phoneNumber = assertImportNumber(
      input.phoneNumber,
      input.countryCode,
      operation,
    );
    const inboundWebhookUrl = assertHttpsUrl(
      input.inboundWebhookUrl,
      operation,
      "INVALID_INBOUND_WEBHOOK_URL",
    );
    const statusCallbackUrl = assertHttpsUrl(
      input.statusCallbackUrl,
      operation,
      "INVALID_STATUS_CALLBACK_URL",
    );
    const context = await this.workspaceContext(
      input.workspaceId,
      operation,
      null,
    );
    const orders = this.orderApi(context.client, operation);
    const ownerEmail = input.ownerEmail?.trim();
    if (ownerEmail && (ownerEmail.length > 320 || !ownerEmail.includes("@"))) {
      throw providerFailure(
        operation,
        "INVALID_OWNER_EMAIL",
        "A valid owner email is required.",
      );
    }

    try {
      const order = await orders.create({
        phoneNumber,
        smsCapability: true,
        accountSid: context.credentials.accountSid,
        friendlyName: "Riink existing number",
        uniqueName: stableUniqueName(input.workspaceId, input.idempotencyKey),
        smsUrl: inboundWebhookUrl,
        smsMethod: "POST",
        statusCallbackUrl,
        statusCallbackMethod: "POST",
        ...(ownerEmail ? { email: ownerEmail } : {}),
        verificationType: "phone-call",
      });
      const normalized = normalizedOrder(order, {
        accountSid: context.credentials.accountSid,
        operation,
        providerImportId: requiredString(
          order.sid,
          operation,
          "INVALID_IMPORT_RESPONSE",
        ),
        phoneNumber,
      });
      return {
        providerImportId: normalized.providerImportId,
        providerNumberId: normalized.providerNumberId,
        phoneNumber: normalized.phoneNumber,
        status: normalized.status,
        verificationCode: normalized.verificationCode,
        createdAt: validDate(order.dateCreated, this.now()).toISOString(),
      };
    } catch (error) {
      throw toTwilioProviderError(error, {
        operation,
        ambiguousWithoutResponse: true,
      });
    }
  }

  async getImportStatus(
    input: GetExistingNumberImportStatusInput,
  ): Promise<ExistingNumberImportStatusResult> {
    const operation = "getNumberImportStatus" as const;
    const providerImportId = requiredString(
      input.providerImportId,
      operation,
      "INVALID_IMPORT_ID",
    );
    const context = await this.workspaceContext(
      input.workspaceId,
      operation,
      providerImportId,
    );
    const orders = this.orderApi(context.client, operation);

    try {
      const order = await orders(providerImportId).fetch();
      const normalized = normalizedOrder(order, {
        accountSid: context.credentials.accountSid,
        operation,
        providerImportId,
      });
      return {
        providerImportId,
        providerNumberId: normalized.providerNumberId,
        phoneNumber: normalized.phoneNumber,
        status: normalized.status,
        verificationCode: normalized.verificationCode,
        updatedAt: validDate(order.dateUpdated, this.now()).toISOString(),
      };
    } catch (error) {
      throw toTwilioProviderError(error, {
        operation,
        providerResourceId: providerImportId,
      });
    }
  }

  async finalizeImport(
    input: FinalizeExistingNumberImportInput,
  ): Promise<FinalizeExistingNumberImportResult> {
    const operation = "finalizeNumberImport" as const;
    const providerImportId = requiredString(
      input.providerImportId,
      operation,
      "INVALID_IMPORT_ID",
    );
    const providerNumberId = requiredString(
      input.providerNumberId,
      operation,
      "INVALID_PROVIDER_NUMBER_ID",
    );
    const phoneNumber = assertNanpNumber(input.phoneNumber, operation);
    const inboundWebhookUrl = assertHttpsUrl(
      input.inboundWebhookUrl,
      operation,
      "INVALID_INBOUND_WEBHOOK_URL",
    );
    const statusCallbackUrl = assertHttpsUrl(
      input.statusCallbackUrl,
      operation,
      "INVALID_STATUS_CALLBACK_URL",
    );
    const normalizedInput = {
      ...input,
      providerImportId,
      providerNumberId,
      phoneNumber,
      inboundWebhookUrl,
      statusCallbackUrl,
    };
    const context = await this.workspaceContext(
      input.workspaceId,
      operation,
      providerImportId,
    );
    const orders = this.orderApi(context.client, operation);

    let order: TwilioHostedNumberOrderResource;
    try {
      order = await orders(providerImportId).fetch();
    } catch (error) {
      throw toTwilioProviderError(error, {
        operation,
        providerResourceId: providerImportId,
      });
    }
    const normalized = normalizedOrder(order, {
      accountSid: context.credentials.accountSid,
      operation,
      providerImportId,
      phoneNumber,
    });
    if (
      normalized.status !== "completed" ||
      normalized.providerNumberId !== providerNumberId
    ) {
      throw providerFailure(
        operation,
        "IMPORT_NOT_COMPLETED",
        "The hosted-number order is not ready to finalize.",
        providerImportId,
        "number_not_ready",
      );
    }

    let configured: TwilioIncomingPhoneNumberResource;
    try {
      configured = await context.client
        .incomingPhoneNumbers(providerNumberId)
        .update({
          smsUrl: inboundWebhookUrl,
          smsMethod: "POST",
          statusCallback: statusCallbackUrl,
          statusCallbackMethod: "POST",
        });
    } catch (error) {
      throw toTwilioProviderError(error, {
        operation,
        providerResourceId: providerNumberId,
        ambiguousWithoutResponse: true,
      });
    }
    assertIncomingNumber(configured, normalizedInput, context.credentials.accountSid);

    const serviceNumbers = context.client.messaging.v1.services(
      context.credentials.messagingServiceSid,
    ).phoneNumbers;
    let attachment: TwilioMessagingServicePhoneNumberResource;
    try {
      attachment = await serviceNumbers.create({ phoneNumberSid: providerNumberId });
    } catch (error) {
      if (!isConflict(error)) {
        throw toTwilioProviderError(error, {
          operation,
          providerResourceId: providerNumberId,
          ambiguousWithoutResponse: true,
        });
      }
      try {
        attachment = await serviceNumbers(providerNumberId).fetch();
      } catch (fetchError) {
        throw toTwilioProviderError(fetchError, {
          operation,
          providerResourceId: providerNumberId,
        });
      }
    }
    assertServiceAttachment(
      attachment,
      normalizedInput,
      context.credentials.messagingServiceSid,
    );

    return {
      providerImportId,
      providerNumberId,
      phoneNumber,
      usable: true,
      activatedAt: this.now().toISOString(),
    };
  }

  async cancelImport(
    input: CancelExistingNumberImportInput,
  ): Promise<CancelExistingNumberImportResult> {
    const operation = "cancelNumberImport" as const;
    const providerImportId = requiredString(
      input.providerImportId,
      operation,
      "INVALID_IMPORT_ID",
    );
    const requestedProviderNumberId = nullableIdentifier(input.providerNumberId);
    const context = await this.workspaceContext(
      input.workspaceId,
      operation,
      providerImportId,
    );
    const orders = this.orderApi(context.client, operation);

    let order: TwilioHostedNumberOrderResource;
    try {
      order = await orders(providerImportId).fetch();
    } catch (error) {
      if (!isTwilioNotFoundError(error)) {
        throw toTwilioProviderError(error, {
          operation,
          providerResourceId: providerImportId,
        });
      }
      if (requestedProviderNumberId) {
        await this.offboardActiveNumber(context, requestedProviderNumberId);
      }
      return {
        providerImportId,
        providerNumberId: requestedProviderNumberId,
        cancelled: true,
        cancelledAt: this.now().toISOString(),
      };
    }

    const normalized = normalizedOrder(order, {
      accountSid: context.credentials.accountSid,
      operation,
      providerImportId,
    });
    if (
      requestedProviderNumberId &&
      normalized.providerNumberId !== requestedProviderNumberId
    ) {
      throw providerFailure(
        operation,
        "IMPORT_CANCEL_CORRELATION_FAILED",
        "The hosted-number cancellation could not be correlated.",
        providerImportId,
      );
    }

    if (normalized.status === "completed") {
      const providerNumberId = normalized.providerNumberId;
      if (!providerNumberId) {
        throw providerFailure(
          operation,
          "IMPORTED_NUMBER_ID_UNAVAILABLE",
          "The active hosted number identifier is unavailable.",
          providerImportId,
          "unknown",
        );
      }
      await this.offboardActiveNumber(context, providerNumberId);
    } else if (CANCELLABLE_ORDER_STATES.has(normalized.rawStatus)) {
      try {
        const removed = await orders(providerImportId).remove();
        if (!removed) {
          throw providerFailure(
            operation,
            "IMPORT_CANCEL_NOT_CONFIRMED",
            "The hosted-number cancellation was not confirmed.",
            providerImportId,
            "unknown",
          );
        }
      } catch (error) {
        throw toTwilioProviderError(error, {
          operation,
          providerResourceId: providerImportId,
          ambiguousWithoutResponse: true,
        });
      }
    } else if (normalized.status !== "failed") {
      throw providerFailure(
        operation,
        "IMPORT_CANNOT_BE_CANCELLED",
        "The hosted-number order cannot be cancelled in its current state.",
        providerImportId,
        "conflict",
      );
    }

    return {
      providerImportId,
      providerNumberId: normalized.providerNumberId,
      cancelled: true,
      cancelledAt: this.now().toISOString(),
    };
  }

  private async offboardActiveNumber(
    context: WorkspaceContext,
    providerNumberId: string,
  ): Promise<void> {
    const operation = "cancelNumberImport" as const;
    const serviceNumber = context.client.messaging.v1
      .services(context.credentials.messagingServiceSid)
      .phoneNumbers(providerNumberId);
    try {
      const removed = await serviceNumber.remove();
      if (!removed) {
        throw providerFailure(
          operation,
          "IMPORT_DETACH_NOT_CONFIRMED",
          "The hosted number could not be detached.",
          providerNumberId,
          "unknown",
        );
      }
    } catch (error) {
      if (!isTwilioNotFoundError(error)) {
        throw toTwilioProviderError(error, {
          operation,
          providerResourceId: providerNumberId,
          ambiguousWithoutResponse: true,
        });
      }
    }

    try {
      const removed = await context.client
        .incomingPhoneNumbers(providerNumberId)
        .remove();
      if (!removed) {
        throw providerFailure(
          operation,
          "IMPORT_OFFBOARD_NOT_CONFIRMED",
          "The hosted number could not be removed.",
          providerNumberId,
          "unknown",
        );
      }
    } catch (error) {
      if (!isTwilioNotFoundError(error)) {
        throw toTwilioProviderError(error, {
          operation,
          providerResourceId: providerNumberId,
          ambiguousWithoutResponse: true,
        });
      }
    }
  }

  private eligibilityApi(
    client: TwilioClientLike,
    operation: ProviderOperation,
  ): TwilioHostedEligibilityList {
    const api = client.numbers?.v1.eligibilities;
    if (!api) {
      throw providerFailure(
        operation,
        "HOSTED_NUMBER_ELIGIBILITY_UNAVAILABLE",
        "Hosted-number eligibility access is unavailable.",
        null,
        "authentication",
      );
    }
    return api;
  }

  private orderApi(
    client: TwilioClientLike,
    operation: ProviderOperation,
  ): TwilioHostedNumberOrderList {
    const api = client.preview?.hosted_numbers.hostedNumberOrders;
    if (!api) {
      throw providerFailure(
        operation,
        "HOSTED_NUMBER_PREVIEW_UNAVAILABLE",
        "Hosted-number Preview access is unavailable.",
        null,
        "authentication",
      );
    }
    return api;
  }

  private async workspaceContext(
    workspaceId: string,
    operation: ProviderOperation,
    providerResourceId: string | null,
  ): Promise<WorkspaceContext> {
    try {
      const credentials = await this.options.resolveCredentials(
        requiredString(
          workspaceId,
          operation,
          "INVALID_WORKSPACE_ID",
        ),
      );
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
