import { parseConsentCommand } from "../../inbox/compliance";
import { toDeliveryState } from "./status";
import type {
  NormalizedSmsWebhookEvent,
  NormalizedWebhookConsent,
  ResolvedSmsWebhookContext,
  VerifiedSmsWebhookMutation,
  WebhookUsageObservation,
} from "./types";

export function normalizeWebhookConsent(
  body: string,
  confirmedConsent: "opt_out" | "opt_in" | "help" | null,
): NormalizedWebhookConsent {
  const parsed = parseConsentCommand(body);
  if (parsed.command === "opt_out" || confirmedConsent === "opt_out") {
    return {
      command: "opt_out",
      keyword: parsed.command === "opt_out" ? parsed.keyword : null,
      suppressionAction: "upsert_and_stop",
      stopForReplyWhenAssociated: false,
      resumeCampaigns: false,
    };
  }
  if (parsed.command === "opt_in" && confirmedConsent === "opt_in") {
    return {
      ...parsed,
      suppressionAction: "remove_without_resume",
      stopForReplyWhenAssociated: true,
      resumeCampaigns: false,
    };
  }
  return {
    ...parsed,
    suppressionAction: "none",
    stopForReplyWhenAssociated: true,
    resumeCampaigns: false,
  };
}

export function buildVerifiedSmsWebhookMutation(
  expectedContext: ResolvedSmsWebhookContext,
  event: NormalizedSmsWebhookEvent,
  usage: WebhookUsageObservation,
): VerifiedSmsWebhookMutation {
  if (event.kind === "inbound") {
    return {
      kind: "inbound",
      expectedContext,
      event: {
        ...event,
        occurredAt: new Date(event.occurredAt).toISOString(),
      },
      consent: normalizeWebhookConsent(event.body, event.confirmedConsent),
      usage: {
        direction: "inbound",
        numSegments: usage.actualSegments,
        providerCostMicroUsd: usage.providerCostMicroUsd,
        includedSegments: 0,
        overageSegments: 0,
        customerBillableAmountMicroUsd: 0,
      },
    };
  }
  return {
    kind: "status",
    expectedContext,
    event: {
      ...event,
      occurredAt: new Date(event.occurredAt).toISOString(),
    },
    deliveryState: toDeliveryState(event.status),
    usage,
  };
}
