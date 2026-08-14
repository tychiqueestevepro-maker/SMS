import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";

import { CookieConsent } from "@/components/privacy/cookie-consent";
import { getApplicationOrigin } from "@/lib/application-url";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(getApplicationOrigin()),
  title: {
    default: "Riink",
    template: "%s · Riink",
  },
  description: "SMS outreach that starts real conversations.",
  applicationName: "Riink",
  icons: {
    icon: [
      {
        url: "/riink_logo_transparent.png",
        type: "image/png",
        sizes: "1254x1254",
      },
    ],
    shortcut: "/riink_logo_transparent.png",
    apple: [
      {
        url: "/riink_logo_transparent.png",
        type: "image/png",
        sizes: "1254x1254",
      },
    ],
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={GeistSans.className} data-scroll-behavior="smooth">
      <body>{children}<CookieConsent /></body>
    </html>
  );
}
