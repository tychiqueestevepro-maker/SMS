import { normalizePhoneNumber } from "../contacts/phone";
import { InboxProductError } from "./errors";
import type {
  InboxContactSource,
  InboundContactResolution,
} from "./types";

function contactLabel(contact: InboxContactSource): string {
  if (contact.deletedAt !== null) return "Deleted contact";
  const name = `${contact.firstName} ${contact.lastName}`.trim();
  return name || contact.phoneE164;
}

export interface ResolveInboundContactInput {
  fromPhoneNumber: string;
  contactsIncludingDeleted: readonly InboxContactSource[];
  defaultPipelineStageId: string;
  suppressedPhoneNumbers?: ReadonlySet<string> | readonly string[];
}

export function resolveInboundContact(
  input: ResolveInboundContactInput,
): InboundContactResolution {
  const phoneE164 = normalizePhoneNumber(input.fromPhoneNumber);
  if (!phoneE164) {
    throw new InboxProductError("INVALID_PHONE_NUMBER");
  }

  const existing = input.contactsIncludingDeleted.find(
    (contact) => contact.phoneE164 === phoneE164,
  );
  if (existing) {
    const deletedContact = existing.deletedAt !== null;
    return {
      kind: "existing",
      phoneE164,
      contactId: existing.id,
      displayLabel: contactLabel(existing),
      readOnly: deletedContact,
      deletedContact,
      isSuppressed: existing.isSuppressed,
      shouldRestoreContact: false,
      resumeCampaigns: false,
      createContact: null,
    };
  }

  const suppressed = input.suppressedPhoneNumbers
    ? new Set(input.suppressedPhoneNumbers).has(phoneE164)
    : false;
  return {
    kind: "create_minimal",
    phoneE164,
    contactId: null,
    displayLabel: phoneE164,
    readOnly: false,
    deletedContact: false,
    isSuppressed: suppressed,
    shouldRestoreContact: false,
    resumeCampaigns: false,
    createContact: {
      firstName: "",
      lastName: "",
      company: "",
      phoneE164,
      pipelineStageId: input.defaultPipelineStageId,
    },
  };
}
