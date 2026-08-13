import { normalizePhoneNumber } from "../contacts/phone";
import type {
  InboxContactSource,
  InboxConversationDto,
  InboxMessageDto,
  InboxMessageSource,
  InboxPhoneNumberSource,
} from "./types";

function normalizeTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("Invalid message timestamp.");
  }
  return date.toISOString();
}

function toMessageDto(message: InboxMessageSource): InboxMessageDto {
  return {
    id: message.id,
    direction: message.direction,
    body: message.body,
    occurredAt: normalizeTimestamp(message.occurredAt),
    deliveryStatus: message.deliveryStatus,
    campaignId: message.campaignId,
    stepOrder: message.stepOrder,
  };
}

function conversationId(contactId: string, phoneNumberId: string): string {
  return `${contactId}:${phoneNumberId}`;
}

function displayContact(contact: InboxContactSource | undefined): {
  label: string;
  phoneNumber: string;
  company: string;
  jobTitle: string;
  notes: string;
  deleted: boolean;
  hasUnreadMessages: boolean;
} {
  if (!contact) {
    return { label: "Unknown contact", phoneNumber: "", company: "", jobTitle: "", notes: "", deleted: false, hasUnreadMessages: false };
  }
  if (contact.deletedAt !== null) {
    return {
      label: "Deleted contact",
      phoneNumber: contact.phoneE164,
      company: "",
      jobTitle: "",
      notes: "",
      deleted: true,
      hasUnreadMessages: contact.hasUnreadMessages,
    };
  }
  const name = `${contact.firstName} ${contact.lastName}`.trim();
  return {
    label: name || contact.phoneE164,
    phoneNumber: contact.phoneE164,
    company: contact.company ?? "",
    jobTitle: contact.jobTitle ?? "",
    notes: contact.notes ?? "",
    deleted: false,
    hasUnreadMessages: contact.hasUnreadMessages,
  };
}

export function groupInboxConversations(
  messages: readonly InboxMessageSource[],
  contacts: readonly InboxContactSource[],
  phoneNumbers: readonly InboxPhoneNumberSource[],
): InboxConversationDto[] {
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const phoneNumberById = new Map(
    phoneNumbers.map((phoneNumber) => [phoneNumber.id, phoneNumber]),
  );
  const uniqueMessages = new Map<string, InboxMessageSource>();
  for (const message of messages) {
    if (!uniqueMessages.has(message.id)) uniqueMessages.set(message.id, message);
  }

  const grouped = new Map<string, InboxMessageSource[]>();
  for (const message of uniqueMessages.values()) {
    const id = conversationId(message.contactId, message.phoneNumberId);
    const conversationMessages = grouped.get(id) ?? [];
    conversationMessages.push(message);
    grouped.set(id, conversationMessages);
  }

  return Array.from(grouped, ([id, sourceMessages]) => {
    const sortedMessages = sourceMessages
      .map(toMessageDto)
      .sort(
        (left, right) =>
          Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
          left.id.localeCompare(right.id),
      );
    const source = sourceMessages[0]!;
    const contact = displayContact(contactById.get(source.contactId));
    const sendingNumber = phoneNumberById.get(source.phoneNumberId);
    const normalizedSendingNumber = sendingNumber
      ? normalizePhoneNumber(sendingNumber.phoneNumber) ?? sendingNumber.phoneNumber
      : "";

    return {
      id,
      contactId: source.contactId,
      phoneNumberId: source.phoneNumberId,
      contactLabel: contact.label,
      contactCompany: contact.company,
      contactJobTitle: contact.jobTitle,
      contactNotes: contact.notes,
      contactPhoneNumber: contact.phoneNumber,
      deletedContact: contact.deleted,
      hasUnreadMessages: contact.hasUnreadMessages,
      phoneNumber: normalizedSendingNumber,
      readOnly: contact.deleted,
      lastMessageAt: sortedMessages.at(-1)!.occurredAt,
      messages: sortedMessages,
    };
  }).sort(
    (left, right) =>
      Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt) ||
      left.id.localeCompare(right.id),
  );
}
