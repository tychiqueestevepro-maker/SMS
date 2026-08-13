export type ProviderOperation =
  | "createWorkspaceAccount"
  | "createMessagingService"
  | "sendMessage"
  | "searchNumbers"
  | "purchaseNumber"
  | "releaseNumber"
  | "checkNumberImportEligibility"
  | "startNumberImport"
  | "getNumberImportStatus"
  | "finalizeNumberImport"
  | "cancelNumberImport"
  | "getMessageStatus"
  | "getMessageCost"
  | "getActualSegments"
  | "verifyWebhook";

export type ProviderFailureKind =
  | "number_not_ready"
  | "recipient_unreachable"
  | "invalid_recipient"
  | "temporary"
  | "rate_limited"
  | "invalid_request"
  | "authentication"
  | "conflict"
  | "not_found"
  | "ambiguous_result"
  | "unknown";

export interface ProviderFailureDetails {
  operation: ProviderOperation;
  kind: ProviderFailureKind;
  providerCode: string | null;
  providerMessage: string;
  providerResourceId: string | null;
  retryable: boolean;
}

/** Internal-only error. Never serialize this object to a workspace client. */
export class ProviderOperationError extends Error {
  readonly details: ProviderFailureDetails;

  constructor(details: ProviderFailureDetails) {
    super(details.providerMessage);
    this.name = "ProviderOperationError";
    this.details = details;
  }
}

export type ProductMessagingErrorCode =
  | "MESSAGE_SEND_FAILED"
  | "PHONE_NUMBER_NOT_READY"
  | "CONTACT_CANNOT_RECEIVE_MESSAGES"
  | "PHONE_NUMBER_OPERATION_FAILED"
  | "MESSAGING_UNAVAILABLE";

const PRODUCT_ERRORS: Record<
  ProductMessagingErrorCode,
  { message: string; status: number }
> = {
  MESSAGE_SEND_FAILED: {
    message: "Message couldn't be sent. Please try again later.",
    status: 503,
  },
  PHONE_NUMBER_NOT_READY: {
    message: "This phone number isn't ready for messaging yet.",
    status: 409,
  },
  CONTACT_CANNOT_RECEIVE_MESSAGES: {
    message: "This contact can't receive messages.",
    status: 422,
  },
  PHONE_NUMBER_OPERATION_FAILED: {
    message: "The phone number operation couldn't be completed. Please try again later.",
    status: 503,
  },
  MESSAGING_UNAVAILABLE: {
    message: "Messaging is temporarily unavailable. Please try again later.",
    status: 503,
  },
};

/** A deliberately small, safe error type that may cross a client boundary. */
export class ProductMessagingError extends Error {
  readonly code: ProductMessagingErrorCode;
  readonly status: number;

  constructor(code: ProductMessagingErrorCode) {
    const definition = PRODUCT_ERRORS[code];
    super(definition.message);
    this.name = "ProductMessagingError";
    this.code = code;
    this.status = definition.status;
  }
}

export interface ProductErrorResponse {
  error: {
    code: ProductMessagingErrorCode;
    message: string;
  };
}

export function toProductErrorResponse(
  error: ProductMessagingError,
): ProductErrorResponse {
  return {
    error: {
      code: error.code,
      message: error.message,
    },
  };
}

export function toProductMessagingError(
  error: unknown,
  operation: ProviderOperation,
): ProductMessagingError {
  if (error instanceof ProductMessagingError) {
    return error;
  }

  if (error instanceof ProviderOperationError) {
    if (error.details.kind === "number_not_ready") {
      return new ProductMessagingError("PHONE_NUMBER_NOT_READY");
    }

    if (
      error.details.kind === "recipient_unreachable" ||
      error.details.kind === "invalid_recipient"
    ) {
      return new ProductMessagingError("CONTACT_CANNOT_RECEIVE_MESSAGES");
    }
  }

  if (operation === "sendMessage") {
    return new ProductMessagingError("MESSAGE_SEND_FAILED");
  }

  if (
    operation === "createWorkspaceAccount" ||
    operation === "createMessagingService" ||
    operation === "searchNumbers" ||
    operation === "purchaseNumber" ||
    operation === "releaseNumber" ||
    operation === "checkNumberImportEligibility" ||
    operation === "startNumberImport" ||
    operation === "getNumberImportStatus" ||
    operation === "finalizeNumberImport" ||
    operation === "cancelNumberImport"
  ) {
    return new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
  }

  return new ProductMessagingError("MESSAGING_UNAVAILABLE");
}

export function getProviderFailureDetails(
  error: unknown,
  operation: ProviderOperation,
): ProviderFailureDetails {
  if (error instanceof ProviderOperationError) {
    return error.details;
  }

  return {
    operation,
    kind: "unknown",
    providerCode: null,
    providerMessage:
      error instanceof Error ? error.message : "Unknown provider failure",
    providerResourceId: null,
    retryable: false,
  };
}
