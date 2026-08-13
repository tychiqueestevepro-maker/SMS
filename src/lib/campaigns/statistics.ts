import type {
  CampaignStatistics,
  CampaignStatisticsOutboundMessage,
  CampaignStatisticsRecipient,
} from "./types";

/** SQL equivalent: accepted AND delivery_state IS DISTINCT FROM 'failed'. */
export function isSuccessfullySentOutbound(
  message: CampaignStatisticsOutboundMessage,
): boolean {
  return (
    message.dispatchState === "accepted" && message.deliveryState !== "failed"
  );
}

function replyOccurredAfterMessage(
  repliedAt: string,
  acceptedAt: string | null,
): boolean {
  if (acceptedAt === null) return false;
  const replyTime = Date.parse(repliedAt);
  const acceptedTime = Date.parse(acceptedAt);
  return (
    Number.isFinite(replyTime) &&
    Number.isFinite(acceptedTime) &&
    replyTime > acceptedTime
  );
}

export function calculateCampaignStatistics(
  recipients: readonly CampaignStatisticsRecipient[],
  outboundMessages: readonly CampaignStatisticsOutboundMessage[],
): CampaignStatistics {
  const uniqueRecipients = Array.from(
    new Map(recipients.map((recipient) => [recipient.id, recipient])).values(),
  );
  const recipientIds = new Set(uniqueRecipients.map(({ id }) => id));
  const successfulMessages = outboundMessages.filter(
    (message) =>
      recipientIds.has(message.campaignRecipientId) &&
      isSuccessfullySentOutbound(message),
  );
  const sentRecipientIds = new Set(
    successfulMessages.map(({ campaignRecipientId }) => campaignRecipientId),
  );

  let replies = 0;
  for (const recipient of uniqueRecipients) {
    if (!recipient.repliedAt || !sentRecipientIds.has(recipient.id)) continue;
    const repliedAfterSuccessfulSend = successfulMessages.some(
      (message) =>
        message.campaignRecipientId === recipient.id &&
        replyOccurredAfterMessage(recipient.repliedAt!, message.acceptedAt),
    );
    if (repliedAfterSuccessfulSend) replies += 1;
  }

  const sentRecipients = sentRecipientIds.size;
  const remaining = uniqueRecipients.filter(
    (recipient) => recipient.state === "active" && recipient.hasPendingStep,
  ).length;

  return {
    replies,
    sentRecipients,
    replyRate: sentRecipients === 0 ? 0 : replies / sentRecipients,
    remaining,
  };
}
