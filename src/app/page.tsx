import type { Metadata } from "next";

import { LandingPage } from "@/components/marketing/landing-page";

export const metadata: Metadata = {
  title: "SMS outreach that starts real conversations",
  description:
    "Send focused SMS campaigns, automate follow ups, and manage every reply from one shared Riink workspace.",
  keywords: ["SMS outreach", "SMS campaigns", "sales messaging", "shared SMS inbox"],
  openGraph: {
    title: "Riink | SMS outreach that starts real conversations",
    description:
      "Send focused SMS campaigns, automate follow ups, and manage every reply from one shared workspace.",
    type: "website",
    siteName: "Riink",
  },
};

export default function Page() {
  return <LandingPage />;
}
