import { phoneSearchKey } from "./phone";
import type {
  ContactListItemDto,
  ContactListQueryDto,
  ContactSearchSource,
} from "./types";

function latestTimestamp(
  left: string | null,
  right: string | null,
): string | null {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

export function toContactListItemDto(
  contact: ContactSearchSource,
): ContactListItemDto {
  const fullName = `${contact.firstName} ${contact.lastName}`.trim();
  return {
    id: contact.id,
    name: fullName || contact.phoneE164,
    firstName: contact.firstName,
    lastName: contact.lastName,
    jobTitle: contact.jobTitle,
    company: contact.company,
    phoneNumber: contact.phoneE164,
    countryCode: contact.countryCode,
    pipelineStage: {
      id: contact.pipelineStageId,
      name: contact.pipelineStageName,
    },
    campaignName: contact.activeCampaignName,
    lastActivityAt: latestTimestamp(
      contact.lastContactedAt,
      contact.lastRepliedAt,
    ),
    hasReplied: contact.lastRepliedAt !== null,
    optedOut: contact.isSuppressed,
  };
}

function matchesSearch(contact: ContactSearchSource, search: string): boolean {
  const normalizedSearch = search.trim().toLocaleLowerCase("en-US");
  if (!normalizedSearch) {
    return true;
  }

  const fullName = `${contact.firstName} ${contact.lastName}`.trim().toLowerCase();
  const textMatch = [fullName, contact.company.toLowerCase(), contact.jobTitle?.toLowerCase() ?? ""].some(
    (field) => field.includes(normalizedSearch),
  );
  if (textMatch) {
    return true;
  }

  const phoneQuery = phoneSearchKey(normalizedSearch);
  return phoneQuery.length > 0 && phoneSearchKey(contact.phoneE164).includes(phoneQuery);
}

function matchesFilter(
  contact: ContactSearchSource,
  filter: ContactListQueryDto["filter"],
): boolean {
  if (filter === "replied") {
    return contact.lastRepliedAt !== null;
  }
  if (filter === "opted_out") {
    return contact.isSuppressed;
  }
  return true;
}

export function searchAndFilterContacts(
  contacts: readonly ContactSearchSource[],
  query: ContactListQueryDto,
): ContactListItemDto[] {
  return contacts
    .filter((contact) => contact.deletedAt === null)
    .filter((contact) => matchesSearch(contact, query.search))
    .filter((contact) => matchesFilter(contact, query.filter))
    .map(toContactListItemDto);
}
