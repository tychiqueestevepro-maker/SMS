import { describe, expect, it } from "vitest";

import { associateReplyWithCampaign, stopRecipientForReply } from "./replies";

describe("associateReplyWithCampaign", () => {
  it("selects the latest successfully sent campaign outbound for the same contact and number", () => {
    const association = associateReplyWithCampaign(
      {
        contactId: "contact-1",
        phoneNumberId: "number-1",
        receivedAt: "2026-08-10T12:00:00.000Z",
      },
      [
        {
          id: "matching-older",
          contactId: "contact-1",
          phoneNumberId: "number-1",
          campaignId: "campaign-1",
          campaignRecipientId: "recipient-1",
          dispatchState: "accepted",
          deliveryState: null,
          acceptedAt: "2026-08-10T10:00:00.000Z",
        },
        {
          id: "matching-newer",
          contactId: "contact-1",
          phoneNumberId: "number-1",
          campaignId: "campaign-2",
          campaignRecipientId: "recipient-2",
          dispatchState: "accepted",
          deliveryState: "sent",
          acceptedAt: "2026-08-10T11:00:00.000Z",
        },
        {
          id: "explicitly-failed",
          contactId: "contact-1",
          phoneNumberId: "number-1",
          campaignId: "campaign-3",
          campaignRecipientId: "recipient-3",
          dispatchState: "accepted",
          deliveryState: "failed",
          acceptedAt: "2026-08-10T11:30:00.000Z",
        },
        {
          id: "wrong-number",
          contactId: "contact-1",
          phoneNumberId: "number-2",
          campaignId: "campaign-4",
          campaignRecipientId: "recipient-4",
          dispatchState: "accepted",
          deliveryState: "delivered",
          acceptedAt: "2026-08-10T11:45:00.000Z",
        },
        {
          id: "after-reply",
          contactId: "contact-1",
          phoneNumberId: "number-1",
          campaignId: "campaign-5",
          campaignRecipientId: "recipient-5",
          dispatchState: "accepted",
          deliveryState: null,
          acceptedAt: "2026-08-10T12:01:00.000Z",
        },
      ],
    );

    expect(association).toEqual({
      outboundMessageId: "matching-newer",
      campaignId: "campaign-2",
      campaignRecipientId: "recipient-2",
    });
  });
});

describe("stopRecipientForReply", () => {
  it("stops an active recipient without ever resuming a campaign", () => {
    expect(
      stopRecipientForReply(
        {
          id: "recipient-1",
          state: "active",
          nextSendAt: "2026-08-11T10:00:00.000Z",
          stoppedAt: null,
        },
        "2026-08-10T12:00:00.000Z",
      ),
    ).toEqual({
      recipient: {
        id: "recipient-1",
        state: "replied",
        nextSendAt: null,
        stoppedAt: "2026-08-10T12:00:00.000Z",
      },
      changed: true,
      resumeCampaigns: false,
    });
  });

  it("leaves an already stopped recipient unchanged", () => {
    expect(
      stopRecipientForReply(
        {
          id: "recipient-1",
          state: "opted_out",
          nextSendAt: null,
          stoppedAt: "2026-08-09T12:00:00.000Z",
        },
        "2026-08-10T12:00:00.000Z",
      ).changed,
    ).toBe(false);
  });
});
