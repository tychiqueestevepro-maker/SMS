export class ContactCsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactCsvParseError";
  }
}

/** Minimal RFC 4180-style parser used to preview uploads before persistence. */
export function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  const finishValue = () => {
    row.push(value);
    value = "";
  };

  const finishRow = () => {
    finishValue();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];

    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === ",") {
      finishValue();
    } else if (character === "\n") {
      finishRow();
    } else if (character === "\r") {
      if (csv[index + 1] === "\n") {
        index += 1;
      }
      finishRow();
    } else {
      value += character;
    }
  }

  if (quoted) {
    throw new ContactCsvParseError("The CSV contains an unclosed quoted value.");
  }

  if (value.length > 0 || row.length > 0) {
    finishRow();
  }

  return rows;
}

export function isEmptyCsvRow(row: readonly string[]): boolean {
  return row.every((value) => value.trim().length === 0);
}

export function escapeCsvValue(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}
