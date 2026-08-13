import type { Metadata } from "next";

import { DemoRequestPage } from "@/components/marketing/demo-request-page";

export const metadata: Metadata = {
  title: "Book a demo",
  description: "Book a personalized Riink demo for your SMS outreach workflow.",
  robots: { index: true, follow: true },
};

export default function DemoPage() {
  return <DemoRequestPage />;
}
