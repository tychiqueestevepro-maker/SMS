const GSM_BASIC_CHARACTERS = new Set(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);

const GSM_EXTENDED_CHARACTERS = new Set(Array.from("^{}\\[~]|€"));

/**
 * Estimates the SMS credits shown before sending. Final billing always uses
 * the provider-reported segment count.
 */
export function estimateSmsCredits(message: string): number {
  if (message.length === 0) {
    return 0;
  }

  let gsmUnits = 0;
  let usesGsmAlphabet = true;

  for (const character of message) {
    if (GSM_BASIC_CHARACTERS.has(character)) {
      gsmUnits += 1;
    } else if (GSM_EXTENDED_CHARACTERS.has(character)) {
      gsmUnits += 2;
    } else {
      usesGsmAlphabet = false;
      break;
    }
  }

  if (usesGsmAlphabet) {
    return gsmUnits <= 160 ? 1 : Math.ceil(gsmUnits / 153);
  }

  const unicodeUnits = message.length;
  return unicodeUnits <= 70 ? 1 : Math.ceil(unicodeUnits / 67);
}
