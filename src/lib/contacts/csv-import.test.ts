import { describe, expect, it } from "vitest";

import {
  buildContactImportOperations,
  mapContactCsvHeaders,
  previewContactCsv,
} from "./csv-import";

describe("contact CSV headers", () => {
  it("accepts the canonical and approved common aliases", () => {
    expect(
      mapContactCsvHeaders(["\uFEFFFirst Name", "last_name", "Company", "Mobile"]),
    ).toMatchObject({
      columns: { firstName: 0, lastName: 1, company: 2, phone: 3 },
      issues: [],
    });

    expect(mapContactCsvHeaders(["Firstname", "Last Name", "Phone Number"]))
      .toMatchObject({
        columns: { firstName: 0, lastName: 1, phone: 2 },
        issues: [],
      });
  });

  it("rejects a missing or ambiguously duplicated phone mapping", () => {
    expect(mapContactCsvHeaders(["first_name", "company"]).issues).toContainEqual({
      code: "missing_phone_header",
    });
    expect(mapContactCsvHeaders(["Phone", "Mobile"]).issues).toContainEqual({
      code: "duplicate_mapped_header",
      field: "phone",
    });
  });
});

describe("previewContactCsv", () => {
  it("counts ready, duplicate and invalid rows and marks restorations", () => {
    const preview = previewContactCsv(
      [
        "First Name,Last Name,Company,Phone Number",
        'Ada,Lovelace,"Analytical, Inc.",5125550192',
        "Active,Contact,Acme,2125550100",
        "Deleted,Contact,Restore Co,3105550103",
        "Bad,Phone,Invalid,123",
        "Ada,Again,Duplicate,1 (512) 555-0192",
      ].join("\r\n"),
      {
        existingContacts: [
          {
            id: "active-contact",
            phoneE164: "+12125550100",
            deletedAt: null,
            isSuppressed: false,
          },
          {
            id: "deleted-contact",
            phoneE164: "+13105550103",
            deletedAt: "2026-07-01T00:00:00.000Z",
            isSuppressed: true,
          },
        ],
      },
    );

    expect(preview.counts).toEqual({
      ready: 2,
      duplicates: 2,
      invalid: 1,
      restorations: 1,
    });
    expect(preview.canImport).toBe(true);
    expect(preview.rows[1]).toMatchObject({
      disposition: "duplicate",
      issue: "active_duplicate",
      existingContactId: "active-contact",
    });
    expect(preview.rows[2]).toMatchObject({
      disposition: "ready",
      action: "restore",
      existingContactId: "deleted-contact",
      isSuppressed: true,
      preserveSuppression: true,
    });
    expect(preview.rows[4]).toMatchObject({
      disposition: "duplicate",
      issue: "csv_duplicate",
    });
  });

  it("builds only create/restore operations and never clears suppression", () => {
    const preview = previewContactCsv(
      [
        "first_name,last_name,company,phone",
        "Restored,Person,New Company,3105550103",
        "New,Suppressed,,4155550104",
      ].join("\n"),
      {
        existingContacts: [
          {
            id: "deleted-contact",
            phoneE164: "+13105550103",
            deletedAt: "2026-07-01T00:00:00.000Z",
            isSuppressed: true,
          },
        ],
        suppressedPhoneNumbers: ["+14155550104"],
      },
    );

    expect(buildContactImportOperations(preview)).toEqual([
      {
        action: "restore",
        existingContactId: "deleted-contact",
        firstName: "Restored",
        jobTitle: "",
        lastName: "Person",
        company: "New Company",
        phoneE164: "+13105550103",
        countryCode: "US",
        isSuppressed: true,
        preserveSuppression: true,
      },
      {
        action: "create",
        existingContactId: null,
        firstName: "New",
        jobTitle: "",
        lastName: "Suppressed",
        company: "",
        phoneE164: "+14155550104",
        countryCode: "US",
        isSuppressed: true,
        preserveSuppression: true,
      },
    ]);
  });
});
