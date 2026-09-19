import fs from "node:fs";

/**
 * Root fix for the hackathon log ordering drift: entries were mixed
 * (top block newest-first, tail archive oldest-first, new entries appended
 * wherever). The project's log format
 * (`.agents/skills/convex-hackathon-skill/references/log-format.md`) says:
 * "Append entries oldest to newest." This tool enforces ONE rule --
 * strictly chronological, oldest first, newest last -- and documents the rule
 * in the file so future append tools follow it.
 *
 * Same-date entries keep their existing relative order (stable sort), so a
 * deliberately ordered pair (e.g. two entries on one day) is never shuffled.
 *
 * Usage: node scripts/tools/reorder-hackathon-log.mjs [--check]
 */

const FILE = "hackathon.md";
const CONVENTION =
  "<!-- Log order: OLDEST FIRST (chronological). Append new entries at the bottom; the newest entry is last. -->";
const OLD_CONVENTIONS = [
  "<!-- Log order: NEWEST FIRST. New entries go immediately below this line. Do not append at the bottom. -->",
];

function parse(content) {
  // Normalize CRLF so the tool works identically on Windows and Unix checkouts.
  const normalized = content.replace(/\r\n/g, "\n");
  const marker = "\n## Log\n";
  const idx = normalized.indexOf(marker);
  if (idx === -1) throw new Error("hackathon.md is missing the '## Log' section");
  let head = normalized.slice(0, idx + marker.length);
  const body = normalized.slice(idx + marker.length);
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

function stripConventionComments(text) {
  let next = text;
  for (const comment of [CONVENTION, ...OLD_CONVENTIONS]) {
    next = next.split(comment).join("");
  }
  return next.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function render({ head, intro, entries }) {
  // Ascending date order, stable within a date (a.order).
  const sorted = [...entries].sort((a, b) => {
    if (a.date === b.date) return a.order - b.order;
    return a.date < b.date ? -1 : 1;
  });
  const cleanHead = stripConventionComments(head);
  const cleanIntro = stripConventionComments(intro).trim();
  const conven = `\n${CONVENTION}\n`;
  return `${cleanHead}${conven}${cleanIntro ? `\n${cleanIntro}\n` : "\n"}\n${sorted.map((e) => e.text).join("\n\n")}\n`;
}

const raw = fs.readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
const parsed = parse(raw);
const currentDates = parsed.entries.map((e) => e.date);
const sortedDates = [...currentDates].sort();
const inOrder = JSON.stringify(currentDates) === JSON.stringify(sortedDates);
const hasConvention = raw.includes(CONVENTION);
const hasOldConvention = OLD_CONVENTIONS.some((comment) => raw.includes(comment));

if (process.argv.includes("--check")) {
  console.log(
    JSON.stringify(
      { ok: inOrder && hasConvention && !hasOldConvention, inOrder, hasConvention, hasOldConvention, entries: parsed.entries.length },
      null,
      2
    )
  );
  process.exit(inOrder && hasConvention && !hasOldConvention ? 0 : 1);
}

const next = render(parsed);
fs.writeFileSync(FILE, next, "utf8");
console.log(
  `normalized ${parsed.entries.length} entries to oldest-first; convention=${hasConvention ? "kept" : "added"}${hasOldConvention ? "; removed stale newest-first marker" : ""}`
);