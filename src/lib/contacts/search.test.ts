import { describe, expect, it } from "vitest";

import { searchAndFilterContacts, toContactListItemDto } from "./search";
import type { ContactSearchSource } from "./types";

const CONTACTS: ContactSearchSource[] = [
  {
    id: "contact-1",
    firstName: "Ada",
    lastName: "Lovelace",
    company: "Analytical Engines",
    phoneE164: "+15125550192",
    countryCode: "US",
    pipelineStageId: "stage-new",
    pipelineStageName: "New",
    activeCampaignName: "Summer outreach",
    lastContactedAt: "2026-08-01T10:00:00.000Z",
    lastRepliedAt: "2026-08-02T10:00:00.000Z",
    createdAt: "2026-07-01T09:00:00.000Z",
    deletedAt: null,
    isSuppressed: false,
  },
  {
    id: "contact-2",
    firstName: "Grace",
    lastName: "Hopper",
    company: "Navy",
    phoneE164: "+12125550100",
    countryCode: "US",
    pipelineStageId: "stage-qualified",
    pipelineStageName: "Qualified",
    activeCampaignName: null,
    lastContactedAt: null,
    lastRepliedAt: null,
    createdAt: "2026-07-02T09:00:00.000Z",
    deletedAt: null,
    isSuppressed: true,
  },
  {
    id: "contact-deleted",
    firstName: "Deleted",
    lastName: "Person",
    company: "Hidden",
    phoneE164: "+13105550103",
    countryCode: "US",
    pipelineStageId: "stage-new",
    pipelineStageName: "New",
    activeCampaignName: null,
    lastContactedAt: null,
    lastRepliedAt: null,
    createdAt: "2026-07-03T09:00:00.000Z",
    deletedAt: "2026-08-03T09:00:00.000Z",
    isSuppressed: false,
  },
];

describe("contact list DTOs and filters", () => {
  it("uses product concepts and derives the latest activity", () => {
    expect(toContactListItemDto(CONTACTS[0]!)).toEqual({
      id: "contact-1",
      name: "Ada Lovelace",
      firstName: "Ada",
      lastName: "Lovelace",
      company: "Analytical Engines",
      phoneNumber: "+15125550192",
      countryCode: "US",
      pipelineStage: { id: "stage-new", name: "New" },
      campaignName: "Summer outreach",
      lastActivityAt: "2026-08-02T10:00:00.000Z",
      hasReplied: true,
      optedOut: false,
    });
  });

  it("searches name, company and phone while excluding soft-deleted contacts", () => {
    const query = { filter: "all" as const, view: "list" as const };
    expect(
      searchAndFilterContacts(CONTACTS, { ...query, search: "Ada Love" }).map(
        (contact) => contact.id,
      ),
    ).toEqual(["contact-1"]);
    expect(
      searchAndFilterContacts(CONTACTS, { ...query, search: "navy" }).map(
        (contact) => contact.id,
      ),
    ).toEqual(["contact-2"]);
    expect(
      searchAndFilterContacts(CONTACTS, { ...query, search: "512555" }).map(
        (contact) => contact.id,
      ),
    ).toEqual(["contact-1"]);
    expect(
      searchAndFilterContacts(CONTACTS, { ...query, search: "Deleted" }),
    ).toEqual([]);
  });

  it("supports only the locked replied and opted-out filters", () => {
    expect(
      searchAndFilterContacts(CONTACTS, {
        search: "",
        filter: "replied",
        view: "pipeline",
      }).map((contact) => contact.id),
    ).toEqual(["contact-1"]);
    expect(
      searchAndFilterContacts(CONTACTS, {
        search: "",
        filter: "opted_out",
        view: "list",
      }).map((contact) => contact.id),
    ).toEqual(["contact-2"]);
  });
});
