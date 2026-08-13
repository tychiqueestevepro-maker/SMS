import { describe, expect, it } from "vitest";

import { evaluateConsentMessage, parseConsentCommand } from "./compliance";

describe("parseConsentCommand", () => {
  it.each(["STOP", " unsubscribe ", "Cancel", "end", "QUIT"])(
    "recognizes full opt-out keyword %s",
    (body) => {
      expect(parseConsentCommand(body).command).toBe("opt_out");
    },
  );

  it.each(["START", " unstop "])("recognizes opt-in keyword %s", (body) => {
    expect(parseConsentCommand(body).command).toBe("opt_in");
  });

  it.each(["please stop", "STOP now", "RESTART", ""])(
    "does not match partial text %s",
    (body) => {
      expect(parseConsentCommand(body)).toEqual({ command: null, keyword: null });
    },
  );
});

describe("evaluateConsentMessage", () => {
  it("upserts suppression and stops active recipients for opt-out", () => {
    expect(
      evaluateConsentMessage({
        body: "STOP",
        isCurrentlySuppressed: false,
        optInConfirmed: false,
      }),
    ).toMatchObject({
      command: "opt_out",
      suppressionMutation: "upsert",
      isSuppressedAfter: true,
      stopActiveRecipients: true,
      resumeCampaigns: false,
    });
  });

  it("keeps suppression for an unconfirmed START", () => {
    expect(
      evaluateConsentMessage({
        body: "START",
        isCurrentlySuppressed: true,
        optInConfirmed: false,
      }),
    ).toMatchObject({
      command: "opt_in",
      confirmationRequired: true,
      suppressionMutation: "none",
      isSuppressedAfter: true,
      resumeCampaigns: false,
    });
  });

  it("removes suppression after confirmed opt-in but never resumes a campaign", () => {
    expect(
      evaluateConsentMessage({
        body: "UNSTOP",
        isCurrentlySuppressed: true,
        optInConfirmed: true,
      }),
    ).toMatchObject({
      command: "opt_in",
      confirmationRequired: false,
      suppressionMutation: "remove",
      isSuppressedAfter: false,
      stopActiveRecipients: false,
      resumeCampaigns: false,
    });
  });
});
