import {
  getProviderFailureDetails,
  type ProviderOperation,
} from "../../messaging/errors";
import type { SmsProvider } from "../../messaging/provider";
import type { ProviderMessageLookupInput } from "../../messaging/types";
import { buildVerifiedSmsWebhookMutation } from "./mutation";
import type { SmsWebhookRepository } from "./repository";
import type {
  NormalizedSmsWebhookEvent,
  ResolvedSmsWebhookContext,
  SmsWebhookAcknowledgement,
  SmsWebhookInternalReporter,
  SmsWebhookRequest,
  SmsWebhookRoutingKey,
  WebhookUsageObservation,
} from "./types";

export const SMS_WEBHOOK_ACKNOWLEDGEMENT: SmsWebhookAcknowledgement =
  Object.freeze({ received: true });

export type SmsWebhookProcessingErrorCode =
  | "VERIFICATION_UNAVAILABLE"
  | "PROCESSING_FAILED";

export class SmsWebhookProcessingError extends Error {
  constructor(readonly code: SmsWebhookProcessingErrorCode) {
    super("The SMS webhook could not be processed.");
    this.name = "SmsWebhookProcessingError";
  }
}

export interface SmsWebhookOrchestratorOptions {
  now?: () => Date;
  reportInternalEvent?: SmsWebhookInternalReporter;
}

function routingKey(event: NormalizedSmsWebhookEvent): SmsWebhookRoutingKey {
  return event.kind === "inbound"
    ? { kind: "inbound_number", value: event.toPhoneNumber }
    : { kind: "outbound_message", value: event.providerMessageId };
}

function validEvent(event: NormalizedSmsWebhookEvent): boolean {
  if (
    typeof event.eventId !== "string" ||
    !event.eventId.trim() ||
    typeof event.providerMessageId !== "string" ||
    !event.providerMessageId.trim() ||
    typeof event.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(event.occurredAt))
  ) {
    return false;
  }
  if (event.kind === "inbound") {
    return Boolean(
      typeof event.fromPhoneNumber === "string" &&
        event.fromPhoneNumber.trim() &&
        typeof event.toPhoneNumber === "string" &&
        event.toPhoneNumber.trim() &&
        typeof event.body === "string" &&
        (event.confirmedConsent === null ||
          event.confirmedConsent === "opt_out" ||
          event.confirmedConsent === "opt_in" ||
          event.confirmedConsent === "help"),
    );
  }
  return true;
}

function validActualSegments(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function validProviderCost(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export class SmsWebhookOrchestrator {
  private readonly now: () => Date;

  constructor(
    private readonly repository: SmsWebhookRepository,
    private readonly provider: SmsProvider,
    private readonly options: SmsWebhookOrchestratorOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async handle(request: SmsWebhookRequest): Promise<SmsWebhookAcknowledgement> {
    if (!validEvent(request.event)) return SMS_WEBHOOK_ACKNOWLEDGEMENT;

    const context = await this.repository.resolveWebhookContext(
      routingKey(request.event),
    );
    if (!context) return SMS_WEBHOOK_ACKNOWLEDGEMENT;

    let signatureValid: boolean;
    try {
      const verification = await this.provider.verifyWebhook({
        workspaceId: context.workspaceId,
        url: request.requestUrl,
        signature: request.signature,
        parameters: request.signatureParameters,
      });
      signatureValid = verification.valid;
    } catch (error) {
      await this.report(
        "signature_verification_failed",
        context,
        request.event.providerMessageId,
        error,
        "verifyWebhook",
      );
      throw new SmsWebhookProcessingError("VERIFICATION_UNAVAILABLE");
    }
    if (!signatureValid) {
      await this.report(
        "signature_rejected",
        context,
        request.event.providerMessageId,
        null,
        null,
      );
      return SMS_WEBHOOK_ACKNOWLEDGEMENT;
    }

    const usage = await this.lookupUsage(context, request.event.providerMessageId);
    try {
      await this.repository.applyVerifiedEvent(
        buildVerifiedSmsWebhookMutation(context, request.event, usage),
      );
    } catch (error) {
      await this.report(
        "processing_failed",
        context,
        request.event.providerMessageId,
        error,
        null,
      );
      throw new SmsWebhookProcessingError("PROCESSING_FAILED");
    }
    return SMS_WEBHOOK_ACKNOWLEDGEMENT;
  }

  private async lookupUsage(
    context: ResolvedSmsWebhookContext,
    providerMessageId: string,
  ): Promise<WebhookUsageObservation> {
    const input: ProviderMessageLookupInput = {
      workspaceId: context.workspaceId,
      providerMessageId,
    };
    const [segments, cost] = await Promise.all([
      this.lookupProviderValue(
        context,
        providerMessageId,
        "getActualSegments",
        () => this.provider.getActualSegments(input),
      ),
      this.lookupProviderValue(
        context,
        providerMessageId,
        "getMessageCost",
        () => this.provider.getMessageCost(input),
      ),
    ]);

    const actualSegments = segments
      ? validActualSegments(segments.numSegments)
      : null;
    const providerCostMicroUsd = cost
      ? validProviderCost(cost.amountMicroUsd)
      : null;
    if (
      (segments &&
        (segments.providerMessageId !== providerMessageId ||
          (segments.numSegments !== null && actualSegments === null))) ||
      (cost &&
        (cost.providerMessageId !== providerMessageId ||
          (cost.amountMicroUsd !== null && providerCostMicroUsd === null)))
    ) {
      await this.report(
        "invalid_usage_response",
        context,
        providerMessageId,
        null,
        null,
      );
    }
    return {
      actualSegments:
        segments?.providerMessageId === providerMessageId ? actualSegments : null,
      providerCostMicroUsd:
        cost?.providerMessageId === providerMessageId
          ? providerCostMicroUsd
          : null,
    };
  }

  private async lookupProviderValue<T>(
    context: ResolvedSmsWebhookContext,
    providerMessageId: string,
    operation: "getActualSegments" | "getMessageCost",
    action: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await action();
    } catch (error) {
      await this.report(
        "usage_lookup_failed",
        context,
        providerMessageId,
        error,
        operation,
      );
      return null;
    }
  }

  private async report(
    event: Parameters<NonNullable<SmsWebhookInternalReporter>>[0]["event"],
    context: ResolvedSmsWebhookContext | null,
    providerMessageId: string | null,
    error: unknown,
    operation: ProviderOperation | null,
  ): Promise<void> {
    if (!this.options.reportInternalEvent) return;
    try {
      await this.options.reportInternalEvent({
        event,
        workspaceId: context?.workspaceId ?? null,
        providerMessageId,
        failure:
          operation === null
            ? null
            : getProviderFailureDetails(error, operation),
        timestamp: this.now().toISOString(),
      });
    } catch {
      // Internal observability cannot change webhook semantics.
    }
  }
}
