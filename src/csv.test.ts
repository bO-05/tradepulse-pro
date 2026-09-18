import { expect, test } from "vitest";
import { buildCsv, csvCell } from "./lib/csv.ts";

test("A3-02: CSV cells escape quotes, newlines and commas", () => {
  expect(csvCell('Alterman, Inc.')).toBe('"Alterman, Inc."');
  expect(csvCell('He said "low"')).toBe('"He said ""low"""');
  expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  expect(csvCell(null)).toBe('""');
  expect(csvCell(1225000)).toBe('"1225000"');
});

test("A3-02: CSV cells neutralize spreadsheet formula injection", () => {
  expect(csvCell('=HYPERLINK("http://evil.example","x")')).toBe('"\'=HYPERLINK(""http://evil.example"",""x"")"');
  expect(csvCell("+1+1")).toBe("\"'+1+1\"");
  expect(csvCell("-2-2")).toBe('"\'-2-2"');
  expect(csvCell("@SUM(A1)")).toBe('"\'@SUM(A1)"');
});

test("A3-02: buildCsv emits CRLF rows with a BOM and never splits a cell on embedded commas", () => {
  const csv = buildCsv(["Name", "COI"], [['Evil "Co", Inc.', 'compliant" =1+1']]);
  expect(csv[0]).toBe("\uFEFF");
  const lines = csv.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
  expect(lines.length).toBe(2);
  expect(lines[0]).toBe('"Name","COI"');
  // The embedded quote in the COI cell is doubled, so no parser sees a field break.
  expect(lines[1]).toContain('compliant"" =1+1"');
  expect((lines[1].match(/"/g) || []).length % 2).toBe(0);
});