import {
  CAMPAIGN_TEMPLATE_VARIABLES,
  type CampaignTemplateValues,
  type CampaignTemplateVariable,
  type CampaignValidationIssue,
} from "./types";

const TEMPLATE_TOKEN = /{{\s*([^{}]*?)\s*}}/g;
const ALLOWED_VARIABLES = new Set<string>(CAMPAIGN_TEMPLATE_VARIABLES);

function variableValue(
  variable: CampaignTemplateVariable,
  values: CampaignTemplateValues,
): string {
  if (variable === "first_name") return values.firstName ?? "";
  if (variable === "last_name") return values.lastName ?? "";
  return values.company ?? "";
}

export function validateCampaignTemplate(
  template: string,
  stepIndex: number | null = null,
): CampaignValidationIssue[] {
  const issues: CampaignValidationIssue[] = [];
  const unsupportedVariables = new Set<string>();

  const withoutCompleteTokens = template.replace(
    TEMPLATE_TOKEN,
    (_token, rawVariable: string) => {
      const variable = rawVariable.trim();
      if (!ALLOWED_VARIABLES.has(variable)) {
        unsupportedVariables.add(variable);
      }
      return "";
    },
  );

  for (const variable of unsupportedVariables) {
    issues.push({
      code: "unsupported_variable",
      stepIndex,
      variable,
    });
  }

  if (withoutCompleteTokens.includes("{{") || withoutCompleteTokens.includes("}}")) {
    issues.push({ code: "malformed_variable", stepIndex });
  }

  return issues;
}

export class CampaignTemplateError extends Error {
  readonly issues: CampaignValidationIssue[];

  constructor(issues: CampaignValidationIssue[]) {
    super("The campaign message contains an invalid variable.");
    this.name = "CampaignTemplateError";
    this.issues = issues;
  }
}

export function renderCampaignTemplate(
  template: string,
  values: CampaignTemplateValues,
): string {
  const issues = validateCampaignTemplate(template);
  if (issues.length > 0) {
    throw new CampaignTemplateError(issues);
  }

  return template.replace(TEMPLATE_TOKEN, (_token, rawVariable: string) => {
    const variable = rawVariable.trim() as CampaignTemplateVariable;
    return variableValue(variable, values);
  });
}
