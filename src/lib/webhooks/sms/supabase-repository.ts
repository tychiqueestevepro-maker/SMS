import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ApplyVerifiedEventResult,
  SmsWebhookRepository,
} from "./repository";
import { toDeliveryState } from "./status";
import type {
  ResolvedSmsWebhookContext,
  SmsWebhookRoutingKey,
  VerifiedSmsWebhookMutation,
} from "./types";

type UnknownRow = Record<string, unknown>;

const CONTEXT_KEYS = [
  "workspaceId",
  "phoneNumberId",
  "messageId",
  "campaignId",
  "campaignRecipientId",
  "contactId",
] as const;
const RESULT_KEYS = [
  "duplicate",
  "contactId",
  "inboundMessageId",
  "deletedContact",
  "associatedCampaignRecipientId",
] as const;

export class SmsWebhookRepositoryError extends Error {
  constructor(readonly operation: string) {
    super("Messaging webhook persistence is temporarily unavailable.");
    this.name = "SmsWebhookRepositoryError";
  }
}

function fail(operation = "invalid_rpc_response"): never {
  throw new SmsWebhookRepositoryError(operation);
}

function row(value: unknown): UnknownRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as UnknownRow;
}

function exactKeys(value: UnknownRow, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (
    actual.length !== allowed.length ||
    actual.some((key, index) => key !== allowed[index])
  ) {
    fail();
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return fail();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function safeIntegerOrNull(value: unknown, positive: boolean): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (positive ? 1 : 0)
  ) {
    return fail();
  }
  return value;
}

function canonicalTimestamp(value: unknown): string {
  const timestamp = requiredString(value);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    return fail();
  }
  return timestamp;
}

function contextFrom(value: unknown): ResolvedSmsWebhookContext {
  const candidate = row(value);
  exactKeys(candidate, CONTEXT_KEYS);
  return {
    workspaceId: requiredString(candidate.workspaceId),
    phoneNumberId: requiredString(candidate.phoneNumberId),
    messageId: nullableString(candidate.messageId),
    campaignId: nullableString(candidate.campaignId),
    campaignRecipientId: nullableString(candidate.campaignRecipientId),
    contactId: nullableString(candidate.contactId),
  };
}

function validateContextForRouting(
  routing: SmsWebhookRoutingKey,
  context: ResolvedSmsWebhookContext,
): void {
  if (routing.kind === "outbound_message" && context.messageId === null) fail();
  if (routing.kind === "inbound_number" && context.messageId !== null) fail();
}

function validateUsageObservation(value: unknown): void {
  const usage = row(value);
  exactKeys(usage, ["actualSegments", "providerCostMicroUsd"]);
  safeIntegerOrNull(usage.actualSegments, true);
  safeIntegerOrNull(usage.providerCostMicroUsd, false);
}

function validateExpectedContext(value: unknown): ResolvedSmsWebhookContext {
  return contextFrom(value);
}

function validateInboundMutation(
  mutation: Extract<VerifiedSmsWebhookMutation, { kind: "inbound" }>,
): void {
  const event = row(mutation.event);
  exactKeys(event, [
    "kind",
    "eventId",
    "providerMessageId",
    "fromPhoneNumber",
    "toPhoneNumber",
    "body",
    "occurredAt",
    "confirmedConsent",
  ]);
  if (event.kind !== "inbound") fail();
  requiredString(event.eventId);
  requiredString(event.providerMessageId);
  if (
    !/^\+[1-9]\d{7,14}$/.test(requiredString(event.fromPhoneNumber)) ||
    !/^\+[1-9]\d{7,14}$/.test(requiredString(event.toPhoneNumber))
  ) {
    fail();
  }
  if (typeof event.body !== "string") fail();
  canonicalTimestamp(event.occurredAt);
  if (
    event.confirmedConsent !== null &&
    event.confirmedConsent !== "opt_out" &&
    event.confirmedConsent !== "opt_in" &&
    event.confirmedConsent !== "help"
  ) {
    fail();
  }

  const consent = row(mutation.consent);
  exactKeys(consent, [
    "command",
    "keyword",
    "suppressionAction",
    "stopForReplyWhenAssociated",
    "resumeCampaigns",
  ]);
  if (
    consent.command !== null &&
    consent.command !== "opt_out" &&
    consent.command !== "opt_in"
  ) {
    fail();
  }
  nullableString(consent.keyword);
  if (
    consent.suppressionAction !== "none" &&
    consent.suppressionAction !== "upsert_and_stop" &&
    consent.suppressionAction !== "remove_without_resume"
  ) {
    fail();
  }
  if (
    typeof consent.stopForReplyWhenAssociated !== "boolean" ||
    consent.resumeCampaigns !== false
  ) {
    fail();
  }
  if (
    consent.suppressionAction === "upsert_and_stop" &&
    (consent.command !== "opt_out" ||
      consent.stopForReplyWhenAssociated !== false)
  ) {
    fail();
  }
  if (
    consent.suppressionAction === "remove_without_resume" &&
    (consent.command !== "opt_in" ||
      event.confirmedConsent !== "opt_in" ||
      consent.stopForReplyWhenAssociated !== true)
  ) {
    fail();
  }

  const usage = row(mutation.usage);
  exactKeys(usage, [
    "direction",
    "numSegments",
    "providerCostMicroUsd",
    "includedSegments",
    "overageSegments",
    "customerBillableAmountMicroUsd",
  ]);
  if (
    usage.direction !== "inbound" ||
    usage.includedSegments !== 0 ||
    usage.overageSegments !== 0 ||
    usage.customerBillableAmountMicroUsd !== 0
  ) {
    fail();
  }
  safeIntegerOrNull(usage.numSegments, true);
  safeIntegerOrNull(usage.providerCostMicroUsd, false);
}

function validateStatusMutation(
  mutation: Extract<VerifiedSmsWebhookMutation, { kind: "status" }>,
): void {
  const event = row(mutation.event);
  exactKeys(event, [
    "kind",
    "eventId",
    "providerMessageId",
    "status",
    "occurredAt",
    "providerErrorCode",
  ]);
  if (event.kind !== "status") fail();
  requiredString(event.eventId);
  requiredString(event.providerMessageId);
  canonicalTimestamp(event.occurredAt);
  if (event.providerErrorCode !== null) {
    const errorCode = requiredString(event.providerErrorCode);
    if (errorCode.length > 64 || !/^[A-Za-z0-9_.:-]+$/.test(errorCode)) fail();
  }
  if (
    event.status !== "queued" &&
    event.status !== "accepted" &&
    event.status !== "sent" &&
    event.status !== "delivered" &&
    event.status !== "failed" &&
    event.status !== "unknown"
  ) {
    fail();
  }
  if (mutation.deliveryState !== toDeliveryState(event.status)) fail();
  validateUsageObservation(mutation.usage);
}

function validateMutation(mutation: VerifiedSmsWebhookMutation): void {
  const candidate = row(mutation);
  if (mutation.kind === "inbound") {
    exactKeys(candidate, ["kind", "expectedContext", "event", "consent", "usage"]);
  } else if (mutation.kind === "status") {
    exactKeys(candidate, ["kind", "expectedContext", "event", "deliveryState", "usage"]);
  } else {
    fail();
  }
  const context = validateExpectedContext(mutation.expectedContext);
  validateContextForRouting(
    mutation.kind === "inbound"
      ? { kind: "inbound_number", value: mutation.event.toPhoneNumber }
      : { kind: "outbound_message", value: mutation.event.providerMessageId },
    context,
  );
  if (mutation.kind === "inbound") validateInboundMutation(mutation);
  else validateStatusMutation(mutation);
}

function resultFrom(
  value: unknown,
  mutation: VerifiedSmsWebhookMutation,
): ApplyVerifiedEventResult {
  const candidate = row(value);
  exactKeys(candidate, RESULT_KEYS);
  if (
    typeof candidate.duplicate !== "boolean" ||
    typeof candidate.deletedContact !== "boolean"
  ) {
    return fail();
  }
  const result = {
    duplicate: candidate.duplicate,
    contactId: nullableString(candidate.contactId),
    inboundMessageId: nullableString(candidate.inboundMessageId),
    deletedContact: candidate.deletedContact,
    associatedCampaignRecipientId: nullableString(
      candidate.associatedCampaignRecipientId,
    ),
  };
  if (!result.duplicate && mutation.kind === "inbound") {
    if (result.contactId === null || result.inboundMessageId === null) fail();
  }
  if (!result.duplicate && mutation.kind === "status") {
    if (result.inboundMessageId !== null) fail();
    const expected = mutation.expectedContext;
    if (
      expected.contactId !== null &&
      expected.contactId !== result.contactId
    ) {
      fail("correlation_mismatch");
    }
    if (
      expected.campaignRecipientId !== null &&
      expected.campaignRecipientId !== result.associatedCampaignRecipientId
    ) {
      fail("correlation_mismatch");
    }
  }
  return result;
}

export class SupabaseSmsWebhookRepository implements SmsWebhookRepository {
  constructor(private readonly client: SupabaseClient) {}

  async resolveWebhookContext(
    routingKey: SmsWebhookRoutingKey,
  ): Promise<ResolvedSmsWebhookContext | null> {
    if (
      (routingKey.kind !== "inbound_number" &&
        routingKey.kind !== "outbound_message") ||
      !routingKey.value.trim()
    ) {
      fail("invalid_routing_key");
    }
    const { data, error } = await this.client.rpc(
      "resolve_sms_webhook_context",
      { p_kind: routingKey.kind, p_value: routingKey.value },
    );
    if (error) fail("resolve_context");
    if (data === null) return null;
    const context = contextFrom(data);
    validateContextForRouting(routingKey, context);
    return context;
  }

  async applyVerifiedEvent(
    mutation: VerifiedSmsWebhookMutation,
  ): Promise<ApplyVerifiedEventResult> {
    validateMutation(mutation);
    const { data, error } = await this.client.rpc(
      "apply_verified_sms_webhook_event",
      { p_mutation: mutation },
    );
    if (error) fail("apply_event");
    return resultFrom(data, mutation);
  }
}
