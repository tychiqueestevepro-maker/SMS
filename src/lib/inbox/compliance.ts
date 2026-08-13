import type { ConsentCommand, ConsentEvaluation } from "./types";

export const OPT_OUT_KEYWORDS = [
  "STOP",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
] as const;

export const OPT_IN_KEYWORDS = ["START", "UNSTOP"] as const;

export function parseConsentCommand(body: string): {
  command: ConsentCommand;
  keyword: string | null;
} {
  const keyword = body.normalize("NFKC").trim().toUpperCase();
  if ((OPT_OUT_KEYWORDS as readonly string[]).includes(keyword)) {
    return { command: "opt_out", keyword };
  }
  if ((OPT_IN_KEYWORDS as readonly string[]).includes(keyword)) {
    return { command: "opt_in", keyword };
  }
  return { command: null, keyword: null };
}

export interface EvaluateConsentMessageInput {
  body: string;
  isCurrentlySuppressed: boolean;
  /** True only when the messaging infrastructure confirms a new opt-in. */
  optInConfirmed: boolean;
}

export function evaluateConsentMessage(
  input: EvaluateConsentMessageInput,
): ConsentEvaluation {
  const parsed = parseConsentCommand(input.body);

  if (parsed.command === "opt_out") {
    return {
      ...parsed,
      recognized: true,
      confirmationRequired: false,
      suppressionMutation: "upsert",
      isSuppressedAfter: true,
      stopActiveRecipients: true,
      resumeCampaigns: false,
    };
  }

  if (parsed.command === "opt_in") {
    const removeSuppression = input.optInConfirmed && input.isCurrentlySuppressed;
    return {
      ...parsed,
      recognized: true,
      confirmationRequired: !input.optInConfirmed,
      suppressionMutation: removeSuppression ? "remove" : "none",
      isSuppressedAfter: removeSuppression
        ? false
        : input.isCurrentlySuppressed,
      stopActiveRecipients: false,
      resumeCampaigns: false,
    };
  }

  return {
    command: null,
    keyword: null,
    recognized: false,
    confirmationRequired: false,
    suppressionMutation: "none",
    isSuppressedAfter: input.isCurrentlySuppressed,
    stopActiveRecipients: false,
    resumeCampaigns: false,
  };
}
