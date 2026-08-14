import { afterEach, describe, expect, it } from "vitest";

import robots from "./robots";
import sitemap from "./sitemap";

const originalAppUrl = process.env.APP_URL;

describe("SEO metadata routes", () => {
  afterEach(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
  });

  it("publishes only the public evergreen pages in the sitemap", () => {
    process.env.APP_URL = "https://www.riink.app";

    expect(sitemap().map((entry) => entry.url)).toEqual([
      "https://www.riink.app",
      "https://www.riink.app/demo",
      "https://www.riink.app/cookies",
    ]);
  });

  it("keeps private and authentication routes out of search results", () => {
    process.env.APP_URL = "https://www.riink.app";

    expect(robots()).toMatchObject({
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: expect.arrayContaining([
          "/admin",
          "/api/",
          "/campaigns",
          "/login",
          "/settings",
        ]),
      },
      sitemap: "https://www.riink.app/sitemap.xml",
      host: "https://www.riink.app",
    });
  });
});
