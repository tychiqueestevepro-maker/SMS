import { describe, expect, it } from "vitest";

import { formatContactsCsv } from "./csv-export";

describe("formatContactsCsv", () => {
  it("uses the fixed export columns, escapes values and omits deleted contacts", () => {
    const csv = formatContactsCsv([
      {
        firstName: "=HYPERLINK(\"https://example.invalid\")",
        jobTitle: "",
        lastName: 'Love"lace',
        company: "Analytical, Inc.",
        phoneE164: "+15125550192",
        pipelineStage: "New",
        lastContactedAt: "2026-08-01T10:00:00.000Z",
        lastRepliedAt: null,
        createdAt: "2026-07-01T09:00:00.000Z",
        deletedAt: null,
      },
      {
        firstName: "Deleted",
        jobTitle: "",
        lastName: "Contact",
        company: "Hidden",
        phoneE164: "+12125550100",
        pipelineStage: "New",
        lastContactedAt: null,
        lastRepliedAt: null,
        createdAt: "2026-07-02T09:00:00.000Z",
        deletedAt: "2026-08-01T00:00:00.000Z",
      },
    ]);

    expect(csv).toBe(
      [
        "first_name,last_name,job_title,company,phone,pipeline_stage,last_contacted_at,last_replied_at,created_at",
        '"\'=HYPERLINK(""https://example.invalid"")","Love""lace",,"Analytical, Inc.",+15125550192,New,2026-08-01T10:00:00.000Z,,2026-07-01T09:00:00.000Z',
      ].join("\r\n"),
    );
    expect(csv).not.toContain("Deleted");
  });
});
