import type { NumberImportStatus, NumberSource } from "./product-types";

export type NumberAdminState =
  | "purchased"
  | "verification_submitted"
  | "under_review"
  | "approved"
  | "ready"
  | "rejected"
  | "release_pending"
  | "released"
  | "failed";

export interface NumberTechnicalDetails {
  provider: string;
  providerNumberId: string | null;
  providerAccountId: string | null;
  messagingServiceId: string | null;
  externalStatus: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface InternalPhoneNumberRecord {
  id: string;
  phoneNumber: string;
  countryCode: string | null;
  source: NumberSource;
  importStatus: NumberImportStatus | null;
  adminState: NumberAdminState;
  isDefault: boolean;
  createdAt: string;
  activatedAt: string | null;
  verificationCode: string | null;
  updatedAt: string;
  deletedAt: string | null;
  technical: NumberTechnicalDetails;
}

export type NumberAdminDto = InternalPhoneNumberRecord;
