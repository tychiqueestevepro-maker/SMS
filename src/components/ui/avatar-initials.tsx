import React from "react";

const COLORS = [
  "bg-red-100 text-red-600",
  "bg-orange-100 text-orange-600",
  "bg-amber-100 text-amber-600",
  "bg-green-100 text-green-600",
  "bg-emerald-100 text-emerald-600",
  "bg-teal-100 text-teal-600",
  "bg-cyan-100 text-cyan-600",
  "bg-blue-100 text-blue-600",
  "bg-indigo-100 text-indigo-600",
  "bg-violet-100 text-violet-600",
  "bg-purple-100 text-purple-600",
  "bg-fuchsia-100 text-fuchsia-600",
  "bg-pink-100 text-pink-600",
  "bg-rose-100 text-rose-600",
];

export function AvatarInitials({
  firstName,
  lastName,
  size = "size-9",
  className = "",
}: {
  firstName: string;
  lastName: string;
  size?: string;
  className?: string;
}) {
  const f = firstName.trim();
  const l = lastName.trim();
  const initials = ((f[0] || "") + (l[0] || "")).toUpperCase() || "?";
  
  // deterministic color based on initials
  let hash = 0;
  for (let i = 0; i < initials.length; i++) {
    hash = initials.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorIndex = Math.abs(hash) % COLORS.length;
  const colorClass = COLORS[colorIndex];

  return (
    <div
      className={`grid place-items-center rounded-full font-semibold text-xs ${colorClass} ${size} ${className}`}
    >
      {initials}
    </div>
  );
}
