import { afterEach, describe, expect, it } from "vitest";

import { getApplicationOrigin } from "./application-url";

const originalAppUrl = process.env.APP_URL;

describe("getApplicationOrigin", () => {
  afterEach(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
  });

  it("normalizes the configured HTTPS origin", () => {
    process.env.APP_URL = "https://www.riink.app/some/path";
    expect(getApplicationOrigin()).toBe("https://www.riink.app");
  });

  it("allows HTTP only for local development", () => {
    process.env.APP_URL = "http://127.0.0.1:3000";
    expect(getApplicationOrigin()).toBe("http://127.0.0.1:3000");

    process.env.APP_URL = "http://riink.example";
    expect(() => getApplicationOrigin()).toThrow(
      "Riink application URL configuration is invalid.",
    );
  });
});
