import type { InternalPhoneNumberRecord } from "./internal-types";
import type {
  NumberClientDto,
  NumberImportStatus,
  NumberImportStatusLabel,
  NumberProductStatus,
  NumberProductStatusLabel,
} from "./product-types";

export const PENDING_NUMBER_TITLE = "Number setup in progress";
export const PENDING_NUMBER_DESCRIPTION =
  "We're setting up your Riink phone number. You'll be able to start sending messages once it's ready.";

const IMPORT_STATUS_CONTENT: Readonly<
  Record<
    NumberImportStatus,
    {
      description: string;
      label: NumberImportStatusLabel;
      title: string;
    }
  >
> = {
  verification: {
    description: "Complete the ownership check to continue importing this number.",
    label: "Verification",
    title: "Ownership verification",
  },
  pending: {
    description: "Your import request is waiting to begin.",
    label: "Pending",
    title: "Import pending",
  },
  importing: {
    description: "Your number is being imported. It is not ready for messaging yet.",
    label: "Import in progress",
    title: "Import in progress",
  },
  action_required: {
    description: "Review the import details and complete the requested step.",
    label: "Action required",
    title: "Action required",
  },
  active: {
    description: "Ready for campaigns and Inbox conversations.",
    label: "Active",
    title: "Active",
  },
  failed: {
    description: "The number could not be imported. Try again or contact Riink support.",
    label: "Failed",
    title: "Import failed",
  },
};

function productStatus(
  record: InternalPhoneNumberRecord,
): NumberProductStatus | null {
  if (
    record.deletedAt !== null ||
    record.adminState === "release_pending" ||
    record.adminState === "released"
  ) {
    return null;
  }
  return record.adminState === "ready" ? "ready" : "pending";
}

function statusLabel(status: NumberProductStatus): NumberProductStatusLabel {
  return status === "ready" ? "Ready" : "Pending";
}

function safeImportStatus(
  record: InternalPhoneNumberRecord,
): NumberImportStatus | null {
  if (record.source !== "imported") return null;
  if (record.importStatus !== "active") return record.importStatus ?? "pending";

  // An import is product-active only after the operational gate and activation
  // timestamp have both been confirmed by the backend.
  return record.adminState === "ready" && record.activatedAt
    ? "active"
    : "importing";
}

/** Explicit sanitization boundary for all workspace-facing number responses. */
export function toNumberClientDto(
  record: InternalPhoneNumberRecord,
): NumberClientDto | null {
  const status = productStatus(record);
  if (!status) return null;
  const importStatus = safeImportStatus(record);
  const importContent = importStatus ? IMPORT_STATUS_CONTENT[importStatus] : null;

  return {
    activatedAt: record.activatedAt,
    countryCode: record.countryCode,
    id: record.id,
    phoneNumber: record.phoneNumber,
    source: record.source,
    sourceLabel: record.source === "imported" ? "Imported" : "Included",
    status,
    statusLabel: importContent?.label ?? statusLabel(status),
    importStatus,
    isDefault: record.isDefault,
    createdAt: record.createdAt,
    verificationCode: record.source === "imported" ? record.verificationCode : null,
    setup:
      importContent && importStatus !== "active"
        ? {
            title: importContent.title,
            description: importContent.description,
          }
        : status === "pending"
        ? {
            title: PENDING_NUMBER_TITLE,
            description: PENDING_NUMBER_DESCRIPTION,
          }
        : null,
  };
}

export function toNumberClientDtos(
  records: readonly InternalPhoneNumberRecord[],
): NumberClientDto[] {
  return records.flatMap((record) => {
    const dto = toNumberClientDto(record);
    return dto ? [dto] : [];
  });
}
