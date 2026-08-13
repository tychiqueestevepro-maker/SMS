import { describe, expect, it } from "vitest";

import { resolveInboundContact } from "./inbound";

describe("resolveInboundContact", () => {
  it("reuses a soft-deleted contact without restoring it", () => {
    const result = resolveInboundContact({
      fromPhoneNumber: "(512) 555-0192",
      defaultPipelineStageId: "stage-default",
      contactsIncludingDeleted: [
        {
          id: "deleted-contact",
          phoneE164: "+15125550192",
          firstName: "Ada",
          lastName: "Lovelace",
          company: "",
          jobTitle: "",
          notes: "",
          deletedAt: "2026-08-01T00:00:00.000Z",
          isSuppressed: true,
          hasUnreadMessages: false,
        },
      ],
    });

    expect(result).toEqual({
      kind: "existing",
      phoneE164: "+15125550192",
      contactId: "deleted-contact",
      displayLabel: "Deleted contact",
      readOnly: true,
      deletedContact: true,
      isSuppressed: true,
      shouldRestoreContact: false,
      resumeCampaigns: false,
      createContact: null,
    });
  });

  it("creates a minimal unknown contact in the explicit default stage", () => {
    const result = resolveInboundContact({
      fromPhoneNumber: "4155550104",
      defaultPipelineStageId: "stage-default",
      contactsIncludingDeleted: [],
      suppressedPhoneNumbers: ["+14155550104"],
    });

    expect(result).toMatchObject({
      kind: "create_minimal",
      contactId: null,
      phoneE164: "+14155550104",
      displayLabel: "+14155550104",
      isSuppressed: true,
      shouldRestoreContact: false,
      resumeCampaigns: false,
      createContact: {
        firstName: "",
        lastName: "",
        company: "",
        phoneE164: "+14155550104",
        pipelineStageId: "stage-default",
      },
    });
  });
});
