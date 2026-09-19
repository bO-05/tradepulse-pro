import fs from "node:fs";

/**
 * Root fix for the hackathon log ordering drift: entries were mixed
 * (top section newest-first, tail archive oldest-first, new entries appended
 * wherever). This tool enforces ONE rule — strictly newest-first — and
 * documents the rule in the file so future append tools follow it.
 *
 * Usage: node scripts/tools/reorder-hackathon-log.mjs [--check]
 */

const FILE = "hackathon.md";
const CONVENTION = "<!-- Log order: NEWEST FIRST. New entries go immediately below this line. Do not append at the bottom. -->";

function parse(content) {
  const marker = "\n## Log\n";
  const idx = content.indexOf(marker);
  if (idx === -1) throw new Error("hackathon.md is missing the '## Log' section");
  const head = content.slice(0, idx + marker.length);
  const body = content.slice(idx + marker.length);
  const parts = body.split(/\n(?=### )/);
  const intro = parts.shift() ?? "";
  const entries = parts
    .map((text, i) => {
      const m = text.match(/^### (\d{4}-\d{2}-\d{2}) - /);
      if (!m) return null;
      return { date: m[1], text: text.replace(/\s+$/, ""), order: i };
    })
    .filter(Boolean);
  return { head, intro, entries };
}

function render({ head, intro, entries }, keepConvention) {
  const sorted = [...entries].sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? 1 : -1));
  const conven = head.includes("Log order: NEWEST FIRST") ? "" : `\n${CONVENTION}\n`;
  const introClean = intro.replace(/\s+$/, "");
  return `${head}${conven}${introClean ? `\n${introClean}\n` : "\n"}\n${sorted.map((e) => e.text).join("\n\n")}\n`;
}

const raw = fs.readFileSync(FILE, "utf8");
const parsed = parse(raw);
const sortedDates = parsed.entries.map((e) => e.date).sort().reverse();
const currentDates = parsed.entries.map((e) => e.date);
const sorted = JSON.stringify(currentDates) === JSON.stringify(sortedDates);
const hasConvention = raw.includes("Log order: NEWEST FIRST");

if (process.argv.includes("--check")) {
  console.log(JSON.stringify({ ok: sorted && hasConvention, sorted, hasConvention, entries: parsed.entries.length }, null, 2));
  process.exit(sorted && hasConvention ? 0 : 1);
}

const next = render(parsed, hasConvention);
fs.writeFileSync(FILE, next, "utf8");
console.log(`reordered ${parsed.entries.length} entries; convention=${!hasConvention ? "added" : "present"}`);