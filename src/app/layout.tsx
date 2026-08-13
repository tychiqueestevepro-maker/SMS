import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";

import { CookieConsent } from "@/components/privacy/cookie-consent";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Riink",
    template: "%s · Riink",
  },
  description: "SMS outreach that starts real conversations.",
  applicationName: "Riink",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={GeistSans.className} data-scroll-behavior="smooth">
      <body>{children}<CookieConsent /></body>
    </html>
  );
}
