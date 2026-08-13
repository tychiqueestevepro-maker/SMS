"use client";

import React, { useState } from "react";
import { Phone } from "lucide-react";

import {
  countryIsoToFlag,
  formatPhoneNumberDisplay,
} from "@/components/campaigns/phone-number-identity";
import { SendingNumberModal } from "@/components/campaigns/sending-number-modal";
import type { CampaignPhoneOption } from "@/components/campaigns/types";

type CampaignDetailsCardProps = {
  name: string;
  onNameChange: (name: string) => void;
  phoneNumberId: string | null;
  onPhoneNumberChange: (id: string) => void;
  phoneNumbers: CampaignPhoneOption[];
};

export function CampaignDetailsCard({
  name,
  onNameChange,
  phoneNumberId,
  onPhoneNumberChange,
  phoneNumbers,
}: CampaignDetailsCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const selectedPhone =
    phoneNumbers.find((p) => p.id === phoneNumberId) || phoneNumbers[0] || null;

  return (
    <div className="rounded-2xl border border-[#E5E9E6] bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-[#171A18]">Campaign details</h2>

      <div className="mt-4 flex flex-col gap-4">
        {/* Campaign Name Input */}
        <div>
          <label className="block text-xs font-medium text-[#66706A]" htmlFor="campaign-name">Campaign name</label>
          <input
            className="mt-1.5 h-10 w-full rounded-lg border border-[#E5E9E6] bg-white px-3.5 text-xs text-[#171A18] placeholder-[#949D97] transition-colors focus:border-[#07813F] focus:outline-none focus:ring-1 focus:ring-[#07813F]"
            onChange={(e) => onNameChange(e.target.value)}
            id="campaign-name"
            placeholder="e.g. Promotion Été 2026"
            type="text"
            value={name}
          />
        </div>

        {/* Sending Number Trigger Widget */}
        <div>
          <label className="block text-xs font-medium text-[#66706A]">Sending number</label>
          <button
            className="mt-1.5 flex h-10 w-full items-center justify-between rounded-lg border border-[#E5E9E6] bg-white px-3.5 text-xs text-[#171A18] transition-colors hover:border-[#D1D5D3] focus:border-[#07813F] focus:outline-none"
            onClick={() => setIsModalOpen(true)}
            type="button"
          >
            <div className="flex items-center gap-2.5">
              <Phone size={15} className="text-[#66706A]" />
              {selectedPhone ? (
                <div className="flex items-center gap-2 font-medium">
                  <span>{countryIsoToFlag(selectedPhone.countryCode)}</span>
                  <span>{formatPhoneNumberDisplay(selectedPhone.phoneNumber)}</span>
                  <span className="rounded-full border border-[#C2E8D2] bg-[#E9F5EE] px-2 py-0.5 text-[10px] font-semibold text-[#07813F]">
                    {selectedPhone.status === "ready" ? "Ready" : "Pending"}
                  </span>
                </div>
              ) : (
                <span className="text-[#949D97]">Select a sending number...</span>
              )}
            </div>
            <span className="text-[10px] text-[#949D97]">▼</span>
          </button>
        </div>
      </div>

      {/* Sending Number Selector Modal */}
      <SendingNumberModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSelectNumber={(id) => {
          onPhoneNumberChange(id);
          setIsModalOpen(false);
        }}
        phoneNumbers={phoneNumbers}
        selectedPhoneNumberId={phoneNumberId}
      />
    </div>
  );
}
