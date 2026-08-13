"use client";

import React, { useState } from "react";
import { TrendingUp } from "lucide-react";

import type { CampaignActivityPointDto } from "@/components/campaigns/types";

type CampaignActivityChartProps = {
  data: CampaignActivityPointDto[];
};

export function CampaignActivityChart({ data }: CampaignActivityChartProps) {
  const [period, setPeriod] = useState("7days");

  const hasData = data.some((point) => point.sent > 0 || point.replies > 0);

  // SVG Chart Dimensions
  const width = 500;
  const height = 180;
  const padding = 30;

  const maxVal = Math.max(
    10,
    ...data.map((d) => Math.max(d.sent, d.replies)),
  );

  const getX = (idx: number) => {
    if (data.length <= 1) return padding;
    return padding + (idx / (data.length - 1)) * (width - 2 * padding);
  };

  const getY = (val: number) => {
    return height - padding - (val / maxVal) * (height - 2 * padding);
  };

  const sentPoints = data.map((d, i) => `${getX(i)},${getY(d.sent)}`).join(" ");
  const replyPoints = data.map((d, i) => `${getX(i)},${getY(d.replies)}`).join(" ");

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-[#E5E9E6] bg-white p-5 shadow-sm">
      {/* Header & Legend */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#171A18]">Activity over time</h2>
          <div className="mt-2 flex items-center gap-4 text-xs font-medium text-[#66706A]">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[#07813F]" />
              <span>Sent</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[#0066FF]" />
              <span>Replies</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[#B97913]" />
              <span>Reply rate (%)</span>
            </span>
          </div>
        </div>

        <select
          className="h-8 rounded-lg border border-[#E5E9E6] bg-white px-2.5 text-xs text-[#171A18] focus:border-[#07813F] focus:outline-none"
          onChange={(e) => setPeriod(e.target.value)}
          value={period}
        >
          <option value="7days">Last 7 days</option>
          <option value="14days">Last 14 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      {/* SVG Line Chart */}
      <div className="mt-4 w-full">
        {!hasData ? (
          <div className="flex h-[180px] flex-col items-center justify-center rounded-xl bg-[#FBFCFB] p-6 text-center">
            <TrendingUp size={24} className="text-[#949D97]" />
            <p className="mt-2 text-xs font-medium text-[#66706A]">No sending activity yet</p>
            <p className="mt-0.5 text-[11px] text-[#949D97]">
              Sending timeline and reply trends will populate as messages are dispatched.
            </p>
          </div>
        ) : (
          <div className="relative overflow-x-auto">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
                const y = padding + pct * (height - 2 * padding);
                const val = Math.round(maxVal * (1 - pct));
                return (
                  <g key={i}>
                    <line
                      x1={padding}
                      y1={y}
                      x2={width - padding}
                      y2={y}
                      stroke="#EEF0EE"
                      strokeDasharray="3 3"
                    />
                    <text x={padding - 8} y={y + 3} textAnchor="end" className="text-[9px] fill-[#949D97]">
                      {val}
                    </text>
                  </g>
                );
              })}

              {/* Sent Line (Green) */}
              <polyline
                fill="none"
                stroke="#07813F"
                strokeWidth="2.5"
                points={sentPoints}
              />

              {/* Replies Line (Blue) */}
              <polyline
                fill="none"
                stroke="#0066FF"
                strokeWidth="2.5"
                points={replyPoints}
              />

              {/* Data dots */}
              {data.map((d, i) => (
                <g key={i}>
                  <circle cx={getX(i)} cy={getY(d.sent)} r="3.5" fill="#07813F" />
                  <circle cx={getX(i)} cy={getY(d.replies)} r="3.5" fill="#0066FF" />
                  <text
                    x={getX(i)}
                    y={height - 8}
                    textAnchor="middle"
                    className="text-[9px] fill-[#949D97]"
                  >
                    {d.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
