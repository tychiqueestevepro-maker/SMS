import type { MetadataRoute } from "next";

import { getApplicationOrigin } from "@/lib/application-url";

export default function robots(): MetadataRoute.Robots {
  const origin = getApplicationOrigin();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/api/",
        "/auth/",
        "/campaigns",
        "/contacts",
        "/forgot-password",
        "/inbox",
        "/login",
        "/reset-password",
        "/settings",
        "/signup",
      ],
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
