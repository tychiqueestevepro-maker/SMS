import { isEmptyCsvRow, parseCsvRows } from "./csv-parser";
import { parseAndNormalizePhoneNumber } from "./phone";
import type {
  ContactCsvField,
  ContactCsvHeaderMapping,
  ContactImportOperation,
  ContactImportPreview,
  ContactImportPreviewCounts,
  ContactImportPreviewRow,
  ExistingContactMatch,
  PreviewContactCsvOptions,
} from "./types";

const HEADER_ALIASES: Record<string, ContactCsvField> = {
  first_name: "firstName",
  "first name": "firstName",
  firstname: "firstName",
  last_name: "lastName",
  "last name": "lastName",
  lastname: "lastName",
  poste: "jobTitle",
  "job title": "jobTitle",
  job_title: "jobTitle",
  role: "jobTitle",
  title: "jobTitle",
  company: "company",
  phone: "phone",
  phone_number: "phone",
  "phone number": "phone",
  mobile: "phone",
};

function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, "").trim().toLowerCase();
}

export function mapContactCsvHeaders(
  headers: readonly string[],
): ContactCsvHeaderMapping {
  const columns: Partial<Record<ContactCsvField, number>> = {};
  const unknownHeaders: string[] = [];
  const duplicateFields = new Set<ContactCsvField>();

  headers.forEach((header, index) => {
    const field = HEADER_ALIASES[normalizeHeader(header)];
    if (!field) {
      if (header.trim()) {
        unknownHeaders.push(header);
      }
      return;
    }

    if (columns[field] !== undefined) {
      duplicateFields.add(field);
      return;
    }
    columns[field] = index;
  });

  const issues: ContactCsvHeaderMapping["issues"] = Array.from(
    duplicateFields,
    (field) => ({ code: "duplicate_mapped_header" as const, field }),
  );
  if (columns.phone === undefined) {
    issues.push({ code: "missing_phone_header" });
  }

  return { columns, unknownHeaders, issues };
}

function valueAt(row: readonly string[], index: number | undefined): string {
  return index === undefined ? "" : (row[index] ?? "").trim();
}

function toExistingContactMap(
  contacts: readonly ExistingContactMatch[],
): Map<string, ExistingContactMatch> {
  const entries = contacts.map((contact) => [contact.phoneE164, contact] as const);
  return new Map(entries);
}

function toSuppressedPhoneSet(
  value: PreviewContactCsvOptions["suppressedPhoneNumbers"],
): ReadonlySet<string> {
  if (!value) {
    return new Set();
  }
  return value instanceof Set ? value : new Set(value);
}

function countRows(rows: readonly ContactImportPreviewRow[]): ContactImportPreviewCounts {
  return rows.reduce<ContactImportPreviewCounts>(
    (counts, row) => {
      if (row.disposition === "ready") {
        counts.ready += 1;
      } else if (row.disposition === "duplicate") {
        counts.duplicates += 1;
      } else {
        counts.invalid += 1;
      }

      if (row.action === "restore") {
        counts.restorations += 1;
      }
      return counts;
    },
    { ready: 0, duplicates: 0, invalid: 0, restorations: 0 },
  );
}

export function previewContactCsv(
  csv: string,
  options: PreviewContactCsvOptions = {},
): ContactImportPreview {
  const parsedRows = parseCsvRows(csv);
  const headers = parsedRows[0] ?? [];
  const mapping = mapContactCsvHeaders(headers);
  const dataRows = parsedRows.slice(1).filter((row) => !isEmptyCsvRow(row));
  const existingContacts = toExistingContactMap(options.existingContacts ?? []);
  const suppressedPhones = toSuppressedPhoneSet(options.suppressedPhoneNumbers);
  const phonesSeenInFile = new Set<string>();

  const rows = dataRows.map<ContactImportPreviewRow>((row, dataIndex) => {
    const rawPhone = valueAt(row, mapping.columns.phone);

    if (mapping.issues.length > 0) {
      return {
        rowNumber: dataIndex + 2,
        rawPhone,
        values: null,
        disposition: "invalid",
        action: null,
        issue: "invalid_headers",
        existingContactId: null,
        isSuppressed: false,
        preserveSuppression: true,
      };
    }

    const result = parseAndNormalizePhoneNumber(rawPhone);
    if (!result) {
      return {
        rowNumber: dataIndex + 2,
        rawPhone,
        values: null,
        disposition: "invalid",
        action: null,
        issue: "invalid_phone",
        existingContactId: null,
        isSuppressed: false,
        preserveSuppression: true,
      };
    }

    const { phoneE164, countryCode } = result;

    const values = {
      firstName: valueAt(row, mapping.columns.firstName),
      lastName: valueAt(row, mapping.columns.lastName),
      jobTitle: valueAt(row, mapping.columns.jobTitle),
      company: valueAt(row, mapping.columns.company),
      phoneE164,
      countryCode,
    };
    const existing = existingContacts.get(phoneE164);
    const isSuppressed =
      Boolean(existing?.isSuppressed) || suppressedPhones.has(phoneE164);

    if (phonesSeenInFile.has(phoneE164)) {
      return {
        rowNumber: dataIndex + 2,
        rawPhone,
        values,
        disposition: "duplicate",
        action: null,
        issue: "csv_duplicate",
        existingContactId: existing?.id ?? null,
        isSuppressed,
        preserveSuppression: true,
      };
    }
    phonesSeenInFile.add(phoneE164);

    if (existing && existing.deletedAt === null) {
      return {
        rowNumber: dataIndex + 2,
        rawPhone,
        values,
        disposition: "duplicate",
        action: null,
        issue: "active_duplicate",
        existingContactId: existing.id,
        isSuppressed,
        preserveSuppression: true,
      };
    }

    return {
      rowNumber: dataIndex + 2,
      rawPhone,
      values,
      disposition: "ready",
      action: existing ? "restore" : "create",
      issue: null,
      existingContactId: existing?.id ?? null,
      isSuppressed,
      preserveSuppression: true,
    };
  });

  const counts = countRows(rows);
  return {
    rows,
    counts,
    headerIssues: mapping.issues,
    canImport: mapping.issues.length === 0 && counts.ready > 0,
  };
}

export function buildContactImportOperations(
  preview: ContactImportPreview,
): ContactImportOperation[] {
  return preview.rows.flatMap((row) => {
    if (row.disposition !== "ready" || !row.action || !row.values) {
      return [];
    }

    return [
      {
        ...row.values,
        action: row.action,
        existingContactId: row.existingContactId,
        isSuppressed: row.isSuppressed,
        preserveSuppression: true as const,
      },
    ];
  });
}
