import { escapeCsvValue } from "./csv-parser";
import type { ContactExportRecord } from "./types";

export const CONTACT_EXPORT_HEADERS = [
  "first_name",
  "last_name",
  "job_title",
  "company",
  "phone",
  "pipeline_stage",
  "last_contacted_at",
  "last_replied_at",
  "created_at",
] as const;

function neutralizeSpreadsheetFormula(value: string): string {
  return /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
}

export function formatContactsCsv(
  contacts: readonly ContactExportRecord[],
): string {
  const activeContacts = contacts.filter((contact) => !contact.deletedAt);
  const rows = activeContacts.map((contact) => [
    neutralizeSpreadsheetFormula(contact.firstName),
    neutralizeSpreadsheetFormula(contact.lastName),
    neutralizeSpreadsheetFormula(contact.jobTitle ?? ""),
    neutralizeSpreadsheetFormula(contact.company),
    contact.phoneE164,
    neutralizeSpreadsheetFormula(contact.pipelineStage),
    contact.lastContactedAt ?? "",
    contact.lastRepliedAt ?? "",
    contact.createdAt,
  ]);

  return [CONTACT_EXPORT_HEADERS, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\r\n");
}
