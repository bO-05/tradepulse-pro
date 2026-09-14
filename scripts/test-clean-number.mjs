// Test of cleanNumber logic matching convex/llmRouter.ts
function cleanNumber(val, fallback = 0) {
  if (typeof val === "number") {
    return Number.isFinite(val) ? val : fallback;
  }
  if (!val) return fallback;
  if (typeof val !== "string") return fallback;

  let trimmed = val.trim();
  if (!trimmed) return fallback;

  // Check for range e.g. '$1,200,000 - $1,350,000' or '$1.2M to $1.4M' or 'between $1.2M and $1.4M'
  const withoutBetween = trimmed.replace(/^between\s+/i, "");
  const rangeMatch = withoutBetween.match(/^([^\-–—toand]+?)\s*(?:[-–—]|\bto\b|\band\b)\s*([^\-–—toand]+)$/i);
  if (rangeMatch) {
    let p1 = rangeMatch[1].trim();
    let p2 = rangeMatch[2].trim();
    const multRegex = /(k|kilo|thousand|m|mil|million|b|bil|billion)$/i;
    const p2Mult = p2.match(multRegex);
    if (p2Mult && !multRegex.test(p1)) {
      p1 = p1 + p2Mult[1];
    }
    if (/[0-9]/.test(p1) && /[0-9]/.test(p2)) {
      const v1 = cleanNumber(p1, null);
      const v2 = cleanNumber(p2, null);
      if (v1 !== null && v2 !== null && v1 > 0 && v2 > 0) {
        return Math.round((v1 + v2) / 2);
      }
    }
  }

  // Strip common conversational estimation prefixes (~, approx, est, total)
  trimmed = trimmed.replace(/^(?:[~≈*]|approx\.?|est\.?|estimated|budget:?|total:?|sum:?|quote:?)\s*/i, "").trim();

  const isNegative =
    (trimmed.startsWith("(") && trimmed.endsWith(")")) ||
    trimmed.startsWith("-") ||
    trimmed.endsWith("-");

  // Strip trailing parenthetical notes (e.g. '(Phase 1)', '(Tax included)', '(Option A)')
  if (!(trimmed.startsWith("(") && trimmed.endsWith(")") && /^\([0-9.,\s$€£¥₹-]+\)$/.test(trimmed))) {
    trimmed = trimmed.replace(/\s*\([^)]*\)$/, "").trim();
  }

  // Remove wrapping parens or +/- signs
  trimmed = trimmed.replace(/^\(+|\)+$/g, "").replace(/^[-+]|[-+]$/g, "").trim();

  // Strip currency symbols and ISO codes: $, €, £, ¥, ₹, USD, CAD, EUR, GBP, AUD, CHF, MXN, NZD, SGD
  trimmed = trimmed
    .replace(/^([$€£¥₹]|USD|CAD|EUR|GBP|AUD|CHF|MXN|NZD|SGD)\s*/i, "")
    .replace(/\s*(USD|CAD|EUR|GBP|AUD|CHF|MXN|NZD|SGD)$/i, "")
    .trim();

  // Check abbreviated multipliers (M, K, B, million, thousand, etc.)
  const multMatch = trimmed.match(/^([0-9\s.,]+)\s*(k|kilo|thousand|m|mil|million|b|bil|billion)$/i);
  if (multMatch) {
    let numPart = multMatch[1].trim().replace(/\s+/g, "");
    const unit = multMatch[2].toLowerCase();
    if (numPart.includes(",") && !numPart.includes(".")) {
      numPart = numPart.replace(",", ".");
    } else {
      numPart = numPart.replace(/,/g, "");
    }
    const base = parseFloat(numPart);
    if (Number.isFinite(base)) {
      const multiplier =
        unit.startsWith("k") || unit.startsWith("t")
          ? 1e3
          : unit.startsWith("m")
          ? 1e6
          : 1e9;
      const res = Math.round(base * multiplier);
      return isNegative ? -res : res;
    }
    return fallback;
  }

  // Remove spaces used as thousand separators (e.g. '1 250 000,50')
  trimmed = trimmed.replace(/\s+/g, "");

  // Detect European vs US notation:
  const hasDot = trimmed.includes(".");
  const hasComma = trimmed.includes(",");

  if (hasDot && hasComma) {
    const lastDot = trimmed.lastIndexOf(".");
    const lastComma = trimmed.lastIndexOf(",");
    if (lastComma > lastDot) {
      trimmed = trimmed.replace(/\./g, "").replace(",", ".");
    } else {
      trimmed = trimmed.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    const parts = trimmed.split(",");
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      trimmed = trimmed.replace(/,/g, "");
    } else {
      trimmed = trimmed.replace(",", ".");
    }
  } else if (hasDot && !hasComma) {
    const parts = trimmed.split(".");
    if (parts.length > 2) {
      trimmed = trimmed.replace(/\./g, "");
    }
  }

  const num = parseFloat(trimmed);
  if (Number.isFinite(num)) {
    const finalVal = Math.round(num * 100) / 100;
    return isNegative ? -finalVal : finalVal;
  }
  return fallback;
}

console.log("=== Testing cleanNumber ===");
const cases = [
  ["$1,250,000.00", 1250000],
  ["$ 1.25M", 1250000],
  ["1.25 million", 1250000],
  ["$45k", 45000],
  ["($35,000.00)", -35000],
  ["-$25,000", -25000],
  ["25000-", -25000],
  ["USD 850,000", 850000],
  ["CAD 920,000.50", 920000.5],
  ["CHF 450,000", 450000],
  ["₹ 1,500,000", 1500000],
  ["MXN 2,500,000", 2500000],
  ["$1.2 - $1.4M", 1300000],
  ["between $1.2M and $1.4M", 1300000],
  ["$1,250,000 (Phase 1)", 1250000],
  ["$1,200,000 - $1,400,000", 1300000],
  ["N/A", 0],
  [null, 0],
  [undefined, 0],
  ["", 0],
];

let allPassed = true;
for (const [inp, exp] of cases) {
  const got = cleanNumber(inp);
  const ok = got === exp;
  if (!ok) allPassed = false;
  console.log(`${inp} => ${got} (expected: ${exp}) => ${ok ? "OK" : "MISMATCH"}`);
}
if (!allPassed) {
  console.error("Some test cases failed!");
  process.exit(1);
}
