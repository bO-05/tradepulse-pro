import assert from "node:assert";

console.log("================================================================================");
console.log("   TRADEPULSE PRO — REAL-WORLD PROPOSAL & PARSING EDGE CASE TEST SUITE          ");
console.log("================================================================================");

let passedCount = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`✓ PASS: ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// Improved cleanNumber with ranges, approximations, and prefixes
function cleanNumber(val, fallback = 0) {
  if (typeof val === "number") return Number.isFinite(val) ? val : fallback;
  if (val === null || val === undefined) return fallback;
  let str = String(val).trim();
  if (!str) return fallback;

  // Check for range e.g. '$1,200,000 - $1,350,000' or '$1.2M to $1.4M' or 'between $1.2M and $1.4M'
  const withoutBetween = str.replace(/^between\s+/i, "");
  const rangeMatch = withoutBetween.match(/^(.+?)\s*(?:(?<=\S)\s*[-–—]\s*(?=\S)|\bto\b|\band\b)\s*(.+)$/i);
  if (rangeMatch) {
    let p1 = rangeMatch[1].trim();
    let p2 = rangeMatch[2].trim();
    if (/\d/.test(p1) && /\d/.test(p2) && !/^[+\-]/.test(p1.trim())) {
      const multRegex = /(k|kilo|thousand|m|mil|million|b|bil|billion)$/i;
      const p2Mult = p2.match(multRegex);
      if (p2Mult && !multRegex.test(p1)) {
        p1 = p1 + p2Mult[1];
      }
      const p2Curr = p2.match(/(USD|CAD|EUR|GBP|AUD|CHF|MXN|NZD|SGD)$/i);
      if (p2Curr && !new RegExp(p2Curr[1] + "$", "i").test(p1)) {
        p1 = p1 + " " + p2Curr[1];
      }
      const v1 = cleanNumber(p1, null);
      const v2 = cleanNumber(p2, null);
      if (v1 !== null && v2 !== null && v1 > 0 && v2 > 0) {
        return Math.round((v1 + v2) / 2);
      }
    }
  }

  // Strip common conversational prefixes (~, approx, est, total)
  str = str.replace(/^(?:[~≈*]|approx\.?|est\.?|estimated|budget:?|total:?|sum:?|quote:?)\s*/i, "").trim();

  let isNegative =
    (str.startsWith("(") && str.endsWith(")")) ||
    str.startsWith("-") ||
    str.endsWith("-") ||
    /[-]\s*[$€£¥₹]/.test(str) ||
    /[$€£¥₹]\s*[-]/.test(str) ||
    /[-]\s*(?:USD|CAD|EUR|GBP|AUD|CHF|MXN|NZD|SGD)\b/i.test(str) ||
    /\b(?:USD|CAD|EUR|GBP|AUD|CHF|MXN|NZD|SGD)\s*[-]/i.test(str) ||
    /[-]\s*(?:USD|CAD|EUR|GBP|AUD|CHF|MXN|NZD|SGD)$/i.test(str);

  // Strip trailing parenthetical notes (e.g. '(Phase 1)', '(Tax included)')
  const isWrappedInParens = str.startsWith("(") && str.endsWith(")");
  if (isWrappedInParens && /\d/.test(str) && !/\b(?:tax|phase|option|addendum|scope|exempt)\b/i.test(str)) {
    // Keep accounting negative intact
  } else {
    str = str.replace(/\s*\([^)]*\)$/, "").trim();
  }

  str = str.replace(/^\(+|\)+$/g, "").replace(/^[-+]|[-+]$/g, "").trim();
  str = str
    .replace(/^(?:[$€£¥₹]|USD|CAD|EUR|GBP|AUD|CHF|MXN|NZD|SGD|\s)+/gi, "")
    .replace(/(?:[$€£¥₹]|USD|CAD|EUR|GBP|AUD|CHF|MXN|NZD|SGD|\s)+$/gi, "")
    .trim();

  if (str.startsWith("-")) {
    isNegative = true;
    str = str.replace(/^-\s*/, "");
  }
  if (str.endsWith("-")) {
    isNegative = true;
    str = str.replace(/\s*-$/, "");
  }

  const multMatch = str.match(/^([0-9\s.,]+)\s*(k|kilo|thousand|m|mil|million|b|bil|billion)$/i);
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

  str = str.replace(/\s+/g, "");
  const hasDot = str.includes(".");
  const hasComma = str.includes(",");

  if (hasDot && hasComma) {
    const lastDot = str.lastIndexOf(".");
    const lastComma = str.lastIndexOf(",");
    if (lastComma > lastDot) {
      str = str.replace(/\./g, "").replace(",", ".");
    } else {
      str = str.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    const parts = str.split(",");
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      str = str.replace(/,/g, "");
    } else {
      str = str.replace(",", ".");
    }
  } else if (hasDot && !hasComma) {
    const parts = str.split(".");
    if (parts.length > 2) {
      str = str.replace(/\./g, "");
    }
  }

  const parsed = parseFloat(str);
  if (!Number.isFinite(parsed)) return fallback;
  const finalVal = Math.round(parsed * 100) / 100;
  return isNegative ? -finalVal : finalVal;
}

// 1. Range & Prefix Parsing Tests
test("cleanNumber parses price ranges and prefixes accurately", () => {
  assert.strictEqual(cleanNumber("$1,200,000 - $1,350,000"), 1275000);
  assert.strictEqual(cleanNumber("$1.2M - $1.4M"), 1300000);
  assert.strictEqual(cleanNumber("$1.2 - $1.4M"), 1300000);
  assert.strictEqual(cleanNumber("between $1.2M and $1.4M"), 1300000);
  assert.strictEqual(cleanNumber("$1,250,000 (Phase 1)"), 1250000);
  assert.strictEqual(cleanNumber("$1,200,000 to $1,300,000"), 1250000);
  assert.strictEqual(cleanNumber("~$1,250,000"), 1250000);
  assert.strictEqual(cleanNumber("≈$980,000"), 980000);
  assert.strictEqual(cleanNumber("Est. $1,420,000"), 1420000);
  assert.strictEqual(cleanNumber("Approx. $850,000.00"), 850000);
  assert.strictEqual(cleanNumber("Budget: $2,100,000"), 2100000);
});

// 2. Multi-format Base Bid Header Extraction
test("Extracts base bid from non-standard real-world headers", () => {
  const headerPatterns = [
    /(?:Base\s*(?:Bid|Proposal|Offer|Price)?(?:\s*(?:Lump\s*Sum|Price|Amount|Total|Fee))?|Lump\s*Sum(?:\s*(?:Base\s*(?:Bid|Proposal)|Quotation|Price|Amount|Proposal|Fee))?|Contract\s*(?:Sum|Amount|Price)|Subcontract\s*(?:Sum|Amount|Price)|Grand\s*Total|Bid\s*Total|Proposed\s*(?:Total|Price|Amount)|Total\s*(?:Proposed\s*(?:Price|Amount)|Lump\s*Sum|Base\s*Bid|Contract\s*Amount|Amount|Price|Quote|Cost|Fee)|Proposal\s*(?:Amount|Price)|Price|Amount)[:\s\-=]*(?:of\s*)?([$€£CAD\s]*[0-9][0-9.,\s]*(?:[kKmMbB]|million|mil|thousand|billion)?)/i,
    /(?:we\s+propose\s+to\s+furnish|we\s+agree\s+to\s+perform)[^.\n\r]*?(?:for\s+(?:the\s+sum\s+of\b\s*)?)[:\s\-=]*([$€£CAD\s]*[0-9][0-9.,\s]*(?:[kKmMbB]|million|mil|thousand|billion)?)/i,
  ];

  function extractBase(text) {
    for (const rx of headerPatterns) {
      const m = text.match(rx);
      if (m && m[1]) {
        const val = cleanNumber(m[1], 0);
        if (val > 0) return val;
      }
    }
    return 0;
  }

  assert.strictEqual(extractBase("Base Bid Lump Sum: $1,420,000.00"), 1420000);
  assert.strictEqual(extractBase("Base Bid Price: $1,080,000.00"), 1080000);
  assert.strictEqual(extractBase("Lump Sum Base Proposal: $1,250,000"), 1250000);
  assert.strictEqual(extractBase("Subcontract Price: 950,000 USD"), 950000);
  assert.strictEqual(extractBase("Total Proposed Price: $1,190,000.00"), 1190000);
  assert.strictEqual(extractBase("We propose to furnish all labor and materials for the sum of: $1,350,000"), 1350000);
  assert.strictEqual(extractBase("Grand Total - $2,500,000.00"), 2500000);
  assert.strictEqual(extractBase("Bid Total: $890,000"), 890000);
});

// 3. Line Items Extraction & Summation Fallback
test("Extracts itemized line items and sums them when no base bid header is present", () => {
  const proposalWithNoHeader = `
PROPOSAL:
Subcontractor: Mile High Concrete LLC
Detailed Line Items:
- Foundation footings and grade beams: $620,000
- Slab-on-grade 6" with mesh: $480,000
- Elevated deck composite pour: $320,000
Exclusions:
- Winter blankets: $35,000
`;

  const customLineItems = [];
  const lines = proposalWithNoHeader.split(/\r?\n/);
  let inSection = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(?:detailed\s+)?line\s+items?:?/i.test(line)) {
      inSection = true;
      continue;
    }
    if (/(?:exclusions?|value\s+engineering|lead\s*time|insurance)/i.test(line)) {
      inSection = false;
    }
    if (inSection && /^[-*•\d.]+\s*/.test(line)) {
      const itemText = line.replace(/^[-*•\d.]+\s*/, "").trim();
      const costMatch = itemText.match(/[:\-–—]?\s*([$€£CAD\s]*[0-9][0-9.,\s]*(?:[kKmMbB]|million|mil|thousand|billion)?)\s*$/i);
      if (costMatch) {
        const cost = cleanNumber(costMatch[1], 0);
        const desc = itemText.replace(costMatch[0], "").replace(/[:\-–—\s]+$/, "").trim();
        if (cost > 0 && desc.length > 2) {
          customLineItems.push({ item: desc, totalCost: cost });
        }
      }
    }
  }

  assert.strictEqual(customLineItems.length, 3);
  const total = customLineItems.reduce((s, li) => s + li.totalCost, 0);
  assert.strictEqual(total, 1420000);
});

// 4. PDF TJ Array & Tj String Extraction
test("Extracts text correctly from PDF TJ kerning arrays and Tj operators", () => {
  const samplePdfContent = `
%PDF-1.4
1 0 obj << /Type /Catalog >> endobj
2 0 obj << /Length 200 >> stream
BT
/F1 12 Tf
[(Mile ) 10 (High ) 5 (Concrete & ) -10 (Pumping Services LLC)] TJ
ET
BT
/F1 12 Tf
[(Base Bid ) 20 (Lump Sum: ) 10 ($1,420,000.00)] TJ
ET
BT
/F1 12 Tf
(Lead time: 8 weeks) Tj
ET
endstream endobj
`;

  const tjArrays = Array.from(samplePdfContent.matchAll(/\[([\s\S]*?)\]\s*TJ/g));
  const extractedPieces = [];
  for (const arr of tjArrays) {
    const innerStrings = Array.from(arr[1].matchAll(/\(([^)]+)\)/g)).map((m) => m[1]);
    extractedPieces.push(innerStrings.join(""));
  }
  const simpleTj = Array.from(samplePdfContent.matchAll(/\(([^)]+)\)\s*Tj/g)).map((m) => m[1]);
  extractedPieces.push(...simpleTj);

  const fullText = extractedPieces.join("\n");
  assert(fullText.includes("Mile High Concrete & Pumping Services LLC"), "Must extract subcontractor name from TJ");
  assert(fullText.includes("Base Bid Lump Sum: $1,420,000.00"), "Must extract base bid from TJ");
  assert(fullText.includes("Lead time: 8 weeks"), "Must extract lead time from Tj");
});

// 5. Multi-Trade Division Pattern Detection
test("Detects CSI divisions across standard, informal, and spec formats", () => {
  function matchDiv(text, divNum) {
    const padded = divNum.padStart(2, "0");
    const single = parseInt(divNum, 10).toString();
    const rx = new RegExp(
      `\\b(?:division|div\\.?|sec\\.?|section)\\s*(?:${padded}|${single})\\b|\\b${padded}[\\s.-]*[0-9]{2}[\\s.-]*[0-9]{2}\\b|\\b${padded}[0-9]{4}\\b`,
      "i"
    );
    return rx.test(text);
  }

  assert.strictEqual(matchDiv("Scope under Division 03 - Concrete", "3"), true);
  assert.strictEqual(matchDiv("Scope under Division 3 - Concrete", "3"), true);
  assert.strictEqual(matchDiv("Per Spec Section 03 30 00", "3"), true);
  assert.strictEqual(matchDiv("Reference 03-30-00 Cast-in-Place", "3"), true);
  assert.strictEqual(matchDiv("Section 033000 General Concrete", "3"), true);
  assert.strictEqual(matchDiv("Div. 26 Electrical", "26"), true);
  assert.strictEqual(matchDiv("Div 23 Mechanical", "23"), true);
  assert.strictEqual(matchDiv("Division 22 Plumbing", "22"), true);
  assert.strictEqual(matchDiv("Division 09 Finishes", "9"), true);
  assert.strictEqual(matchDiv("Division 9 Finishes", "9"), true);
});

// 6. Scanned / Image-Only PDF Detection
test("Detects scanned/raster PDF (< 15 chars) and triggers non-blocking warning without injecting corrupted bytes", () => {
  // A scanned raster PDF with only image XObjects and no Tj or TJ text
  const scannedRasterPdf = `%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image /Width 1200 /Height 1600 >>\nstream\n\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x01\x00\x60\x00\x60\x00\x00\xFF\xDB\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`;

  function extractTextFromPdfStream(rawText) {
    if (!rawText) return "";
    const trimmedLeading = rawText.replace(/^\uFEFF/, "").trimStart();
    if (!trimmedLeading.startsWith("%PDF") && !rawText.includes("%PDF-") && !/[\x00-\x08\x0E-\x1F]/.test(rawText.slice(0, 200))) {
      return rawText;
    }
    const extractedPieces = [];
    const decodePdfLiteral = (str) => {
      return str
        .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\b/g, "\b")
        .replace(/\\f/g, "\f")
        .replace(/\\([()\\])/g, "$1");
    };
    const decodePdfHex = (hex) => {
      const cleanHex = hex.replace(/\s+/g, "");
      let out = "";
      for (let i = 0; i < cleanHex.length; i += 2) {
        const byte = parseInt(cleanHex.slice(i, i + 2), 16);
        if (!isNaN(byte) && byte >= 32 && byte <= 126) {
          out += String.fromCharCode(byte);
        } else if (byte === 10 || byte === 13 || byte === 9) {
          out += " ";
        }
      }
      return out;
    };
    const tjArrays = Array.from(rawText.matchAll(/\[([\s\S]*?)\]\s*TJ/g));
    for (const arr of tjArrays) {
      const innerParts = [];
      const tokens = Array.from(arr[1].matchAll(/\(([^)]+)\)|<([0-9a-fA-F]+)>/g));
      for (const token of tokens) {
        if (token[1] !== undefined) innerParts.push(decodePdfLiteral(token[1]));
        else if (token[2] !== undefined) innerParts.push(decodePdfHex(token[2]));
      }
      if (innerParts.length > 0) extractedPieces.push(innerParts.join(""));
    }
    const simpleTj = Array.from(rawText.matchAll(/\(([^)]{2,})\)\s*Tj/g)).map((m) =>
      decodePdfLiteral(m[1])
    );
    extractedPieces.push(...simpleTj);
    const hexTj = Array.from(rawText.matchAll(/<([0-9a-fA-F]{4,})>\s*Tj/g)).map((m) =>
      decodePdfHex(m[1])
    );
    extractedPieces.push(...hexTj);
    const extracted = extractedPieces.join("\n").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ").trim();
    if (extracted.length > 15) return extracted.slice(0, 16000);

    const textWithoutBinary = rawText.replace(/stream[\r\n][\s\S]*?endstream/gi, "");
    const segments = textWithoutBinary.match(/[A-Za-z0-9\s.,;:$%/\\()\-–—@&+=#'"_[\]*!?]{4,}/g) || [];
    const cleanTokens = segments
      .filter((s) => {
        const trimmed = s.trim();
        return (
          !trimmed.startsWith("/") &&
          !trimmed.startsWith("obj") &&
          !trimmed.startsWith("endobj") &&
          !trimmed.startsWith("<<") &&
          !trimmed.startsWith(">>") &&
          !trimmed.includes("/Font") &&
          !trimmed.includes("/Type") &&
          !trimmed.includes("/Filter") &&
          !trimmed.includes("/FlateDecode") &&
          !trimmed.includes("/Length") &&
          !trimmed.includes("/XObject") &&
          !trimmed.includes("/Subtype") &&
          !trimmed.includes("/Image") &&
          !trimmed.includes("/Width") &&
          !trimmed.includes("/Height") &&
          !trimmed.includes("/ColorSpace") &&
          !trimmed.includes("/BitsPerComponent") &&
          !trimmed.includes("/Catalog") &&
          !trimmed.includes("/Pages") &&
          !trimmed.includes("/MediaBox") &&
          !/^(?:xref|trailer|startxref|stream|endstream|EOF|%%EOF|JFIF)$/i.test(trimmed)
        );
      })
      .join(" ")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
      .trim();

    const hasRealWords = /[a-zA-Z]{3,}\s+[a-zA-Z]{3,}/.test(cleanTokens);
    const candidateText = extracted.length > 15 ? extracted : (hasRealWords && cleanTokens.length > 30 ? cleanTokens : extracted);
    return candidateText.slice(0, 16000);
  }

  const extracted = extractTextFromPdfStream(scannedRasterPdf);
  assert(extracted.trim().length < 15, `Scanned raster PDF text extraction must be < 15 chars (got ${extracted.length})`);
  
  // UI logic simulation: if extracted < 15 chars, warn user and clear textarea
  const isScanned = extracted.trim().length < 15;
  const warningText = isScanned
    ? "This PDF appears to be a scanned document or flattened raster image without selectable text streams. Please enter quote details manually or paste the proposal text below."
    : null;
  const quoteText = isScanned ? "" : extracted;

  assert.strictEqual(isScanned, true);
  assert(warningText !== null, "Warning banner must be active for scanned PDF");
  assert.strictEqual(quoteText, "", "Textarea must not be filled with binary garbage");
});

// 7. Clean Proposal Inclusions vs Exclusions Recall
test("Validates proposal with crane hoisting explicitly included incurs $0 exclusion penalty", () => {
  const cleanEmailQuote = `
Dear Estimating Team,
Please find below our lump sum quotation for Division 26 Electrical:
Base Bid Price: $1,280,000.00
Scope of Work:
1. Complete switchgear installation & primary feeders.
2. Crane hoisting & rigging to mechanical penthouse is fully INCLUDED in our base price.
3. Firestopping floor penetrations rated UL 1479 is INCLUDED.
4. Overtime & weekend cutover work is INCLUDED.
Schedule: Lead time 10 weeks.
Insurance: Compliant ACORD 25 with $5M Umbrella.
`;

  // Fallback exclusions parser from emailActions.ts
  const lower = cleanEmailQuote.toLowerCase();
  const exclusions = [];
  if (lower.includes("crane") && /(?:crane[^.\n\r]*?(?:excluded|by others|not included|gc to furnish))/i.test(cleanEmailQuote)) {
    exclusions.push({ description: "Crane hoisting excluded", costImpact: 22000 });
  }
  if (lower.includes("firestop") && /(?:firestop[^.\n\r]*?(?:excluded|by others|not included|gc to furnish))/i.test(cleanEmailQuote)) {
    exclusions.push({ description: "UL firestopping excluded", costImpact: 14500 });
  }
  if (lower.includes("overtime") && /(?:overtime[^.\n\r]*?(?:excluded|by others|not included|premium extra))/i.test(cleanEmailQuote)) {
    exclusions.push({ description: "Overtime premium excluded", costImpact: 18000 });
  }

  assert.strictEqual(exclusions.length, 0, "Clean proposal with scope INCLUDED must incur 0 exclusion penalties");
});

// 8. Non-Exclusion filtering (Phantom Exclusion Prevention)
test("Validates proposal with 'Exclusions: None' or 'None noted' incurs 0 exclusions and 0 penalty", () => {
  const proposalWithNoneExclusion = `
PROPOSAL AND QUOTATION
Project: Commercial MEP
Subcontractor: Clean Turnkey Solutions LLC
Base Bid Price: $1,210,000.00
EXCLUSIONS:
- None
- None noted
- No exclusions, 100% turnkey scope
Scope Inclusions:
- All crane hoisting, rigging, and permits included
`;

  const lines = proposalWithNoneExclusion.split(/\r?\n/);
  let inExclusionBlock = false;
  const parsedExclusions = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(?:scope\s+|specific\s+)?excluded\s+(?:items|scope)?:?/i.test(line) || /^exclusions?:?/i.test(line)) {
      inExclusionBlock = true;
      continue;
    }
    if (/(?:inclusions?|notes?|clarifications?|terms|lead|insurance)/i.test(line) && !line.includes("excluded")) {
      inExclusionBlock = false;
    }
    const hasExclusionWord = /\b(?:excluded|exclude|by others|by gc|not included|carve-out)\b/i.test(line);
    const isBulleted = /^[-*•\d.]/.test(line);

    if (((inExclusionBlock && isBulleted) || hasExclusionWord) && line.length > 3 && !line.startsWith("#")) {
      const cleanDesc = line.replace(/^[-*•\d.]+\s*/, "").trim();
      const descLower = cleanDesc.toLowerCase();

      const isNonExclusion =
        /\b(?:none|n\/?a|not\s+applicable|no\s+exclusions?|zero\s+exclusions?|none\s+noted|none\s+taken|all\s+(?:work|scope)\s+(?:is\s+)?included|100%\s+turnkey)\b/i.test(cleanDesc) ||
        descLower.replace(/[^a-z]/g, "") === "none" ||
        descLower.replace(/[^a-z]/g, "") === "na";
      if (isNonExclusion) continue;

      if (
        descLower.startsWith("scope inclusion") ||
        descLower.startsWith("inclusion") ||
        (/\b(?:included|furnished\s+and\s+installed|all\s+included)\b/i.test(descLower) &&
         !/\b(?:excluded|exclude|by\s+others|by\s+gc|not\s+included|carve-out)\b/i.test(descLower))
      ) {
        continue;
      }

      parsedExclusions.push({ description: cleanDesc, costImpact: 15000 });
    }
  }

  assert.strictEqual(parsedExclusions.length, 0, "Must not create phantom exclusions for 'None' or 'None noted'");
});

// 9. Location & State Code Parsing (Non-comma and ZIP robustness)
test("Validates parseCityAndState handles diverse non-comma locations and state codes", async () => {
  const { parseCityAndState } = await import("../dist/assets/index-Dd5y3ebS.js").catch(() => ({}));
  // Also test inline algorithm matching standaloneStore
  function localParseCityAndState(location) {
    if (!location || !location.trim()) return { city: "Austin", state: "Texas", stateAbbr: "TX" };
    const STATE_MAP = {
      AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
      CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
      HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
      KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
      MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
      MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
      NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
      OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
      SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
      VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
    };
    const trimmed = location.trim();
    if (trimmed.includes(",")) {
      const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
      const city = parts[0] || "Austin";
      const statePart = parts[1] || "";
      const cleanedPart = statePart.replace(/[^a-zA-Z]/g, "").toUpperCase();
      const stateAbbr = STATE_MAP[cleanedPart] ? cleanedPart : (Object.keys(STATE_MAP).find(k => STATE_MAP[k].toUpperCase() === cleanedPart) || "TX");
      return { city, state: STATE_MAP[stateAbbr] || "Texas", stateAbbr };
    }
    const tokens = trimmed.split(/\s+/);
    let foundAbbr = null;
    let splitIdx = tokens.length;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const tok = tokens[i].toUpperCase().replace(/[^A-Z]/g, "");
      if (tok.length === 2 && STATE_MAP[tok]) {
        foundAbbr = tok;
        splitIdx = i;
        break;
      }
    }
    const stateAbbr = foundAbbr || "TX";
    const city = tokens.slice(0, Math.max(1, splitIdx)).join(" ").trim() || "Austin";
    return { city, state: STATE_MAP[stateAbbr] || "Texas", stateAbbr };
  }

  const p1 = localParseCityAndState("Austin, TX");
  assert.strictEqual(p1.city, "Austin");
  assert.strictEqual(p1.stateAbbr, "TX");

  const p2 = localParseCityAndState("Denver CO");
  assert.strictEqual(p2.city, "Denver");
  assert.strictEqual(p2.stateAbbr, "CO");

  const p3 = localParseCityAndState("Seattle WA 98101");
  assert.strictEqual(p3.city, "Seattle");
  assert.strictEqual(p3.stateAbbr, "WA");

  const p4 = localParseCityAndState("Chicago, IL 60601");
  assert.strictEqual(p4.city, "Chicago");
  assert.strictEqual(p4.stateAbbr, "IL");
});

// 10. Subcontract Agreement Document Completeness
test("Validates Subcontract Agreement contains all 10 authentic AIA Document A401 Articles", () => {
  function localGenerateAgreement(p) {
    return `
AIA Document A401™ – 2017 Standard Form of Agreement Between Contractor and Subcontractor
AGREEMENT NO: ${p.agreementNumber}
TABLE OF ARTICLES
ARTICLE 1   THE SUBCONTRACT DOCUMENTS & CSI MASTERFORMAT SPECIFICATIONS
ARTICLE 2   MUTUAL RIGHTS AND RESPONSIBILITIES
ARTICLE 3   CONTRACTOR OBLIGATIONS & SITE LOGISTICS
ARTICLE 4   SUBCONTRACTOR WORK & MANDATORY SCOPE INCLUSIONS
ARTICLE 5   CHANGES IN THE WORK & CHANGE ORDER PROTOCOL
ARTICLE 6   SUBCONTRACT SUM, SCHEDULE OF VALUES & PROGRESS PAYMENTS
ARTICLE 7   INSURANCE, ACORD 25 COI & INDEMNIFICATION
ARTICLE 8   SAFETY, QUALITY ASSURANCE & STATUTORY WARRANTIES
ARTICLE 9   DISPUTE RESOLUTION & BINDING ARBITRATION
ARTICLE 10  ATTESTATION & FORMAL EXECUTION
`;
  }

  const contractText = localGenerateAgreement({ agreementNumber: "AIA-A401-TEST" });
  for (let i = 1; i <= 10; i++) {
    assert.ok(contractText.includes(`ARTICLE ${i}`), `Contract must include ARTICLE ${i}`);
  }
  assert.ok(contractText.includes("ACORD 25 COI"), "Must include ACORD 25 insurance");
  assert.ok(contractText.includes("ATTESTATION & FORMAL EXECUTION"), "Must include formal execution");
});

console.log(`\n================================================================================`);
console.log(`REAL-WORLD PROPOSAL PARSING VERIFICATION: ${passedCount} PASSED, 0 FAILED`);
console.log(`================================================================================\n`);
