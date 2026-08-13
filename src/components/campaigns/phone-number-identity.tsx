"use client";

import React from "react";
import type { CampaignPhoneOption } from "@/components/campaigns/types";
import { CountryFlag } from "@/components/ui/country-flag";

export function countryIsoToFlag(iso?: string | null): string {
  if (!iso || iso.length !== 2) return "🌐";
  const codePoints = iso
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export function countryIsoToName(iso?: string | null): string {
  if (!iso || iso.length !== 2) return "International";
  try {
    const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(iso.toUpperCase()) || iso.toUpperCase();
  } catch {
    return iso.toUpperCase();
  }
}

export function formatPhoneNumberDisplay(phone: string): string {
  if (!phone) return "—";
  if (phone.startsWith("+1") && phone.length === 12) {
    return `+1 (${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`;
  }
  if (phone.startsWith("+33") && phone.length === 12) {
    return `+33 ${phone.slice(3, 4)} ${phone.slice(4, 6)} ${phone.slice(6, 8)} ${phone.slice(8, 10)} ${phone.slice(10, 12)}`;
  }
  return phone;
}

export function CountryFlagBadge({ countryCode }: { countryCode?: string | null }) {
  const iso = (countryCode || "US").toUpperCase();
  const name = countryIsoToName(iso);

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E9E6] bg-[#F9FAFA] px-2 py-0.5 text-xs font-semibold text-[#171A18]">
      <CountryFlag className="h-3 w-4.5 rounded-2xs object-cover" countryCode={iso} />
      <span>{iso}</span>
      <span className="text-[11px] font-normal text-[#66706A]">({name})</span>
    </span>
  );
}

export function PhoneNumberIdentity({
  option,
  showCountry = true,
}: {
  option: CampaignPhoneOption;
  showCountry?: boolean;
}) {
  const formatted = formatPhoneNumberDisplay(option.phoneNumber);

  const statusLabel = option.inUse ? "In use" : option.status === "ready" ? "Ready" : "Pending";
  const statusColor =
    option.inUse
      ? "bg-[#FFF4DE] text-[#B97913] border-[#FBE3B5]"
      : option.status === "ready"
        ? "bg-[#E9F5EE] text-[#07813F] border-[#C2E8D2]"
        : "bg-[#F2F4F3] text-[#66706A] border-[#E5E9E6]";

  return (
    <div className="inline-flex items-center gap-2 text-xs font-medium text-[#171A18]">
      <span className="font-bold text-[#171A18]">{formatted}</span>
      {option.label && (
        <span className="rounded bg-[#F2F4F3] px-1.5 py-0.5 text-[10px] font-medium text-[#66706A]">
          {option.label}
        </span>
      )}
      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusColor}`}>
        {statusLabel}
      </span>
      {showCountry && <CountryFlagBadge countryCode={option.countryCode} />}
    </div>
  );
}
