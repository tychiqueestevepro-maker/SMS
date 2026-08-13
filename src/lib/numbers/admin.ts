import type {
  InternalPhoneNumberRecord,
  NumberAdminDto,
  NumberAdminState,
} from "./internal-types";

const ADMIN_TRANSITIONS: Readonly<Record<NumberAdminState, readonly NumberAdminState[]>> = {
  purchased: ["verification_submitted", "failed", "release_pending"],
  verification_submitted: ["under_review", "rejected", "failed"],
  under_review: ["approved", "rejected", "failed"],
  approved: ["ready", "failed", "release_pending"],
  ready: ["release_pending"],
  rejected: ["verification_submitted", "release_pending"],
  release_pending: ["released", "ready", "failed"],
  released: [],
  failed: ["verification_submitted", "release_pending"],
};

export class NumberAdminTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NumberAdminTransitionError";
  }
}

export interface NumberAdminTransitionOptions {
  now: Date | string;
  /** Required before an approved number can become available for sending. */
  billingAuthorized?: boolean;
}

export function transitionNumberAdminState(
  record: InternalPhoneNumberRecord,
  nextState: NumberAdminState,
  options: NumberAdminTransitionOptions,
): InternalPhoneNumberRecord {
  if (!ADMIN_TRANSITIONS[record.adminState].includes(nextState)) {
    throw new NumberAdminTransitionError(
      `Invalid number setup transition: ${record.adminState} -> ${nextState}`,
    );
  }
  if (
    record.adminState === "approved" &&
    nextState === "ready" &&
    options.billingAuthorized !== true
  ) {
    throw new NumberAdminTransitionError(
      "Billing authorization is required before activation.",
    );
  }
  const now = new Date(options.now);
  if (!Number.isFinite(now.getTime())) {
    throw new NumberAdminTransitionError("Invalid transition timestamp.");
  }

  return {
    ...record,
    adminState: nextState,
    updatedAt: now.toISOString(),
  };
}

/** Admin-only DTO; callers must protect the route before invoking this mapper. */
export function toNumberAdminDto(record: InternalPhoneNumberRecord): NumberAdminDto {
  return {
    ...record,
    technical: { ...record.technical },
  };
}

export type {
  InternalPhoneNumberRecord,
  NumberAdminDto,
  NumberAdminState,
  NumberTechnicalDetails,
} from "./internal-types";
