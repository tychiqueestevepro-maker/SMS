"use client";

import React, { useMemo, useState } from "react";
import { FileText, UserPlus, X } from "lucide-react";

import type { CampaignContactOption } from "@/components/campaigns/types";

type CampaignAudienceCardProps = {
  contacts: CampaignContactOption[];
  selectedContactIds: string[];
  onSelectedContactIdsChange: (ids: string[]) => void;
};

export function CampaignAudienceCard({
  contacts,
  selectedContactIds,
  onSelectedContactIdsChange,
}: CampaignAudienceCardProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedSet = useMemo(() => new Set(selectedContactIds), [selectedContactIds]);

  const stats = useMemo(() => {
    const selectedList = contacts.filter((c) => selectedSet.has(c.contactId));
    const eligibleList = selectedList.filter((c) => !c.isSuppressed && !c.hasActiveSequence);
    const suppressedCount = selectedList.filter((c) => c.isSuppressed).length;
    const invalidCount = selectedList.filter((c) => c.hasActiveSequence).length;

    return {
      duplicates: suppressedCount,
      eligible: eligibleList.length,
      invalid: invalidCount,
      selected: selectedList.length,
    };
  }, [contacts, selectedSet]);

  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const q = searchQuery.toLowerCase().trim();
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phoneNumber.includes(q) ||
        (c.company && c.company.toLowerCase().includes(q)),
    );
  }, [contacts, searchQuery]);

  const toggleContact = (id: string) => {
    if (selectedSet.has(id)) {
      onSelectedContactIdsChange(selectedContactIds.filter((cId) => cId !== id));
    } else {
      onSelectedContactIdsChange([...selectedContactIds, id]);
    }
  };

  const selectAll = () => {
    onSelectedContactIdsChange(contacts.map((c) => c.contactId));
  };

  const clearAll = () => {
    onSelectedContactIdsChange([]);
  };

  return (
    <div className="rounded-2xl border border-[#E5E9E6] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#171A18]">Audience</h2>
          <p className="mt-0.5 text-xs text-[#66706A]">
            Import your contacts and review audience quality.
          </p>
        </div>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E5E9E6] bg-white px-3 text-xs font-medium text-[#171A18] hover:bg-[#FBFCFB]"
          onClick={() => setIsDrawerOpen(true)}
          type="button"
        >
          <UserPlus size={14} className="text-[#66706A]" />
          <span>Select contacts ({stats.selected})</span>
        </button>
      </div>

      {/* CSV File Row Preview if selected */}
      {stats.selected > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-[#EEF0EE] bg-[#FBFCFB] p-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-[#E9F5EE] text-[#07813F]">
              <FileText size={18} />
            </div>
            <div>
              <p className="text-xs font-semibold text-[#171A18]">contacts_selected.csv</p>
              <p className="mt-0.5 text-[11px] text-[#66706A]">
                Uploaded Aug 9, 2026 • {stats.selected} contacts selected
              </p>
            </div>
          </div>
          <button
            className="text-xs font-medium text-[#DA4545] hover:underline"
            onClick={clearAll}
            type="button"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Statistics Row */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-[#EEF0EE] bg-[#FBFCFB] p-3">
          <span className="text-[11px] font-medium text-[#66706A]">Selected</span>
          <span className="mt-1 block text-lg font-bold text-[#171A18]">{stats.selected}</span>
        </div>
        <div className="rounded-xl border border-[#EEF0EE] bg-[#FBFCFB] p-3">
          <span className="text-[11px] font-medium text-[#66706A]">Eligible</span>
          <span className="mt-1 block text-lg font-bold text-[#07813F]">{stats.eligible}</span>
        </div>
        <div className="rounded-xl border border-[#EEF0EE] bg-[#FBFCFB] p-3">
          <span className="text-[11px] font-medium text-[#66706A]">Duplicates</span>
          <span className="mt-1 block text-lg font-bold text-[#66706A]">{stats.duplicates}</span>
        </div>
        <div className="rounded-xl border border-[#EEF0EE] bg-[#FBFCFB] p-3">
          <span className="text-[11px] font-medium text-[#66706A]">Invalid numbers</span>
          <span className="mt-1 block text-lg font-bold text-[#DA4545]">{stats.invalid}</span>
        </div>
      </div>

      {/* Contact Selection Modal / Drawer */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-[#E5E9E6] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-[#171A18]">Select Contacts</h3>
                <p className="mt-0.5 text-xs text-[#66706A]">
                  Choose which contacts to include in this campaign sequence.
                </p>
              </div>
              <button
                className="rounded-lg p-1 text-[#949D97] hover:bg-[#F2F4F3]"
                onClick={() => setIsDrawerOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <input
                className="h-9 w-full rounded-lg border border-[#E5E9E6] px-3 text-xs text-[#171A18] placeholder-[#949D97] focus:border-[#07813F] focus:outline-none"
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search contacts..."
                type="text"
                value={searchQuery}
              />
              <button
                className="h-9 whitespace-nowrap rounded-lg border border-[#E5E9E6] px-3 text-xs font-medium text-[#171A18] hover:bg-[#F2F4F3]"
                onClick={selectAll}
                type="button"
              >
                Select all
              </button>
            </div>

            <div className="mt-4 max-h-[300px] overflow-y-auto rounded-xl border border-[#EEF0EE] divide-y divide-[#EEF0EE]">
              {filteredContacts.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#66706A]">
                  No contacts found.
                </div>
              ) : (
                filteredContacts.map((c) => {
                  const isChecked = selectedSet.has(c.contactId);
                  return (
                    <label
                      className="flex cursor-pointer items-center justify-between p-3 hover:bg-[#FBFCFB]"
                      key={c.contactId}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          checked={isChecked}
                          className="size-4 accent-[#07813F]"
                          onChange={() => toggleContact(c.contactId)}
                          type="checkbox"
                        />
                        <div>
                          <p className="text-xs font-semibold text-[#171A18]">{c.name}</p>
                          <p className="text-[11px] text-[#66706A]">
                            {c.phoneNumber} {c.company ? `• ${c.company}` : ""}
                          </p>
                        </div>
                      </div>
                      {c.isSuppressed && (
                        <span className="rounded bg-[#FDECEC] px-1.5 py-0.5 text-[10px] font-semibold text-[#DA4545]">
                          Opted out
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-[#EEF0EE] pt-4">
              <span className="text-xs text-[#66706A]">{stats.selected} selected</span>
              <button
                className="h-9 rounded-lg bg-[#07813F] px-4 text-xs font-semibold text-white hover:opacity-90"
                onClick={() => setIsDrawerOpen(false)}
                type="button"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
