import type {
  DispatchClaim,
  DispatchLogEvent,
  DispatchLogger,
  ReconciliationClaim,
} from "./types";

export function correlationLogFields(
  correlation: DispatchClaim | ReconciliationClaim,
): Pick<
  DispatchLogEvent,
  | "workspace_id"
  | "campaign_id"
  | "campaign_recipient_id"
  | "contact_id"
  | "message_id"
> {
  return {
    workspace_id: correlation.workspaceId,
    campaign_id: correlation.campaignId,
    campaign_recipient_id: correlation.campaignRecipientId,
    contact_id: correlation.contactId,
    message_id: correlation.messageId,
  };
}

export async function writeDispatchLog(
  logger: DispatchLogger | undefined,
  event: DispatchLogEvent,
): Promise<void> {
  if (!logger) return;
  try {
    await logger(event);
  } catch {
    // Observability must never alter dispatch state or cause a second send.
  }
}

