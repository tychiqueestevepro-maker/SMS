export type NumberProductErrorCode =
  | "INVALID_AREA_CODE"
  | "INVALID_IMPORT_COUNTRY"
  | "INVALID_IMPORT_PHONE_NUMBER"
  | "PHONE_NUMBER_LIMIT_REACHED"
  | "PHONE_NUMBER_IN_ACTIVE_CAMPAIGN"
  | "NUMBER_IMPORT_EMAIL_REQUIRED"
  | "NUMBER_IMPORT_NOT_ELIGIBLE"
  | "NUMBER_IMPORT_UNAVAILABLE"
  | "NUMBER_SETUP_INVALID"
  | "PAYMENT_METHOD_REQUIRED"
  | "CONNECTED_NUMBER_CANNOT_BE_REMOVED";

const NUMBER_PRODUCT_ERRORS: Record<NumberProductErrorCode, string> = {
  INVALID_AREA_CODE: "Enter a valid three-digit US area code.",
  INVALID_IMPORT_COUNTRY: "Choose a supported country.",
  INVALID_IMPORT_PHONE_NUMBER: "Enter a valid business phone number.",
  PHONE_NUMBER_LIMIT_REACHED:
    "Your plan already includes the maximum number of phone numbers.",
  PHONE_NUMBER_IN_ACTIVE_CAMPAIGN:
    "This phone number is used by an active or paused campaign. Finish or delete the campaign before removing it.",
  NUMBER_IMPORT_EMAIL_REQUIRED:
    "Add an email address to your account before importing a number.",
  NUMBER_IMPORT_NOT_ELIGIBLE: "This number cannot be imported yet.",
  NUMBER_IMPORT_UNAVAILABLE:
    "Number importing is currently unavailable. Please try again later.",
  NUMBER_SETUP_INVALID:
    "Some business verification details need your attention.",
  PAYMENT_METHOD_REQUIRED:
    "Save a payment method before requesting a phone number.",
  CONNECTED_NUMBER_CANNOT_BE_REMOVED:
    "This connected number is managed from the Riink owner account and cannot be removed here.",
};

export class NumberProductError extends Error {
  readonly code: NumberProductErrorCode;

  constructor(code: NumberProductErrorCode) {
    super(NUMBER_PRODUCT_ERRORS[code]);
    this.name = "NumberProductError";
    this.code = code;
  }
}

export function numberProductError<Code extends NumberProductErrorCode>(
  code: Code,
): { code: Code; message: string } {
  const error = new NumberProductError(code);
  return { code, message: error.message };
}
