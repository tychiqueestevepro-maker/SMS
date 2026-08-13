"use client";

import React, { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import Link from "next/link";

import {
  CountryFlagBadge,
  formatPhoneNumberDisplay,
} from "@/components/campaigns/phone-number-identity";
import type { CampaignPhoneOption } from "@/components/campaigns/types";

type SendingNumberModalProps = {
  isOpen: boolean;
  onClose: () => void;
  phoneNumbers: CampaignPhoneOption[];
  selectedPhoneNumberId: string | null;
  onSelectNumber: (phoneNumberId: string) => void;
};

export function SendingNumberModal({
  isOpen,
  onClose,
  phoneNumbers,
  selectedPhoneNumberId,
  onSelectNumber,
}: SendingNumberModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(selectedPhoneNumberId);

  const countries = useMemo(() => {
    const set = new Set<string>();
    phoneNumbers.forEach((p) => {
      if (p.countryCode) set.add(p.countryCode);
    });
    return Array.from(set);
  }, [phoneNumbers]);

  const filteredNumbers = useMemo(() => {
    return phoneNumbers.filter((p) => {
      const matchCountry = countryFilter === "all" || p.countryCode === countryFilter;
      const matchQuery =
        !searchQuery.trim() ||
        p.phoneNumber.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
        (p.label && p.label.toLowerCase().includes(searchQuery.toLowerCase().trim()));
      return matchCountry && matchQuery;
    });
  }, [phoneNumbers, countryFilter, searchQuery]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (selectedId) {
      onSelectNumber(selectedId);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-[#E5E9E6] bg-white shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#EEF0EE] p-5 pb-4">
          <div>
            <h2 className="text-base font-bold text-[#171A18]">Select sending number</h2>
            <p className="text-xs text-[#66706A]">
              Choose a Ready number to use for this campaign.
            </p>
          </div>
          <button
            className="grid size-8 place-items-center rounded-lg text-[#949D97] hover:bg-[#F2F4F3] hover:text-[#171A18]"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col gap-3 border-b border-[#EEF0EE] p-5 py-3.5 bg-[#FBFCFB]">
          <div className="flex items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#949D97]"
              />
              <input
                className="h-9 w-full rounded-xl border border-[#E5E9E6] bg-white pl-9 pr-3 text-xs text-[#171A18] placeholder-[#949D97] focus:border-[#07813F] focus:outline-none"
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by number or label..."
                type="text"
                value={searchQuery}
              />
            </div>

            {/* Country Dropdown */}
            <select
              className="h-9 rounded-xl border border-[#E5E9E6] bg-white px-3 text-xs font-medium text-[#171A18] focus:border-[#07813F] focus:outline-none"
              onChange={(e) => setCountryFilter(e.target.value)}
              value={countryFilter}
            >
              <option value="all">All countries</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table Body */}
        <div className="flex-1 overflow-y-auto p-5 py-2">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#EEF0EE] text-[11px] font-semibold text-[#949D97]">
                <th className="py-2.5 pl-3 font-medium">Number</th>
                <th className="py-2.5 font-medium">Label</th>
                <th className="py-2.5 font-medium">Status</th>
                <th className="py-2.5 pr-3 font-medium">Country</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF0EE]">
              {filteredNumbers.length === 0 ? (
                <tr>
                  <td className="py-8 text-center text-xs text-[#66706A]" colSpan={4}>
                    No phone numbers match your search.
                  </td>
                </tr>
              ) : (
                filteredNumbers.map((phone) => {
                  const isSelected = selectedId === phone.id;
                  const isReady = phone.status === "ready";

                  return (
                    <tr
                      className={`cursor-pointer transition-colors ${
                        isSelected ? "bg-[#E9F5EE]" : "hover:bg-[#FBFCFB]"
                      }`}
                      key={phone.id}
                      onClick={() => setSelectedId(phone.id)}
                    >
                      <td className="py-3 pl-3">
                        <div className="flex items-center gap-3">
                          <input
                            checked={isSelected}
                            className="size-4 accent-[#07813F]"
                            onChange={() => setSelectedId(phone.id)}
                            type="radio"
                          />
                          <span className="font-semibold text-[#171A18]">
                            {formatPhoneNumberDisplay(phone.phoneNumber)}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 text-[#66706A]">
                        {phone.label ? (
                          <span className="rounded bg-[#F2F4F3] px-1.5 py-0.5 text-[11px] font-medium text-[#66706A]">
                            {phone.label}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3 px-2">
                        {phone.inUse ? (
                          <span className="rounded-full border border-[#FBE3B5] bg-[#FFF4DE] px-2 py-0.5 text-[11px] font-semibold text-[#B97913]">
                            In use
                          </span>
                        ) : isReady ? (
                          <span className="rounded-full border border-[#C2E8D2] bg-[#E9F5EE] px-2 py-0.5 text-[11px] font-semibold text-[#07813F]">
                            Ready
                          </span>
                        ) : (
                          <span className="rounded-full border border-[#E5E9E6] bg-[#F2F4F3] px-2 py-0.5 text-[11px] font-semibold text-[#66706A]">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-[#66706A]">
                        <CountryFlagBadge countryCode={phone.countryCode} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-[#EEF0EE] p-5 pt-3.5 bg-[#FBFCFB]">
          <Link
            className="text-xs font-semibold text-[#07813F] hover:underline"
            href="/settings"
            onClick={onClose}
          >
            Manage numbers
          </Link>

          <div className="flex items-center gap-2">
            <button
              className="h-9 rounded-xl border border-[#E5E9E6] bg-white px-4 text-xs font-semibold text-[#171A18] hover:bg-[#F2F4F3]"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="h-9 rounded-xl bg-[#07813F] px-4 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              disabled={!selectedId}
              onClick={handleConfirm}
              type="button"
            >
              Select number
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
