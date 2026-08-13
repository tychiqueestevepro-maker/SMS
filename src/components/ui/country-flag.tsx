"use client";

import React from "react";

type CountryFlagProps = {
  countryCode?: string | null;
  className?: string;
};

export function CountryFlag({ countryCode, className = "size-4" }: CountryFlagProps) {
  const code = (countryCode || "US").toUpperCase();

  switch (code) {
    case "FR":
      return (
        <svg
          className={`inline-block rounded-xs shadow-2xs ${className}`}
          viewBox="0 0 3 2"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="1" height="2" x="0" fill="#002654" />
          <rect width="1" height="2" x="1" fill="#FFFFFF" />
          <rect width="1" height="2" x="2" fill="#CE1126" />
        </svg>
      );

    case "CA":
      return (
        <svg
          className={`inline-block rounded-xs shadow-2xs ${className}`}
          viewBox="0 0 4 2"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="1" height="2" x="0" fill="#FF0000" />
          <rect width="2" height="2" x="1" fill="#FFFFFF" />
          <rect width="1" height="2" x="3" fill="#FF0000" />
          <path
            d="M 2.0 0.4 L 2.15 0.75 L 2.4 0.65 L 2.3 0.9 L 2.6 1.05 L 2.35 1.25 L 2.45 1.45 L 2.1 1.4 L 2.0 1.7 L 1.9 1.4 L 1.55 1.45 L 1.65 1.25 L 1.4 1.05 L 1.7 0.9 L 1.6 0.65 L 1.85 0.75 Z"
            fill="#FF0000"
          />
        </svg>
      );

    case "GB":
    case "UK":
      return (
        <svg
          className={`inline-block rounded-xs shadow-2xs ${className}`}
          viewBox="0 0 60 30"
          xmlns="http://www.w3.org/2000/svg"
        >
          <clipPath id="s">
            <path d="M0,0 v30 h60 v-30 z" />
          </clipPath>
          <clipPath id="t">
            <path d="M30,15 h30 v15 z m-30,0 h-30 v15 z m30,0 h30 v-15 z m-30,0 h-30 v-15 z" />
          </clipPath>
          <g clipPath="url(#s)">
            <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
            <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#t)" stroke="#cc0000" strokeWidth="4" />
            <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
            <path d="M30,0 v30 M0,15 h60" stroke="#cc0000" strokeWidth="6" />
          </g>
        </svg>
      );

    case "US":
    default:
      return (
        <svg
          className={`inline-block rounded-xs shadow-2xs ${className}`}
          viewBox="0 0 190 100"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="190" height="100" fill="#B22234" />
          <path d="M0,7.69 h190 M0,23.07 h190 M0,38.46 h190 M0,53.84 h190 M0,69.23 h190 M0,84.61 h190" stroke="#fff" strokeWidth="7.69" />
          <rect width="76" height="53.85" fill="#3C3B6E" />
          <g fill="#fff">
            <circle cx="12" cy="9" r="2.5" />
            <circle cx="26" cy="9" r="2.5" />
            <circle cx="40" cy="9" r="2.5" />
            <circle cx="54" cy="9" r="2.5" />
            <circle cx="68" cy="9" r="2.5" />
            <circle cx="19" cy="18" r="2.5" />
            <circle cx="33" cy="18" r="2.5" />
            <circle cx="47" cy="18" r="2.5" />
            <circle cx="61" cy="18" r="2.5" />
            <circle cx="12" cy="27" r="2.5" />
            <circle cx="26" cy="27" r="2.5" />
            <circle cx="40" cy="27" r="2.5" />
            <circle cx="54" cy="27" r="2.5" />
            <circle cx="68" cy="27" r="2.5" />
            <circle cx="19" cy="36" r="2.5" />
            <circle cx="33" cy="36" r="2.5" />
            <circle cx="47" cy="36" r="2.5" />
            <circle cx="61" cy="36" r="2.5" />
            <circle cx="12" cy="45" r="2.5" />
            <circle cx="26" cy="45" r="2.5" />
            <circle cx="40" cy="45" r="2.5" />
            <circle cx="54" cy="45" r="2.5" />
            <circle cx="68" cy="45" r="2.5" />
          </g>
        </svg>
      );
  }
}
