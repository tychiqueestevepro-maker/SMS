import { describe, expect, it } from "vitest";

import {
  NumberAdminTransitionError,
  toNumberAdminDto,
  transitionNumberAdminState,
  type InternalPhoneNumberRecord,
} from "./admin";
import {
  PENDING_NUMBER_DESCRIPTION,
  PENDING_NUMBER_TITLE,
  toNumberClientDto,
  toNumberClientDtos,
} from "./client";
import { evaluateNumberCapacity, evaluateNumberRemoval } from "./policy";

function numberRecord(
  overrides: Partial<InternalPhoneNumberRecord> = {},
): InternalPhoneNumberRecord {
  return {
    activatedAt: null,
    id: "number-1",
    phoneNumber: "+15125550192",
    countryCode: "US",
    source: "included",
    importStatus: null,
    adminState: "purchased",
    isDefault: false,
    createdAt: "2026-08-10T12:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z",
    deletedAt: null,
    verificationCode: null,
    technical: {
      provider: "internal-provider",
      providerNumberId: "external-number-id",
      providerAccountId: "external-account-id",
      messagingServiceId: "external-service-id",
      externalStatus: "registration_pending",
      errorCode: "TECHNICAL_CODE",
      errorMessage: "Technical detail",
    },
    ...overrides,
  };
}

describe("client number mapping", () => {
  it("shows every setup state as Pending with the exact Riink copy", () => {
    expect(PENDING_NUMBER_TITLE).toBe("Number setup in progress");
    expect(PENDING_NUMBER_DESCRIPTION).toBe(
      "We're setting up your Riink phone number. You'll be able to start sending messages once it's ready.",
    );
    expect(toNumberClientDto(numberRecord())).toEqual({
      activatedAt: null,
      countryCode: "US",
      id: "number-1",
      phoneNumber: "+15125550192",
      source: "included",
      sourceLabel: "Included",
      status: "pending",
      statusLabel: "Pending",
      importStatus: null,
      isDefault: false,
      createdAt: "2026-08-10T12:00:00.000Z",
      verificationCode: null,
      setup: {
        title: "Number setup in progress",
        description:
          "We're setting up your Riink phone number. You'll be able to start sending messages once it's ready.",
      },
    });
  });

  it("shows only approved activation as Ready and omits released records", () => {
    expect(toNumberClientDto(numberRecord({ adminState: "ready" }))).toMatchObject({
      status: "ready",
      statusLabel: "Ready",
      setup: null,
    });
    expect(
      toNumberClientDto(numberRecord({ adminState: "release_pending" })),
    ).toBeNull();
    expect(toNumberClientDto(numberRecord({ adminState: "released" }))).toBeNull();
  });

  it("never exposes internal setup or provider data in the client DTO", () => {
    const dto = toNumberClientDto(numberRecord());
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("internal-provider");
    expect(serialized).not.toContain("external-number-id");
    expect(serialized).not.toContain("TECHNICAL_CODE");
    expect(Object.keys(dto!)).not.toContain("adminState");
    expect(Object.keys(dto!)).not.toContain("technical");
  });

  it("maps imported lifecycle states to product-safe labels", () => {
    const verification = toNumberClientDto(
      numberRecord({
        importStatus: "verification",
        source: "imported",
        verificationCode: "RIINK-42",
      }),
    );
    expect(verification).toMatchObject({
      importStatus: "verification",
      sourceLabel: "Imported",
      statusLabel: "Verification",
      verificationCode: "RIINK-42",
    });

    const labels = [
      ["pending", "Pending"],
      ["importing", "Import in progress"],
      ["action_required", "Action required"],
      ["failed", "Failed"],
    ] as const;
    for (const [importStatus, statusLabel] of labels) {
      expect(
        toNumberClientDto(numberRecord({ importStatus, source: "imported" })),
      ).toMatchObject({ importStatus, statusLabel });
    }
  });

  it("never presents an imported number as Active before backend activation", () => {
    expect(
      toNumberClientDto(
        numberRecord({ importStatus: "active", source: "imported" }),
      ),
    ).toMatchObject({
      importStatus: "importing",
      status: "pending",
      statusLabel: "Import in progress",
    });
    expect(
      toNumberClientDto(
        numberRecord({
          activatedAt: "2026-08-10T13:00:00.000Z",
          adminState: "ready",
          importStatus: "active",
          source: "imported",
        }),
      ),
    ).toMatchObject({
      importStatus: "active",
      status: "ready",
      statusLabel: "Active",
    });
  });
});

describe("admin number transitions", () => {
  it("keeps approved Pending until billing authorizes Ready", () => {
    const approved = numberRecord({ adminState: "approved" });
    expect(() =>
      transitionNumberAdminState(approved, "ready", {
        now: "2026-08-10T13:00:00.000Z",
      }),
    ).toThrow(NumberAdminTransitionError);

    const ready = transitionNumberAdminState(approved, "ready", {
      now: "2026-08-10T13:00:00.000Z",
      billingAuthorized: true,
    });
    expect(ready).toMatchObject({
      adminState: "ready",
      updatedAt: "2026-08-10T13:00:00.000Z",
    });
    expect(toNumberClientDto(ready)?.status).toBe("ready");
  });

  it("rejects invalid internal transitions and exposes detail only to admin mapping", () => {
    expect(() =>
      transitionNumberAdminState(numberRecord(), "ready", {
        now: "2026-08-10T13:00:00.000Z",
        billingAuthorized: true,
      }),
    ).toThrow("Invalid number setup transition");
    expect(toNumberAdminDto(numberRecord()).technical.providerNumberId).toBe(
      "external-number-id",
    );
  });
});

describe("number plan and removal policy", () => {
  it("uses only the supplied billing-plan maximum and counts Pending numbers", () => {
    const records = [
      numberRecord({ id: "one" }),
      numberRecord({ id: "two", adminState: "ready" }),
      numberRecord({ id: "three", adminState: "under_review" }),
    ];
    expect(evaluateNumberCapacity(records, { maxPhoneNumbers: 3 })).toEqual({
      allowed: false,
      currentNumberCount: 3,
      maxPhoneNumbers: 3,
      remainingSlots: 0,
      error: {
        code: "PHONE_NUMBER_LIMIT_REACHED",
        message:
          "Your plan already includes the maximum number of phone numbers.",
      },
    });
    expect(evaluateNumberCapacity(records, { maxPhoneNumbers: 4 }).allowed).toBe(true);
  });

  it("does not count deleted or released records", () => {
    expect(
      evaluateNumberCapacity(
        [
          numberRecord({ adminState: "released" }),
          numberRecord({ deletedAt: "2026-08-10T13:00:00.000Z" }),
        ],
        { maxPhoneNumbers: 1 },
      ).currentNumberCount,
    ).toBe(0);
    expect(
      toNumberClientDtos([
        numberRecord({ adminState: "released" }),
        numberRecord({ id: "ready", adminState: "ready" }),
      ]).map(({ id }) => id),
    ).toEqual(["ready"]);
  });

  it("keeps imported numbers outside the included allowance", () => {
    const decision = evaluateNumberCapacity(
      [
        numberRecord({ id: "included-ready", adminState: "ready" }),
        numberRecord({ id: "included-pending", adminState: "under_review" }),
        numberRecord({
          id: "imported-active",
          activatedAt: "2026-08-10T13:00:00.000Z",
          adminState: "ready",
          importStatus: "active",
          source: "imported",
        }),
        numberRecord({
          id: "imported-pending",
          importStatus: "pending",
          source: "imported",
        }),
      ],
      { maxPhoneNumbers: 3 },
    );

    expect(decision).toMatchObject({
      allowed: true,
      currentNumberCount: 2,
      remainingSlots: 1,
    });
  });

  it("blocks removal while the number is used by an active or paused campaign", () => {
    expect(
      evaluateNumberRemoval("number-1", [
        { id: "draft", phoneNumberId: "number-1", state: "draft" },
        { id: "active", phoneNumberId: "number-1", state: "active" },
        { id: "other", phoneNumberId: "number-2", state: "active" },
      ]),
    ).toEqual({
      allowed: false,
      blockingCampaignIds: ["active"],
      error: {
        code: "PHONE_NUMBER_IN_ACTIVE_CAMPAIGN",
        message:
          "This phone number is used by an active or paused campaign. Finish or delete the campaign before removing it.",
      },
    });
    expect(
      evaluateNumberRemoval("number-1", [
        { id: "paused", phoneNumberId: "number-1", state: "paused" },
      ]),
    ).toEqual({
      allowed: false,
      blockingCampaignIds: ["paused"],
      error: {
        code: "PHONE_NUMBER_IN_ACTIVE_CAMPAIGN",
        message:
          "This phone number is used by an active or paused campaign. Finish or delete the campaign before removing it.",
      },
    });
    expect(
      evaluateNumberRemoval("number-1", [
        { id: "draft", phoneNumberId: "number-1", state: "draft" },
        { id: "finished", phoneNumberId: "number-1", state: "finished" },
      ]).allowed,
    ).toBe(true);
  });
});
