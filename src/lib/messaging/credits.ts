const GSM_BASIC_CHARACTERS = new Set(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);

const GSM_EXTENDED_CHARACTERS = new Set(Array.from("^{}\\[~]|€"));

export type SmsEncoding = "gsm-7" | "unicode";

export type SmsSegmentEstimate = Readonly<{
  encoding: SmsEncoding;
  segments: number;
  units: number;
}>;

export function estimateSmsSegments(message: string): SmsSegmentEstimate {
  if (message.length === 0) {
    return { encoding: "gsm-7", segments: 0, units: 0 };
  }

  let gsmUnits = 0;

  for (const character of message) {
    if (GSM_BASIC_CHARACTERS.has(character)) {
      gsmUnits += 1;
    } else if (GSM_EXTENDED_CHARACTERS.has(character)) {
      gsmUnits += 2;
    } else {
      const unicodeUnits = message.length;
      return {
        encoding: "unicode",
        segments:
          unicodeUnits <= 70 ? 1 : Math.ceil(unicodeUnits / 67),
        units: unicodeUnits,
      };
    }
  }

  return {
    encoding: "gsm-7",
    segments: gsmUnits <= 160 ? 1 : Math.ceil(gsmUnits / 153),
    units: gsmUnits,
  };
}

/**
 * Estimates the SMS credits shown before sending. Final billing always uses
 * the provider-reported segment count.
 */
export function estimateSmsCredits(message: string): number {
  return estimateSmsSegments(message).segments;
}
