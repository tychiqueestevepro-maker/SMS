import type {
  CampaignOutboundForReply,
  InboxCampaignRecipient,
  InboundReplySource,
  ReplyCampaignAssociation,
  StopRecipientForReplyResult,
} from "./types";

function timestamp(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function associateReplyWithCampaign(
  inbound: InboundReplySource,
  outboundMessages: readonly CampaignOutboundForReply[],
): ReplyCampaignAssociation | null {
  const receivedAt = timestamp(inbound.receivedAt);
  if (receivedAt === null) throw new RangeError("Invalid inbound timestamp.");

  const relevant = outboundMessages
    .filter(
      (message) =>
        message.contactId === inbound.contactId &&
        message.phoneNumberId === inbound.phoneNumberId &&
        message.campaignId !== null &&
        message.campaignRecipientId !== null &&
        message.dispatchState === "accepted" &&
        message.deliveryState !== "failed",
    )
    .map((message) => ({ message, acceptedAt: timestamp(message.acceptedAt) }))
    .filter(
      (
        candidate,
      ): candidate is { message: CampaignOutboundForReply; acceptedAt: number } =>
        candidate.acceptedAt !== null && candidate.acceptedAt <= receivedAt,
    )
    .sort(
      (left, right) =>
        right.acceptedAt - left.acceptedAt ||
        right.message.id.localeCompare(left.message.id),
    );

  const match = relevant[0]?.message;
  if (!match || !match.campaignId || !match.campaignRecipientId) return null;
  return {
    outboundMessageId: match.id,
    campaignId: match.campaignId,
    campaignRecipientId: match.campaignRecipientId,
  };
}

export function stopRecipientForReply(
  recipient: InboxCampaignRecipient,
  receivedAt: string,
): StopRecipientForReplyResult {
  const stoppedAt = new Date(receivedAt);
  if (!Number.isFinite(stoppedAt.getTime())) {
    throw new RangeError("Invalid reply timestamp.");
  }

  if (recipient.state !== "active") {
    return { recipient: { ...recipient }, changed: false, resumeCampaigns: false };
  }

  return {
    recipient: {
      ...recipient,
      state: "replied",
      nextSendAt: null,
      stoppedAt: stoppedAt.toISOString(),
    },
    changed: true,
    resumeCampaigns: false,
  };
}
