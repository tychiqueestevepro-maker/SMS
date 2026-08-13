import type { Metadata } from "next";
import { CreditCard, Phone, UserRound } from "lucide-react";

import { loadBillingSettingsData } from "@/app/(app)/settings/billing-data";
import { loadNumberSettingsData } from "@/app/(app)/settings/numbers-data";
import { BillingSettingsPanel } from "@/components/billing/billing-settings-panel";
import { NumberSettingsPanel } from "@/components/numbers/number-settings-panel";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

const sections = [
  { href: "#account", icon: UserRound, label: "Account" },
  { href: "#numbers", icon: Phone, label: "Phone numbers" },
  { href: "#billing", icon: CreditCard, label: "Billing" },
] as const;

function SectionHeading({ description, title }: { description: string; title: string }) {
  return (
    <div className="border-b border-[#e7ebe8] px-5 py-4 sm:px-6">
      <h2 className="text-sm font-semibold text-[#26342b]">{title}</h2>
      <p className="mt-1 text-sm text-[#738078]">{description}</p>
    </div>
  );
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const fullName = typeof user?.user_metadata.full_name === "string" ? user.user_metadata.full_name : "";
  const [billingSettings, numberSettings] = await Promise.all([
    loadBillingSettingsData(),
    loadNumberSettingsData(),
  ]);

  return (
    <>
      <PageHeader description="Manage your workspace, phone numbers, pipeline, and plan." title="Settings" />

      <div className="grid items-start gap-6 xl:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="sticky top-6 hidden space-y-1 xl:block">
          {sections.map(({ href, icon: Icon, label }) => (
            <a
              className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-[#637068] hover:bg-white hover:text-[#26342b] hover:shadow-sm"
              href={href}
              key={href}
            >
              <Icon aria-hidden="true" size={17} />
              {label}
            </a>
          ))}
        </nav>

        <div className="min-w-0 space-y-6">
          <Card className="scroll-mt-24 overflow-hidden" id="account">
            <SectionHeading description="Your profile and workspace preferences." title="Account" />
            <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-[#7a857e]">Name</p>
                <p className="mt-1.5 text-sm font-medium text-[#26342b]">{fullName || "Riink account"}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-[#7a857e]">Email</p>
                <p className="mt-1.5 truncate text-sm font-medium text-[#26342b]">{user?.email ?? "—"}</p>
              </div>
            </div>
          </Card>

          <Card className="scroll-mt-24 overflow-hidden" id="numbers">
            <SectionHeading
              description={`Use up to ${numberSettings.maxPhoneNumbers || "—"} Riink phone numbers with your workspace.`}
              title="Phone numbers"
            />
            <NumberSettingsPanel initialData={numberSettings} />
          </Card>



          <Card className="scroll-mt-24 overflow-hidden" id="billing">
            <SectionHeading description="Your plan and current SMS usage." title="Billing" />
            <BillingSettingsPanel data={billingSettings} />
          </Card>
        </div>
      </div>
    </>
  );
}
