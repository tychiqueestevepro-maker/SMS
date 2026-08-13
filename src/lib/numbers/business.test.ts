import { describe, expect, it } from "vitest";

import {
  BUSINESS_VERIFICATION_DESCRIPTION,
  BUSINESS_VERIFICATION_TITLE,
  validateBusinessVerification,
  type BusinessVerificationInput,
} from "./business";

const VALID_INPUT: BusinessVerificationInput = {
  countryCode: "US",
  legalBusinessName: " Riink, Inc. ",
  ein: "12-3456789",
  businessAddress: {
    line1: "100 Main Street",
    line2: " Suite 200 ",
    city: "Austin",
    state: "tx",
    postalCode: "78701",
  },
  website: "https://riink.example",
  contactName: "Ada Lovelace",
  email: "ADA@RIINK.EXAMPLE",
  phone: "(512) 555-0192",
  messagingUseCase: "Customer-approved sales follow-up",
  optInMethod: "Written form consent",
  privacyPolicy: "https://riink.example/privacy",
  terms: "https://riink.example/terms",
  sampleMessages: [" Hi Ada, this is Riink. ", "Following up on your request."],
};

describe("business verification", () => {
  it("uses the exact provider-neutral product copy", () => {
    expect(BUSINESS_VERIFICATION_TITLE).toBe("Business verification");
    expect(BUSINESS_VERIFICATION_DESCRIPTION).toBe(
      "We need a few details to activate your number.",
    );
  });

  it("validates and normalizes every locked US compliance field", () => {
    expect(validateBusinessVerification(VALID_INPUT)).toEqual({
      valid: true,
      issues: [],
      value: {
        legalBusinessName: "Riink, Inc.",
        ein: "12-3456789",
        businessAddress: {
          line1: "100 Main Street",
          line2: "Suite 200",
          city: "Austin",
          state: "TX",
          postalCode: "78701",
          country: "US",
        },
        website: "https://riink.example",
        contactName: "Ada Lovelace",
        email: "ada@riink.example",
        phoneE164: "+15125550192",
        messagingUseCase: "Customer-approved sales follow-up",
        optInMethod: "Written form consent",
        privacyPolicy: "https://riink.example/privacy",
        terms: "https://riink.example/terms",
        sampleMessages: [
          "Hi Ada, this is Riink.",
          "Following up on your request.",
        ],
      },
    });
  });

  it("validates French registration and address fields", () => {
    const validation = validateBusinessVerification({
      ...VALID_INPUT,
      countryCode: "FR",
      ein: "123 456 789 00012",
      businessAddress: {
        ...VALID_INPUT.businessAddress,
        city: "Paris",
        state: "Ile de France",
        postalCode: "75001",
      },
      phone: "06 12 34 56 78",
    });

    expect(validation).toMatchObject({
      valid: true,
      value: {
        ein: "12345678900012",
        businessAddress: {
          country: "FR",
          state: "Ile de France",
          postalCode: "75001",
        },
        phoneE164: "+33612345678",
      },
    });
  });

  it("validates a Canadian business number, province and postal code", () => {
    const validation = validateBusinessVerification({
      ...VALID_INPUT,
      countryCode: "CA",
      ein: "123456789 RC 0001",
      businessAddress: {
        ...VALID_INPUT.businessAddress,
        city: "Ottawa",
        state: "on",
        postalCode: "K1A0B1",
      },
      phone: "+1 343 555 0104",
    });

    expect(validation).toMatchObject({
      valid: true,
      value: {
        ein: "123456789RC0001",
        businessAddress: {
          country: "CA",
          postalCode: "K1A 0B1",
          state: "ON",
        },
        phoneE164: "+13435550104",
      },
    });
  });

  it("reports required and invalid fields without partial normalized output", () => {
    const validation = validateBusinessVerification({
      ...VALID_INPUT,
      legalBusinessName: "",
      ein: "123",
      businessAddress: {
        ...VALID_INPUT.businessAddress,
        state: "ZZ",
        postalCode: "ABC",
      },
      website: "not-a-url",
      email: "bad-email",
      phone: "+442071838750",
      privacyPolicy: "privacy",
      terms: "terms",
      sampleMessages: ["   "],
    });

    expect(validation.valid).toBe(false);
    expect(validation.value).toBeNull();
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        { field: "legalBusinessName", code: "required" },
        { field: "ein", code: "invalid" },
        { field: "businessAddress.state", code: "invalid" },
        { field: "businessAddress.postalCode", code: "invalid" },
        { field: "website", code: "invalid" },
        { field: "email", code: "invalid" },
        { field: "phone", code: "invalid" },
        { field: "privacyPolicy", code: "invalid" },
        { field: "terms", code: "invalid" },
        { field: "sampleMessages", code: "required" },
      ]),
    );
  });

  it("does not accept letters hidden inside an EIN", () => {
    const validation = validateBusinessVerification({
      ...VALID_INPUT,
      ein: "AB12-3456789",
    });
    expect(validation).toMatchObject({
      valid: false,
      issues: [{ field: "ein", code: "invalid" }],
      value: null,
    });
  });

  it("bounds every free-form field and the sample collection before persistence", () => {
    const validation = validateBusinessVerification({
      ...VALID_INPUT,
      legalBusinessName: "x".repeat(201),
      businessAddress: {
        ...VALID_INPUT.businessAddress,
        line2: "x".repeat(201),
      },
      messagingUseCase: "x".repeat(2_001),
      sampleMessages: ["one", "two", "three", "four"],
    });

    expect(validation).toMatchObject({ valid: false, value: null });
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        { field: "legalBusinessName", code: "invalid" },
        { field: "businessAddress.line2", code: "invalid" },
        { field: "messagingUseCase", code: "invalid" },
        { field: "sampleMessages", code: "invalid" },
      ]),
    );
  });
});
