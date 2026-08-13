export interface ExistingContactMatch {
  id: string;
  phoneE164: string;
  deletedAt: string | null;
  isSuppressed: boolean;
}

export interface ContactImportValues {
  firstName: string;
  lastName: string;
  jobTitle?: string;
  company: string;
  phoneE164: string;
  countryCode: string;
}

export type ContactImportDisposition = "ready" | "duplicate" | "invalid";
export type ContactImportAction = "create" | "restore";

export type ContactImportIssue =
  | "invalid_phone"
  | "active_duplicate"
  | "csv_duplicate"
  | "invalid_headers";

export interface ContactImportPreviewRow {
  rowNumber: number;
  rawPhone: string;
  values: ContactImportValues | null;
  disposition: ContactImportDisposition;
  action: ContactImportAction | null;
  issue: ContactImportIssue | null;
  existingContactId: string | null;
  isSuppressed: boolean;
  /** Import and restoration must never remove a suppression. */
  preserveSuppression: true;
}

export interface ContactImportPreviewCounts {
  ready: number;
  duplicates: number;
  invalid: number;
  restorations: number;
}

export type ContactCsvHeaderIssue =
  | { code: "missing_phone_header" }
  | { code: "duplicate_mapped_header"; field: ContactCsvField };

export interface ContactImportPreview {
  rows: ContactImportPreviewRow[];
  counts: ContactImportPreviewCounts;
  headerIssues: ContactCsvHeaderIssue[];
  canImport: boolean;
}

export interface ContactImportOperation extends ContactImportValues {
  action: ContactImportAction;
  existingContactId: string | null;
  isSuppressed: boolean;
  preserveSuppression: true;
}

export type ContactCsvField = "firstName" | "lastName" | "jobTitle" | "company" | "phone";

export interface ContactCsvHeaderMapping {
  columns: Partial<Record<ContactCsvField, number>>;
  unknownHeaders: string[];
  issues: ContactCsvHeaderIssue[];
}

export interface PreviewContactCsvOptions {
  existingContacts?: readonly ExistingContactMatch[];
  /** Includes suppressions that may outlive or exist without an active contact. */
  suppressedPhoneNumbers?: ReadonlySet<string> | readonly string[];
}

export interface ContactExportRecord {
  firstName: string;
  lastName: string;
  jobTitle?: string;
  company: string;
  phoneE164: string;
  pipelineStage: string;
  lastContactedAt: string | null;
  lastRepliedAt: string | null;
  createdAt: string;
  deletedAt?: string | null;
}

export type ContactFilter = "all" | "replied" | "opted_out";
export type ContactView = "list" | "pipeline";

export interface ContactListQueryDto {
  search: string;
  filter: ContactFilter;
  view: ContactView;
}

export interface ContactSearchSource {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  company: string;
  phoneE164: string;
  countryCode: string;
  pipelineStageId: string;
  pipelineStageName: string;
  activeCampaignName: string | null;
  lastContactedAt: string | null;
  lastRepliedAt: string | null;
  createdAt: string;
  deletedAt: string | null;
  isSuppressed: boolean;
}

export interface ContactListItemDto {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  company: string;
  phoneNumber: string;
  countryCode: string;
  pipelineStage: {
    id: string;
    name: string;
  };
  campaignName: string | null;
  lastActivityAt: string | null;
  hasReplied: boolean;
  optedOut: boolean;
}
