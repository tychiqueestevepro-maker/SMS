export type InboxProductErrorCode =
  | "INVALID_PHONE_NUMBER"
  | "CONTACT_NOT_AVAILABLE"
  | "CONTACT_CANNOT_RECEIVE_MESSAGES"
  | "PHONE_NUMBER_NOT_READY"
  | "MESSAGE_REQUIRED"
  | "MESSAGE_SEND_FAILED";

const ERROR_DEFINITIONS: Record<
  InboxProductErrorCode,
  { message: string; status: number }
> = {
  INVALID_PHONE_NUMBER: {
    message: "The phone number is invalid.",
    status: 400,
  },
  CONTACT_NOT_AVAILABLE: {
    message: "This contact is no longer available.",
    status: 409,
  },
  CONTACT_CANNOT_RECEIVE_MESSAGES: {
    message: "This contact can't receive messages.",
    status: 422,
  },
  PHONE_NUMBER_NOT_READY: {
    message: "This phone number isn't ready for messaging yet.",
    status: 409,
  },
  MESSAGE_REQUIRED: {
    message: "Enter a message before sending.",
    status: 400,
  },
  MESSAGE_SEND_FAILED: {
    message: "Message couldn't be sent. Please try again later.",
    status: 503,
  },
};

export class InboxProductError extends Error {
  readonly code: InboxProductErrorCode;
  readonly canRetryWithNewRequest: boolean;
  readonly status: number;

  constructor(
    code: InboxProductErrorCode,
    options: { canRetryWithNewRequest?: boolean } = {},
  ) {
    const definition = ERROR_DEFINITIONS[code];
    super(definition.message);
    this.name = "InboxProductError";
    this.code = code;
    this.canRetryWithNewRequest = options.canRetryWithNewRequest === true;
    this.status = definition.status;
  }
}

export interface InboxErrorResponse {
  error: {
    code: InboxProductErrorCode;
    message: string;
  };
}

export function toInboxProductError(error: unknown): InboxProductError {
  return error instanceof InboxProductError
    ? error
    : new InboxProductError("MESSAGE_SEND_FAILED");
}

export function toInboxErrorResponse(error: unknown): InboxErrorResponse {
  const safeError = toInboxProductError(error);
  return {
    error: {
      code: safeError.code,
      message: safeError.message,
    },
  };
}
