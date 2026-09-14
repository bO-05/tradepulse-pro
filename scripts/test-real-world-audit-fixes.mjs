// Copy exact implementation from convex/llmRouter.ts
export function cleanNumber(val, fallback = 0) {
  if (typeof val === "number") {
    return Number.isFinite(val) ? val : fallback;
  }
  if (!val) return fallback;
  if (typeof val !== "string") return fallback;

  let trimmed = val.trim();
  const isNegative =
    (trimmed.startsWith("(") && trimmed.endsWith(")")) ||
    trimmed.startsWith("-") ||
    trimmed.endsWith("-");

  trimmed = trimmed.replace(/^\(+|\)+$/g, "").replace(/^[-+]|[-+]$/g, "").trim();

  trimmed = trimmed
    .replace(/^([$€£¥]|USD|CAD|EUR|GBP|AUD)\s*/i, "")
    .replace(/\s*(USD|CAD|EUR|GBP|AUD)$/i, "")
    .trim();

  const multMatch = trimmed.match(/^([0-9\s.,]+)\s*([kKmMbB])$/);
  if (multMatch) {
    let numPart = multMatch[1].trim().replace(/\s+/g, "");
    const unit = multMatch[2].toUpperCase();
    if (numPart.includes(",") && !numPart.includes(".")) {
      numPart = numPart.replace(",", ".");
    } else {
      numPart = numPart.replace(/,/g, "");
    }
    const base = parseFloat(numPart);
    if (Number.isFinite(base)) {
      const multiplier = unit === "K" ? 1e3 : unit === "M" ? 1e6 : 1e9;
      const res = Math.round(base * multiplier);
      return isNegative ? -res : res;
    }
    return fallback;
  }

  const cleanChars = trimmed.replace(/[^0-9.,\s]/g, "").trim();
  if (!cleanChars) return fallback;

  const dotCount = (cleanChars.match(/\./g) || []).length;
  const commaCount = (cleanChars.match(/,/g) || []).length;
  const spaceCount = (cleanChars.match(/\s/g) || []).length;

  let normalized = cleanChars;

  if (spaceCount > 0) {
    if (commaCount === 1 && dotCount === 0) {
      normalized = cleanChars.replace(/\s+/g, "").replace(",", ".");
    } else if (dotCount === 1 && commaCount === 0) {
      normalized = cleanChars.replace(/\s+/g, "");
    } else {
      normalized = cleanChars.replace(/\s+/g, "");
    }
  } else if (dotCount > 1 && commaCount <= 1) {
    normalized = cleanChars.replace(/\./g, "").replace(",", ".");
  } else if (commaCount > 1 && dotCount <= 1) {
    normalized = cleanChars.replace(/,/g, "");
  } else if (dotCount === 1 && commaCount === 1) {
    const dotIdx = cleanChars.indexOf(".");
    const commaIdx = cleanChars.indexOf(",");
    if (dotIdx < commaIdx) {
      normalized = cleanChars.replace(".", "").replace(",", ".");
    } else {
      normalized = cleanChars.replace(",", "");
    }
  } else if (commaCount === 1 && dotCount === 0) {
    const parts = cleanChars.split(",");
    if (parts[1] && parts[1].length === 2) {
      normalized = cleanChars.replace(",", ".");
    } else if (parts[1] && parts[1].length === 3 && parts[0].length <= 3) {
      normalized = cleanChars.replace(",", "");
    } else {
      normalized = cleanChars.replace(",", ".");
    }
  } else if (dotCount === 1 && commaCount === 0) {
    const parts = cleanChars.split(".");
    if (parts[1] && parts[1].length === 3 && parts[0].length <= 3) {
      normalized = cleanChars.replace(".", "");
    } else {
      normalized = cleanChars;
    }
  }

  const parsed = parseFloat(normalized);
  if (!Number.isFinite(parsed)) return fallback;
  return isNegative ? -parsed : parsed;
}

export function sanitizeBidLevelingOutput(parsedJson) {
  if (!parsedJson || typeof parsedJson !== "object") return parsedJson;
  const rawBase =
    parsedJson.baseBidAmount ??
    parsedJson.baseBid ??
    parsedJson.bidAmount ??
    parsedJson.lumpSum ??
    parsedJson.totalAmount ??
    parsedJson.basePrice;
  let baseBidAmount = cleanNumber(rawBase, 0);
  const leadWeeks = cleanNumber(parsedJson.longLeadEquipmentWeeks ?? parsedJson.leadWeeks, 12);
  const leadPenalty = cleanNumber(parsedJson.leadTimePenalty, 0);
  const coiPenalty = cleanNumber(parsedJson.coiPenalty, 0);

  const lineItems = Array.isArray(parsedJson.lineItems)
    ? parsedJson.lineItems.map((li) => ({
        item: String(li?.item || li?.description || "Base Scope Line Item"),
        unit: String(li?.unit || "LS"),
        quantity: cleanNumber(li?.quantity, 1),
        unitCost: cleanNumber(li?.unitCost, cleanNumber(li?.totalCost, 0)),
        totalCost: cleanNumber(li?.totalCost, cleanNumber(li?.unitCost, 0)),
      }))
    : baseBidAmount > 0
    ? [
        {
          item: "Base Commercial Scope",
          unit: "LS",
          quantity: 1,
          unitCost: baseBidAmount,
          totalCost: baseBidAmount,
        },
      ]
    : [];

  if (baseBidAmount === 0 && lineItems.length > 0) {
    baseBidAmount = lineItems.reduce((sum, li) => sum + li.totalCost, 0);
  }

  const rawExclusions = Array.isArray(parsedJson.identifiedExclusions)
    ? parsedJson.identifiedExclusions
    : Array.isArray(parsedJson.exclusions)
    ? parsedJson.exclusions
    : Array.isArray(parsedJson.scopeGaps)
    ? parsedJson.scopeGaps
    : [];

  const identifiedExclusions = rawExclusions.map((ex) => ({
    canonicalCode: ex?.canonicalCode ? String(ex.canonicalCode) : undefined,
    description: String(ex?.description || ex?.scopeItem || ex?.item || "Scope gap exclusion"),
    costImpact: cleanNumber(ex?.costImpact ?? ex?.cost ?? ex?.amount ?? ex?.impact, 0),
    severity: String(ex?.severity || "moderate"),
    isWaived: Boolean(ex?.isWaived),
  }));

  const rawVe = Array.isArray(parsedJson.valueEngineeringAlternates)
    ? parsedJson.valueEngineeringAlternates
    : Array.isArray(parsedJson.valueEngineering)
    ? parsedJson.valueEngineering
    : Array.isArray(parsedJson.alternates)
    ? parsedJson.alternates
    : Array.isArray(parsedJson.veAlternates)
    ? parsedJson.veAlternates
    : [];

  const valueEngineeringAlternates = rawVe.map((ve) => ({
    description: String(ve?.description || ve?.title || ve?.item || "Value Engineering alternate"),
    costDeduct: cleanNumber(ve?.costDeduct ?? ve?.savings ?? ve?.amount ?? ve?.cost ?? ve?.deduct, 0),
    isAccepted: Boolean(ve?.isAccepted),
  }));

  const activeExclusionsTotal = identifiedExclusions.reduce(
    (s, x) => (x.isWaived ? s : s + x.costImpact),
    0
  );
  const acceptedVeTotal = valueEngineeringAlternates.reduce(
    (s, x) => (x.isAccepted ? s + x.costDeduct : s),
    0
  );

  const computedLeveled = Math.max(
    0,
    baseBidAmount + activeExclusionsTotal + leadPenalty + coiPenalty - acceptedVeTotal
  );
  const leveledTotalCost = computedLeveled;

  return {
    ...parsedJson,
    subcontractorName: String(parsedJson.subcontractorName || "Commercial Subcontractor"),
    baseBidAmount,
    lineItems,
    identifiedExclusions,
    valueEngineeringAlternates,
    longLeadEquipmentWeeks: leadWeeks,
    leadTimePenalty: leadPenalty,
    coiComplianceStatus: String(parsedJson.coiComplianceStatus || "compliant"),
    coiPenalty,
    leveledTotalCost,
  };
}

console.log("================================================================================");
console.log("    TRADEPULSE PRO — REAL-WORLD AUDIT FIXES COMPREHENSIVE VERIFICATION          ");
console.log("================================================================================");

let passed = 0;
let failed = 0;

function assert(condition, name, details = "") {
  if (condition) {
    console.log(`✓ PASS: ${name}`);
    passed++;
  } else {
    console.error(`✗ FAIL: ${name} — ${details}`);
    failed++;
  }
}

// 1. cleanNumber International & Currency parsing
console.log("\n[1] Verifying cleanNumber International & Currency Edge Cases...");
assert(cleanNumber("$1,250,000.00") === 1250000, "US Dollar standard formatted");
assert(cleanNumber("1.250.000,00") === 1250000, "European dot-thousands comma-decimals formatted");
assert(cleanNumber("1.250.000") === 1250000, "European dot-thousands without decimals");
assert(cleanNumber("1 250 000,50") === 1250000.5, "French/Canadian space-thousands comma-decimals");
assert(cleanNumber("€850,000") === 850000, "Euro currency symbol");
assert(cleanNumber("CAD $1,400,000") === 1400000, "CAD prefix currency");
assert(cleanNumber("£750,000.00") === 750000, "British Pound currency");
assert(cleanNumber("$1.25M") === 1250000, "Million suffix M");
assert(cleanNumber("450k") === 450000, "Thousand suffix k");
assert(cleanNumber("($45,000.00)") === -45000, "Accounting parentheses negative");
assert(cleanNumber("45,000-") === -45000, "Trailing dash negative");

// 2. sanitizeBidLevelingOutput Robustness & Key Mapping
console.log("\n[2] Verifying sanitizeBidLevelingOutput Flexible Key Mapping...");
const altKeyOutput = sanitizeBidLevelingOutput({
  baseBid: "1.250.000,00",
  exclusions: [
    { item: "Duct smoke detectors by others", cost: "25000", severity: "high" }
  ],
  alternates: [
    { title: "Value engineer fixtures", savings: "15000", isAccepted: true }
  ],
  leadWeeks: 14,
  leadTimePenalty: "12000",
  coiPenalty: "0",
});
assert(altKeyOutput.baseBidAmount === 1250000, "Mapped baseBid to baseBidAmount with European currency parsing");
assert(altKeyOutput.identifiedExclusions.length === 1, "Mapped exclusions to identifiedExclusions");
assert(altKeyOutput.identifiedExclusions[0].costImpact === 25000, "Mapped cost to costImpact");
assert(altKeyOutput.valueEngineeringAlternates.length === 1, "Mapped alternates to valueEngineeringAlternates");
assert(altKeyOutput.valueEngineeringAlternates[0].costDeduct === 15000, "Mapped savings to costDeduct");
assert(altKeyOutput.leveledTotalCost === 1250000 + 25000 + 12000 - 15000, "ADR-0003 leveled total calculated accurately");

// 3. Zero-Exclusions Clean Proposal Handling (No Fake Penalties)
console.log("\n[3] Verifying Zero-Exclusions Clean Proposal Ingestion...");
const cleanProposalData = sanitizeBidLevelingOutput({
  baseBidAmount: 1100000,
  identifiedExclusions: [],
  valueEngineeringAlternates: [],
  longLeadEquipmentWeeks: 10,
  leadTimePenalty: 0,
  coiComplianceStatus: "compliant",
  coiPenalty: 0,
});
assert(cleanProposalData.identifiedExclusions.length === 0, "Clean proposal preserves 0 exclusions without fake injections");
assert(cleanProposalData.coiPenalty === 0, "Compliant insurance incurs $0 COI penalty");
assert(cleanProposalData.leveledTotalCost === 1100000, "Clean proposal leveled cost equals base bid ($1,100,000)");

// 4. Non-Negative Leveled Cost Floor (Math.max(0, ...))
console.log("\n[4] Verifying Non-Negative Leveled Cost Floor...");
const excessVeProposal = sanitizeBidLevelingOutput({
  baseBidAmount: 10000,
  identifiedExclusions: [],
  valueEngineeringAlternates: [
    { description: "Massive buyout credit", costDeduct: 50000, isAccepted: true }
  ],
  leadTimePenalty: 0,
  coiPenalty: 0,
});
assert(excessVeProposal.leveledTotalCost === 0, "Excess VE deducts floored at $0, never negative");

// 5. Contractor Company Name Sanitization (SERP Headlines vs Business Names)
console.log("\n[5] Verifying Contractor Company Name Sanitization...");
function sanitizeContractorCompanyName(rawTitle, fallbackName) {
  if (!rawTitle) return fallbackName;
  const title = rawTitle.replace(/[-|:–—].*$/, "").trim();
  const spammyPrefixes = [
    /^how to\b/i,
    /^(?:the\s+)?(?:top|best|\d+\s+best|\d+\s+top)\b/i,
    /^find\b/i,
    /^compare\b/i,
    /^why hire\b/i,
    /^commercial contractors? in\b/i,
    /^list of\b/i,
    /^directory of\b/i,
  ];
  if (spammyPrefixes.some((rx) => rx.test(title)) || title.length > 50 || title.length < 3) {
    return fallbackName;
  }
  return title;
}

const fallback = "Denver Commercial Concrete Services 1";
assert(
  sanitizeContractorCompanyName("How to hire a commercial concrete contractor in Denver, CO - Angi", fallback) === fallback,
  "Spammy 'How to hire...' headline replaced with fallback"
);
assert(
  sanitizeContractorCompanyName("Top 10 Best Electrical Contractors in Austin, TX | Yelp", fallback) === fallback,
  "Spammy 'Top 10 Best...' headline replaced with fallback"
);
assert(
  sanitizeContractorCompanyName("10 Best HVAC Companies in 2026 - Forbes", fallback) === fallback,
  "Spammy '10 Best...' headline replaced with fallback"
);
assert(
  sanitizeContractorCompanyName("Apex Commercial Concrete & Pumping Inc. - Denver, CO", fallback) === "Apex Commercial Concrete & Pumping Inc.",
  "Genuine contractor business name preserved cleanly"
);
assert(
  sanitizeContractorCompanyName("O'Connor & Sons Electrical Contractors - Boston, MA", fallback) === "O'Connor & Sons Electrical Contractors",
  "Apostrophe business name preserved cleanly"
);

// 6. PDF Stream Text Token Extraction Character Range
console.log("\n[6] Verifying PDF Stream Token Extraction Character Range...");
const samplePdfStream = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
BT
(O'Connor & Sons Electrical #10 AWG [Branch Feeder]) Tj
ET
Base bid quote $1,250,000 for project specification [Section 26 05 00]
`;

const literalMatches = Array.from(samplePdfStream.matchAll(/\(([^)]{2,})\)\s*(?:Tj|TJ)/g)).map((m) => m[1]);
assert(literalMatches.length === 1, "Extracted parenthesized literal PDF text block");
assert(literalMatches[0] === "O'Connor & Sons Electrical #10 AWG [Branch Feeder]", "Extracted full literal text with apostrophe, ampersand, hash, brackets");

const segments = samplePdfStream.match(/[A-Za-z0-9\s.,;:$%/\\()\-–—@&+=#'"_[\]*!?]{4,}/g) || [];
const cleanText = segments
  .filter((s) => !s.startsWith("obj") && !s.startsWith("endobj") && !s.includes("/Font") && !s.includes("/Type") && !s.includes("/Filter") && !s.includes("/FlateDecode") && !s.includes("/Length"))
  .join(" ");
assert(cleanText.includes("O'Connor"), "Apostrophe retained in token filtering");
assert(cleanText.includes("[Section 26 05 00]"), "Brackets retained in token filtering");
assert(cleanText.includes("#10 AWG"), "Hash retained in token filtering");

console.log("\n================================================================================");
console.log(`REAL-WORLD AUDIT VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log("================================================================================");

if (failed > 0) {
  process.exit(1);
}
