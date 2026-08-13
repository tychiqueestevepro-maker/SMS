import { validateCampaignTemplate } from "./templates";
import type {
  CampaignStepDraft,
  CampaignValidationIssue,
  CampaignValidationResult,
} from "./types";

export const MIN_CAMPAIGN_STEPS = 1;
export const MAX_CAMPAIGN_STEPS = 3;
export const MIN_WAIT_DAYS = 1;
export const MAX_WAIT_DAYS = 365;

export function validateCampaignSteps(
  steps: readonly CampaignStepDraft[],
): CampaignValidationResult {
  const issues: CampaignValidationIssue[] = [];

  if (steps.length < MIN_CAMPAIGN_STEPS || steps.length > MAX_CAMPAIGN_STEPS) {
    issues.push({ code: "step_count", stepIndex: null });
  }

  steps.forEach((step, stepIndex) => {
    if (step.body.trim().length === 0) {
      issues.push({ code: "empty_message", stepIndex });
    }
    issues.push(...validateCampaignTemplate(step.body, stepIndex));

    const wait = step.waitDaysAfterPrevious;
    if (stepIndex === 0) {
      if (wait !== undefined && wait !== null && wait !== 0) {
        issues.push({ code: "invalid_wait", stepIndex });
      }
      return;
    }

    if (
      typeof wait !== "number" ||
      !Number.isInteger(wait) ||
      wait < MIN_WAIT_DAYS ||
      wait > MAX_WAIT_DAYS
    ) {
      issues.push({ code: "invalid_wait", stepIndex });
    }
  });

  return { valid: issues.length === 0, issues };
}
