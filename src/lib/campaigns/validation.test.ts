import { describe, expect, it } from "vitest";

import { renderCampaignTemplate } from "./templates";
import { validateCampaignSteps } from "./validation";

describe("campaign sequence validation", () => {
  it("accepts one to three messages and the three locked variables", () => {
    expect(
      validateCampaignSteps([
        { body: "Hi {{first_name}} from {{company}}" },
        { body: "Following up, {{last_name}}", waitDaysAfterPrevious: 2 },
        { body: "Last note", waitDaysAfterPrevious: 365 },
      ]),
    ).toEqual({ valid: true, issues: [] });
  });

  it("rejects zero or more than three steps", () => {
    expect(validateCampaignSteps([]).issues).toContainEqual({
      code: "step_count",
      stepIndex: null,
    });
    expect(
      validateCampaignSteps([
        { body: "One" },
        { body: "Two", waitDaysAfterPrevious: 1 },
        { body: "Three", waitDaysAfterPrevious: 1 },
        { body: "Four", waitDaysAfterPrevious: 1 },
      ]).issues,
    ).toContainEqual({ code: "step_count", stepIndex: null });
  });

  it("rejects empty messages, unsupported variables and invalid waits", () => {
    const result = validateCampaignSteps([
      { body: "  ", waitDaysAfterPrevious: 2 },
      { body: "Hi {{email}}", waitDaysAfterPrevious: 0 },
      { body: "Hi {{first_name", waitDaysAfterPrevious: 366 },
    ]);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { code: "empty_message", stepIndex: 0 },
        { code: "invalid_wait", stepIndex: 0 },
        { code: "unsupported_variable", stepIndex: 1, variable: "email" },
        { code: "invalid_wait", stepIndex: 1 },
        { code: "malformed_variable", stepIndex: 2 },
        { code: "invalid_wait", stepIndex: 2 },
      ]),
    );
  });
});

describe("renderCampaignTemplate", () => {
  it("renders repeated variables and replaces missing values with empty strings", () => {
    expect(
      renderCampaignTemplate(
        "Hi {{ first_name }} {{last_name}} from {{company}} — {{first_name}}",
        { firstName: "Ada", lastName: null },
      ),
    ).toBe("Hi Ada  from  — Ada");
  });

  it("never silently renders an unsupported variable", () => {
    expect(() => renderCampaignTemplate("Hi {{email}}", {})).toThrow(
      "invalid variable",
    );
  });
});
