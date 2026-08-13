import { describe, expect, it } from "vitest";

import { groupInboxConversations } from "./conversations";

describe("groupInboxConversations", () => {
  it("groups by contact and Riink phone number, normalizes order and marks deleted contacts", () => {
    const conversations = groupInboxConversations(
      [
        {
          id: "message-2",
          contactId: "deleted-contact",
          phoneNumberId: "number-1",
          direction: "inbound",
          body: "Reply",
          occurredAt: "2026-08-10T12:02:00Z",
          deliveryStatus: "delivered",
          providerMessageId: "internal-message-id",
          providerErrorCode: "INTERNAL_CODE",
        },
        {
          id: "message-1",
          contactId: "deleted-contact",
          phoneNumberId: "number-1",
          direction: "outbound",
          body: "Hello",
          occurredAt: "2026-08-10T12:00:00Z",
          deliveryStatus: "sent",
        },
        {
          id: "message-3",
          contactId: "active-contact",
          phoneNumberId: "number-2",
          direction: "inbound",
          body: "Later",
          occurredAt: "2026-08-10T13:00:00Z",
          deliveryStatus: "delivered",
        },
        // Duplicate webhook material must not duplicate rendered messages.
        {
          id: "message-2",
          contactId: "deleted-contact",
          phoneNumberId: "number-1",
          direction: "inbound",
          body: "Reply",
          occurredAt: "2026-08-10T12:02:00Z",
          deliveryStatus: "delivered",
        },
      ],
      [
        {
          id: "deleted-contact",
          phoneE164: "+15125550192",
          firstName: "Deleted",
          lastName: "Contact",
          company: "",
          jobTitle: "",
          notes: "",
          deletedAt: "2026-08-01T00:00:00.000Z",
          isSuppressed: false,
          hasUnreadMessages: false,
        },
        {
          id: "active-contact",
          phoneE164: "+14155550104",
          firstName: "Grace",
          lastName: "Hopper",
          company: "",
          jobTitle: "",
          notes: "",
          deletedAt: null,
          isSuppressed: false,
          hasUnreadMessages: false,
        },
      ],
      [
        { id: "number-1", phoneNumber: "2025550101", status: "ready" },
        { id: "number-2", phoneNumber: "+1 212 555 0102", status: "ready" },
      ],
    );

    expect(conversations.map(({ id }) => id)).toEqual([
      "active-contact:number-2",
      "deleted-contact:number-1",
    ]);
    expect(conversations[1]).toMatchObject({
      contactLabel: "Deleted contact",
      deletedContact: true,
      readOnly: true,
      contactPhoneNumber: "+15125550192",
      phoneNumber: "+12025550101",
    });
    expect(conversations[1]?.messages.map(({ id }) => id)).toEqual([
      "message-1",
      "message-2",
    ]);
    expect(JSON.stringify(conversations)).not.toContain("internal-message-id");
    expect(JSON.stringify(conversations)).not.toContain("INTERNAL_CODE");
  });
});
