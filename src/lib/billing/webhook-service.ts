import "server-only";

import type {
  BillingGateway,
  BillingProviderError,
  BillingWebhookEvent,
} from "./gateway";
import { additionalUsageInvoiceRunKey } from "./invoice";
import type {
  BillingLifecycleMutation,
  BillingRuntimeRepository,
} from "./runtime-repository";

const GRACE_PERIOD_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

export type BillingWebhookServiceErrorCode =
  | "INVALID_SIGNATURE"
  | "EVENT_BUSY"
  | "PROCESSING_FAILED";

export class BillingWebhookServiceError extends Error {
  constructor(readonly code: BillingWebhookServiceErrorCode) {
    super("The billing notification could not be processed.");
    this.name = "BillingWebhookServiceError";
  }
}

export interface BillingWebhookInternalEvent {
  event:
    | "billing_webhook_ignored"
    | "billing_webhook_busy"
    | "billing_webhook_processing_failed"
    | "billing_webhook_replayed"
    | "billing_payment_method_recorded"
    | "billing_invoice_no_additional_usage"
    | "billing_invoice_usage_line_created"
    | "billing_subscription_lifecycle_updated";
  stripeEventId: string;
  timestamp: string;
  workspaceId: string | null;
  details?: Readonly<Record<string, unknown>>;
}

export interface BillingWebhookServiceOptions {
  now?: () => Date;
  reportInternalEvent?: (event: BillingWebhookInternalEvent) => void | Promise<void>;
}

export interface HandleRawBillingWebhookInput {
  payload: Buffer;
  receivedAt: string;
  signature: string;
  webhookSecret: string;
}

export interface BillingWebhookResult {
  eventId: string;
  replayed: boolean;
}

function validTimestamp(value: string, label: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError(`${label} is invalid.`);
  return date.toISOString();
}

function graceEnd(endedAt: string): string {
  const timestamp = new Date(endedAt).getTime();
  if (!Number.isFinite(timestamp)) throw new RangeError("Subscription end time is invalid.");
  return new Date(timestamp + GRACE_PERIOD_MILLISECONDS).toISOString();
}

function isVerificationFailure(error: unknown): error is BillingProviderError {
  return Boolean(
    error &&
      typeof error === "object" &&
      "operation" in error &&
      (error as { operation?: unknown }).operation === "verify_webhook",
  );
}

export class BillingWebhookService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: BillingRuntimeRepository,
    private readonly gateway: BillingGateway,
    private readonly options: BillingWebhookServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async handleRaw(input: HandleRawBillingWebhookInput): Promise<BillingWebhookResult> {
    let event: BillingWebhookEvent;
    try {
      event = await this.gateway.verifyWebhook({
        payload: input.payload,
        signature: input.signature,
        webhookSecret: input.webhookSecret,
      });
    } catch (error) {
      if (isVerificationFailure(error)) {
        throw new BillingWebhookServiceError("INVALID_SIGNATURE");
      }
      throw new BillingWebhookServiceError("PROCESSING_FAILED");
    }
    const receivedAt = validTimestamp(input.receivedAt, "Receipt time");
    const claim = await this.safeClaim(event, receivedAt);
    if (claim.state === "completed") {
      await this.report({
        event: "billing_webhook_replayed",
        stripeEventId: event.eventId,
        timestamp: this.timestamp(),
        workspaceId: null,
      });
      return { eventId: event.eventId, replayed: true };
    }
    if (claim.state === "busy") {
      await this.report({
        event: "billing_webhook_busy",
        stripeEventId: event.eventId,
        timestamp: this.timestamp(),
        workspaceId: null,
      });
      throw new BillingWebhookServiceError("EVENT_BUSY");
    }

    try {
      const outcome = await this.process(event, claim.claimToken);
      await this.repository.completeWebhookEvent({
        claimToken: claim.claimToken,
        eventId: event.eventId,
        outcome,
        processedAt: this.timestamp(),
      });
      return { eventId: event.eventId, replayed: false };
    } catch (error) {
      try {
        await this.repository.failWebhookEvent({
          claimToken: claim.claimToken,
          eventId: event.eventId,
          failedAt: this.timestamp(),
          failureCode: this.failureCode(error),
          ...this.providerFailure(error),
        });
      } catch {
        // A failed-attempt marker is diagnostic only; the original error must
        // remain the retry signal returned to the billing provider.
      }
      await this.report({
        event: "billing_webhook_processing_failed",
        stripeEventId: event.eventId,
        timestamp: this.timestamp(),
        workspaceId: null,
        details: { failure_code: this.failureCode(error) },
      });
      if (error instanceof BillingWebhookServiceError) throw error;
      throw new BillingWebhookServiceError("PROCESSING_FAILED");
    }
  }

  private async safeClaim(event: BillingWebhookEvent, receivedAt: string) {
    try {
      return await this.repository.claimWebhookEvent({
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        receivedAt,
      });
    } catch {
      throw new BillingWebhookServiceError("PROCESSING_FAILED");
    }
  }

  private async process(
    event: BillingWebhookEvent,
    claimToken: string,
  ): Promise<"ignored" | "processed"> {
    if (event.kind === "unsupported") {
      await this.report({
        event: "billing_webhook_ignored",
        stripeEventId: event.eventId,
        timestamp: this.timestamp(),
        workspaceId: null,
        details: { event_type: event.eventType },
      });
      return "ignored";
    }
    if (event.kind === "payment_method_saved") {
      const result = await this.repository.applyPaymentMethodSaved({
        claimToken,
        customerId: event.customerId,
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        paymentMethodId: event.paymentMethodId,
        setupIntentId: event.setupIntentId,
        workspaceIdHint: event.workspaceId,
      });
      await this.report({
        event: "billing_payment_method_recorded",
        stripeEventId: event.eventId,
        timestamp: this.timestamp(),
        workspaceId: result.workspaceId,
      });
      return "processed";
    }
    if (event.kind === "invoice_created") {
      await this.addAdditionalUsage(event, claimToken);
      return "processed";
    }
    if (
      (event.kind === "invoice_paid" || event.kind === "invoice_payment_failed") &&
      (!event.subscriptionId || !event.billingReason?.startsWith("subscription"))
    ) {
      await this.report({
        event: "billing_webhook_ignored",
        stripeEventId: event.eventId,
        timestamp: this.timestamp(),
        workspaceId: null,
        details: { event_type: event.eventType },
      });
      return "ignored";
    }
    const lifecycle = this.lifecycleMutation(event, claimToken);
    const result = await this.repository.applyLifecycleEvent(lifecycle);
    await this.report({
      event: "billing_subscription_lifecycle_updated",
      stripeEventId: event.eventId,
      timestamp: this.timestamp(),
      workspaceId: result.workspaceId,
      details: { lifecycle_event: lifecycle.eventKind, status: lifecycle.status },
    });
    return "processed";
  }

  private async addAdditionalUsage(
    event: Extract<BillingWebhookEvent, { kind: "invoice_created" }>,
    claimToken: string,
  ): Promise<void> {
    if (
      event.invoiceStatus !== "draft" ||
      !event.subscriptionId ||
      (event.billingReason !== "subscription_cycle" &&
        event.billingReason !== "subscription")
    ) {
      await this.report({
        event: "billing_invoice_no_additional_usage",
        stripeEventId: event.eventId,
        timestamp: this.timestamp(),
        workspaceId: null,
        details: { run_state: "not_billable_period_invoice" },
      });
      return;
    }
    const prepared = await this.repository.prepareAdditionalUsageInvoiceRun({
      billingReason: event.billingReason,
      claimToken,
      customerId: event.customerId,
      eventId: event.eventId,
      invoiceCreatedAt: event.occurredAt,
      invoiceId: event.invoiceId,
      invoicePeriodEndsAt: event.periodEndsAt,
      invoicePeriodStartsAt: event.periodStartsAt,
      preparedAt: this.timestamp(),
      subscriptionId: event.subscriptionId,
    });
    if (prepared.state !== "ready") {
      await this.report({
        event: "billing_invoice_no_additional_usage",
        stripeEventId: event.eventId,
        timestamp: this.timestamp(),
        workspaceId: null,
        details: { run_state: prepared.state },
      });
      return;
    }
    if (prepared.customerId !== event.customerId || prepared.invoiceId !== event.invoiceId) {
      throw new Error("Invoice run correlation failed.");
    }
    const line = await this.gateway.addAdditionalUsageInvoiceLine({
      amountMicroUsd: prepared.amountMicroUsd,
      billingInvoiceRunId: prepared.billingInvoiceRunId,
      customerId: prepared.customerId,
      idempotencyKey: additionalUsageInvoiceRunKey(
        prepared.workspaceId,
        prepared.invoiceId,
      ),
      invoiceId: prepared.invoiceId,
      sourcePeriodCount: prepared.sourcePeriodIds.length,
      workspaceId: prepared.workspaceId,
    });
    await this.repository.completeAdditionalUsageInvoiceRun({
      amountCents: line.amountCents,
      billingInvoiceRunId: prepared.billingInvoiceRunId,
      claimToken,
      completedAt: this.timestamp(),
      eventId: event.eventId,
      invoiceId: prepared.invoiceId,
      invoiceItemId: line.invoiceItemId,
      workspaceId: prepared.workspaceId,
    });
    await this.report({
      event: "billing_invoice_usage_line_created",
      stripeEventId: event.eventId,
      timestamp: this.timestamp(),
      workspaceId: prepared.workspaceId,
      details: {
        amount_cents: line.amountCents,
        billing_invoice_run_id: prepared.billingInvoiceRunId,
        ledger_entry_count: prepared.ledgerEntryCount,
        source_period_count: prepared.sourcePeriodIds.length,
      },
    });
  }

  private lifecycleMutation(
    event: Exclude<
      BillingWebhookEvent,
      { kind: "invoice_created" | "payment_method_saved" | "unsupported" }
    >,
    claimToken: string,
  ): BillingLifecycleMutation {
    if (event.kind === "invoice_paid" || event.kind === "invoice_payment_failed") {
      return {
        allowTerminalReactivation: false,
        cancelAtPeriodEnd: null,
        claimToken,
        customerId: event.customerId,
        eventId: event.eventId,
        eventKind: event.kind,
        eventOccurredAt: event.occurredAt,
        graceEndsAt: null,
        invoiceId: event.invoiceId,
        periodEndsAt: event.periodEndsAt,
        periodStartsAt: event.periodStartsAt,
        status: event.kind === "invoice_paid" ? "active" : "past_due",
        subscriptionId: event.subscriptionId,
        workspaceIdHint: null,
      };
    }
    if (event.kind === "subscription_ended") {
      return {
        allowTerminalReactivation: false,
        cancelAtPeriodEnd: false,
        claimToken,
        customerId: event.customerId,
        eventId: event.eventId,
        eventKind: event.kind,
        eventOccurredAt: event.occurredAt,
        graceEndsAt: graceEnd(event.endedAt),
        invoiceId: null,
        periodEndsAt: null,
        periodStartsAt: null,
        status: "grace",
        subscriptionId: event.subscriptionId,
        workspaceIdHint: event.workspaceId,
      };
    }
    return {
      allowTerminalReactivation: false,
      cancelAtPeriodEnd: event.cancelAtPeriodEnd,
      claimToken,
      customerId: event.customerId,
      eventId: event.eventId,
      eventKind: event.kind,
      eventOccurredAt: event.occurredAt,
      graceEndsAt: null,
      invoiceId: null,
      periodEndsAt: event.periodEndsAt,
      periodStartsAt: event.periodStartsAt,
      status: event.status,
      subscriptionId: event.subscriptionId,
      workspaceIdHint: event.workspaceId,
    };
  }

  private failureCode(error: unknown): string {
    if (
      error &&
      typeof error === "object" &&
      "operation" in error &&
      typeof (error as { operation?: unknown }).operation === "string"
    ) {
      return `provider_${(error as { operation: string }).operation}`;
    }
    return "processing_failed";
  }

  private providerFailure(error: unknown): {
    providerCode: string | null;
    providerMessage: string | null;
  } {
    if (!error || typeof error !== "object") {
      return { providerCode: null, providerMessage: null };
    }
    const candidate = error as {
      operation?: unknown;
      providerCode?: unknown;
      providerMessage?: unknown;
    };
    if (typeof candidate.operation !== "string") {
      return { providerCode: null, providerMessage: null };
    }
    return {
      providerCode:
        typeof candidate.providerCode === "string" ? candidate.providerCode : null,
      providerMessage:
        typeof candidate.providerMessage === "string"
          ? candidate.providerMessage
          : null,
    };
  }

  private async report(event: BillingWebhookInternalEvent): Promise<void> {
    if (!this.options.reportInternalEvent) return;
    try {
      await this.options.reportInternalEvent(event);
    } catch {
      // Observability cannot change billing or webhook semantics.
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
