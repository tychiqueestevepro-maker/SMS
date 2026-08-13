import { InboxProductError } from "./errors";
import type { ManualMessageDecision, ManualMessageInput } from "./types";

function rejected(code: ConstructorParameters<typeof InboxProductError>[0]): ManualMessageDecision {
  const error = new InboxProductError(code);
  return {
    allowed: false,
    error: { code: error.code, message: error.message },
  };
}

export function evaluateManualMessage(
  input: ManualMessageInput,
): ManualMessageDecision {
  if (!input.contact || input.contact.deletedAt !== null) {
    return rejected("CONTACT_NOT_AVAILABLE");
  }
  if (input.contact.isSuppressed) {
    return rejected("CONTACT_CANNOT_RECEIVE_MESSAGES");
  }
  if (!input.phoneNumber || input.phoneNumber.status !== "ready") {
    return rejected("PHONE_NUMBER_NOT_READY");
  }
  if (input.body.trim().length === 0) {
    return rejected("MESSAGE_REQUIRED");
  }
  return { allowed: true, error: null };
}

export function assertManualMessageAllowed(input: ManualMessageInput): void {
  const decision = evaluateManualMessage(input);
  if (!decision.allowed && decision.error) {
    throw new InboxProductError(
      decision.error.code as ConstructorParameters<typeof InboxProductError>[0],
    );
  }
}
