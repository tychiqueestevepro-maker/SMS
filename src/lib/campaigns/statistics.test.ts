import { describe, expect, it } from "vitest";

import {
  calculateCampaignStatistics,
  isSuccessfullySentOutbound,
} from "./statistics";
import type {
  CampaignStatisticsOutboundMessage,
  CampaignStatisticsRecipient,
} from "./types";

describe("successfully sent definition", () => {
  it("counts accepted messages with a null delivery state", () => {
    expect(
      isSuccessfullySentOutbound({
        campaignRecipientId: "recipient-1",
        dispatchState: "accepted",
        deliveryState: null,
        acceptedAt: "2026-08-10T10:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("excludes explicit failures and reservations that never sent", () => {
    expect(
      isSuccessfullySentOutbound({
        campaignRecipientId: "recipient-1",
        dispatchState: "accepted",
        deliveryState: "failed",
        acceptedAt: "2026-08-10T10:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      isSuccessfullySentOutbound({
        campaignRecipientId: "recipient-1",
        dispatchState: "reserved",
        deliveryState: null,
        acceptedAt: null,
      }),
    ).toBe(false);
  });
});

describe("calculateCampaignStatistics", () => {
  const recipients: CampaignStatisticsRecipient[] = [
    {
      id: "replied",
      state: "stopped",
      hasPendingStep: false,
      repliedAt: "2026-08-10T11:00:00.000Z",
    },
    {
      id: "accepted-null",
      state: "active",
      hasPendingStep: true,
      repliedAt: null,
    },
    {
      id: "later-failed",
      state: "stopped",
      hasPendingStep: false,
      repliedAt: "2026-08-10T11:00:00.000Z",
    },
    {
      id: "never-sent",
      state: "stopped",
      hasPendingStep: false,
      repliedAt: null,
    },
    {
      id: "active-finished",
      state: "active",
      hasPendingStep: false,
      repliedAt: null,
    },
  ];

  const messages: CampaignStatisticsOutboundMessage[] = [
    {
      campaignRecipientId: "replied",
      dispatchState: "accepted",
      deliveryState: "sent",
      acceptedAt: "2026-08-10T10:00:00.000Z",
    },
    {
      campaignRecipientId: "accepted-null",
      dispatchState: "accepted",
      deliveryState: null,
      acceptedAt: "2026-08-10T10:00:00.000Z",
    },
    {
      campaignRecipientId: "later-failed",
      dispatchState: "accepted",
      deliveryState: "failed",
      acceptedAt: "2026-08-10T10:00:00.000Z",
    },
    {
      campaignRecipientId: "never-sent",
      dispatchState: "reserved",
      deliveryState: null,
      acceptedAt: null,
    },
  ];

  it("uses unique successfully-sent recipients for the reply-rate denominator", () => {
    expect(calculateCampaignStatistics(recipients, messages)).toEqual({
      replies: 1,
      sentRecipients: 2,
      replyRate: 0.5,
      remaining: 1,
    });
  });

  it("recalculates when a previously accepted message becomes failed", () => {
    const updatedMessages = messages.map((message) =>
      message.campaignRecipientId === "accepted-null"
        ? { ...message, deliveryState: "failed" as const }
        : message,
    );
    expect(calculateCampaignStatistics(recipients, updatedMessages)).toMatchObject({
      replies: 1,
      sentRecipients: 1,
      replyRate: 1,
    });
  });

  it("does not count a reply timestamp that predates the successful send", () => {
    const earlyReplyRecipients = recipients.map((recipient) =>
      recipient.id === "replied"
        ? { ...recipient, repliedAt: "2026-08-10T09:00:00.000Z" }
        : recipient,
    );
    expect(calculateCampaignStatistics(earlyReplyRecipients, messages).replies).toBe(0);
  });

  it("keeps a recipient in the denominator when another accepted message remains", () => {
    const withSecondAccepted = [
      ...messages,
      {
        campaignRecipientId: "later-failed",
        dispatchState: "accepted" as const,
        deliveryState: null,
        acceptedAt: "2026-08-10T10:30:00.000Z",
      },
    ];
    expect(calculateCampaignStatistics(recipients, withSecondAccepted)).toMatchObject({
      replies: 2,
      sentRecipients: 3,
      replyRate: 2 / 3,
    });
  });

  it("counts recipient identifiers only once", () => {
    expect(
      calculateCampaignStatistics([...recipients, recipients[0]!], messages),
    ).toEqual({
      replies: 1,
      sentRecipients: 2,
      replyRate: 0.5,
      remaining: 1,
    });
  });
});
