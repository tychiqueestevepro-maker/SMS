import type { MetadataRoute } from "next";

import { getApplicationOrigin } from "@/lib/application-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getApplicationOrigin();

  return [
    {
      url: origin,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${origin}/demo`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${origin}/cookies`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
