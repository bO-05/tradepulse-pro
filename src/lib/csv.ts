const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * A3-02: RFC-4180-safe CSV cell. Quotes every field, doubles embedded quotes,
 * and neutralizes spreadsheet formula injection (=, +, -, @) with a leading
 * apostrophe so an imported bidder name can never execute in Excel.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}