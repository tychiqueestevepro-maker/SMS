"use client";

import React from "react";
import { Clock } from "lucide-react";

type CampaignScheduleCardProps = {
  timezone: string;
  onTimezoneChange: (tz: string) => void;
  dripIntervalMinutes: number;
  onDripIntervalChange: (interval: number) => void;
  sendWindowStart: string;
  onSendWindowStartChange: (start: string) => void;
  sendWindowEnd: string;
  onSendWindowEndChange: (end: string) => void;
  sendingDays: number[];
  onSendingDaysChange: (days: number[]) => void;
};

const DAYS = [
  { id: 1, label: "Mon", defaultSelected: true },
  { id: 2, label: "Tue", defaultSelected: true },
  { id: 3, label: "Wed", defaultSelected: true },
  { id: 4, label: "Thu", defaultSelected: true },
  { id: 5, label: "Fri", defaultSelected: true },
  { id: 6, label: "Sat", defaultSelected: false },
  { id: 7, label: "Sun", defaultSelected: false },
];

export function CampaignScheduleCard({
  timezone,
  onTimezoneChange,
  dripIntervalMinutes,
  onDripIntervalChange,
  sendWindowStart,
  onSendWindowStartChange,
  sendWindowEnd,
  onSendWindowEndChange,
  sendingDays,
  onSendingDaysChange,
}: CampaignScheduleCardProps) {

  const toggleDay = (id: number) => {
    const next = new Set(sendingDays);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    
    // Convert Set back to array and sort it
    onSendingDaysChange(Array.from(next).sort((a, b) => a - b));
  };

  return (
    <div className="rounded-2xl border border-[#E5E9E6] bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-[#171A18]">Schedule / Campaign settings</h2>
      <p className="mt-0.5 text-xs text-[#66706A]">
        Configure when and how messages are sent.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Time zone */}
        <div>
          <label className="block text-xs font-medium text-[#66706A]">Time zone</label>
          <select
            className="mt-1.5 h-10 w-full rounded-lg border border-[#E5E9E6] bg-white px-3 text-xs text-[#171A18] focus:border-[#07813F] focus:outline-none"
            onChange={(e) => onTimezoneChange(e.target.value)}
            value={timezone}
          >
            <option value="UTC">Coordinated Universal Time (UTC)</option>
            <option value="America/New_York">Eastern Time (EST - New York)</option>
            <option value="America/Chicago">Central Time (CST - Chicago)</option>
            <option value="America/Los_Angeles">Pacific Time (PST - Los Angeles)</option>
            <option value="Europe/Paris">Central European Time (CET - Paris)</option>
            <option value="Europe/London">Greenwich Mean Time (GMT - London)</option>
          </select>
        </div>

        {/* Drip interval */}
        <div>
          <label className="block text-xs font-medium text-[#66706A]">Drip interval</label>
          <select
            className="mt-1.5 h-10 w-full rounded-lg border border-[#E5E9E6] bg-white px-3 text-xs text-[#171A18] focus:border-[#07813F] focus:outline-none"
            onChange={(e) => onDripIntervalChange(Number(e.target.value))}
            value={dripIntervalMinutes}
          >
            <option value={1}>1 minute</option>
            <option value={2}>2 minutes</option>
            <option value={5}>5 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
          </select>
          <span className="mt-1 block text-[11px] text-[#949D97]">
            Delay between each recipient&apos;s enrollment.
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Send Window */}
        <div>
          <label className="block text-xs font-medium text-[#66706A]">Send window</label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              className="h-10 w-full rounded-lg border border-[#E5E9E6] bg-white px-3 text-xs text-[#171A18] focus:border-[#07813F] focus:outline-none"
              onChange={(e) => onSendWindowStartChange(e.target.value)}
              type="text"
              value={sendWindowStart.slice(0, 5)}
            />
            <span className="text-xs text-[#66706A]">→</span>
            <div className="relative w-full">
              <input
                className="h-10 w-full rounded-lg border border-[#E5E9E6] bg-white pl-3 pr-8 text-xs text-[#171A18] focus:border-[#07813F] focus:outline-none"
                onChange={(e) => onSendWindowEndChange(e.target.value)}
                type="text"
                value={sendWindowEnd.slice(0, 5)}
              />
              <Clock size={14} className="absolute right-2.5 top-3 text-[#949D97]" />
            </div>
          </div>
        </div>

        {/* Days Pill Selector */}
        <div>
          <label className="block text-xs font-medium text-[#66706A]">Days</label>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {DAYS.map((day) => {
              const isSelected = sendingDays.includes(day.id);
              return (
                <button
                  className={`h-9 min-w-10 rounded-lg px-2.5 text-xs font-semibold transition-colors ${
                    isSelected
                      ? "border border-[#C2E8D2] bg-[#E9F5EE] text-[#07813F]"
                      : "border border-[#E5E9E6] bg-[#F2F4F3] text-[#66706A] hover:bg-[#EEF0EE]"
                  }`}
                  key={day.id}
                  onClick={() => toggleDay(day.id)}
                  type="button"
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
