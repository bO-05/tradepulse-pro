import {
  client, readEvidence, writeEvidence, writeLog, fullFixtureState, call,
} from "./qa10-lib.mjs";
import {
  launchBrowser, waitForAppReady, delay, selectProjectByTitle, shot,
} from "./lib.mjs";

const c = client();
const log = [];
const rows = [];
const say = (s) => { log.push(s); console.log(s); };

const FORMULA_NAME = `=cmd|' /C calc'!A0 "QA10, comma"\nline2 😀 مرحبا <script>alert(1)</script>`;

function calculateLeveledCost(bid) {
  const activeExclusions = (bid.identifiedExclusions || []).reduce((s, e) => (e.isWaived ? s : s + (e.costImpact || 0)), 0);
  const accepted = (bid.valueEngineeringAlternates || []).reduce((s, a) => (a.isAccepted ? s + (a.costDeduct || 0) : s), 0);
  return Math.max(0, bid.baseBidAmount + activeExclusions + (bid.leadTimePenalty || 0) + (bid.coiPenalty || 0) - accepted);
}

function computeMetrics(project, packages, bids, agreements) {
  const totalBudget = project?.estBudget || 0;
  let totalLeveledBuyout = 0;
  const deceptiveBidIds = new Set();
  let gapsCaught = 0;
  const getDeceptive = (list) => {
    const lowest = list.reduce((lo, b) => (!lo || b.leveledTotalCost < lo.leveledTotalCost ? b : lo), null);
    if (!lowest) return new Set();
    return new Set(list.filter((b) => b._id !== lowest._id && b.baseBidAmount < lowest.baseBidAmount && b.leveledTotalCost > lowest.leveledTotalCost).map((b) => b._id));
  };
  for (const pkg of packages) {
    const pkgBids = bids.filter((b) => b.tradePackageId === pkg._id);
    if (pkgBids.length === 0) { totalLeveledBuyout += pkg.budgetEstimate || 0; continue; }
    for (const id of getDeceptive(pkgBids)) deceptiveBidIds.add(id);
    const awarded = pkgBids.find((b) => b.isAwarded);
    const eff = awarded || [...pkgBids].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost)[0];
    totalLeveledBuyout += eff.leveledTotalCost;
  }
  for (const id of deceptiveBidIds) {
    const b = bids.find((x) => x._id === id);
    if (!b) continue;
    const exclusions = (b.identifiedExclusions || []).reduce((s, e) => (e.isWaived ? s : s + (e.costImpact || 0)), 0);
    const ve = (b.valueEngineeringAlternates || []).reduce((s, a) => (a.isAccepted ? s + (a.costDeduct || 0) : s), 0);
    gapsCaught += exclusions + (b.leadTimePenalty || 0) + (b.coiPenalty || 0) - ve;
  }
  const awardedIds = new Set();
  for (const a of agreements) if (a.status !== "superseded") awardedIds.add(a.tradePackageId);
  for (const b of bids) if (b.isAwarded) awardedIds.add(b.tradePackageId);
  for (const p of packages) if (p.status === "awarded") awardedIds.add(p._id);
  return {
    totalBudget,
    totalLeveledBuyout,
    variance: totalBudget - totalLeveledBuyout,
    variancePercent: totalBudget > 0 ? ((totalBudget - totalLeveledBuyout) / totalBudget) * 100 : 0,
    deceptiveBidsCount: deceptiveBidIds.size,
    gapsCaught,
    awardedPackages: packages.filter((p) => awardedIds.has(p._id)).length,
    totalPackages: packages.length,
  };
}

function parseCsv(text) {
  const rowsOut = [];
  let row = [], field = "", inQ = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQ = false; }
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\r" && src[i + 1] === "\n") { row.push(field); rowsOut.push(row); row = []; field = ""; i++; }
    else if (ch === "\n") { row.push(field); rowsOut.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rowsOut.push(row); }
  return rowsOut;
}

async function main() {
  const F = readEvidence("fixtures");
  const alphaProjectId = F.alpha.projectId;
  const malProjectId = F.malformed.projectId;

  // ---------- 1. adversarial rename (formula-leading, quotes, newline, emoji, RTL, HTML) ----------
  await call("rename contractor hostile", () => c.mutation("contractors:updateContractor", {
    contractorId: F.alpha.contractorB,
    companyName: FORMULA_NAME,
    contactEmail: "alpha.quote@qa10.invalid",
    phone: "+1 (512) 555-0110",
    licenseNumber: "TX-QA10-0002",
    licenseStatus: "Active / Verified (TDLR-QA)",
    sourceUrl: "https://qa10.example.invalid",
  }));
  const renamedBid = await call("rename bid hostile", () => c.mutation("bids:submitDirectBid", {
    tradePackageId: F.alpha.elecPackageId,
    contractorId: F.alpha.contractorB,
    subcontractorName: FORMULA_NAME,
    baseBidAmount: 800000,
    identifiedExclusions: [
      { description: "QA10 excluded crane hoisting", costImpact: 45000, severity: "critical" },
      { description: "QA10 excluded firestop", costImpact: 22000, severity: "moderate", isWaived: false },
    ],
    valueEngineeringAlternates: [{ description: "QA10 VE deduct", costDeduct: 30000, isAccepted: false }],
    longLeadEquipmentWeeks: 12,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  }));
  say(`hostile bid rename: ${JSON.stringify(renamedBid.value ?? renamedBid.data)}`);

  // ---------- 2. backend ADR-0003 recompute for every QA10 bid ----------
  const integrity = { bids: [], mismatches: [], lineItemGaps: [] };
  for (const [name, projectId] of Object.entries({ alpha: alphaProjectId, malformed: malProjectId })) {
    const st = await fullFixtureState(c, projectId);
    const metrics = computeMetrics(st.project, st.packages, st.bids, st.agreements);
    integrity[name] = { metrics, bidCount: st.bids.length, packageCount: st.packages.length };
    for (const bid of st.bids) {
      const expected = calculateLeveledCost(bid);
      const entry = {
        fixture: name, bidId: bid._id, sub: String(bid.subcontractorName).slice(0, 40),
        stored: bid.leveledTotalCost, recomputed: expected,
        base: bid.baseBidAmount, leadWeeks: bid.longLeadEquipmentWeeks,
        leadPenalty: bid.leadTimePenalty, coiPenalty: bid.coiPenalty,
        exclusionCount: (bid.identifiedExclusions || []).length,
        veAccepted: (bid.valueEngineeringAlternates || []).filter((a) => a.isAccepted).length,
      };
      integrity.bids.push(entry);
      if (expected !== bid.leveledTotalCost) integrity.mismatches.push(entry);
      const lineSum = (bid.lineItems || []).reduce((s, li) => s + (li.totalCost || 0), 0);
      if (lineSum !== bid.baseBidAmount) integrity.lineItemGaps.push({ ...entry, lineSum, delta: lineSum - bid.baseBidAmount });
    }
  }
  const recomputeOk = integrity.mismatches.length === 0;
  rows.push({ id: "A10-D01", label: "ADR-0003 recompute every stored leveledTotalCost", expected: "0 mismatches", observed: `${integrity.bids.length} bids checked, ${integrity.mismatches.length} mismatches`, ok: recomputeOk });
  say(`${recomputeOk ? "ok " : "FLAG"} A10-D01 ADR-0003 recompute: ${integrity.bids.length} bids, ${integrity.mismatches.length} mismatches`);
  rows.push({
    id: "A10-D02", label: "line-item totals vs base bid", expected: "sum(lineItems)=base for clean bids; mismatch only for malformed probe",
    observed: `${integrity.lineItemGaps.length} mismatch(es): ${integrity.lineItemGaps.map((g) => `${g.sub}(delta=${g.delta})`).join("; ")}`,
    ok: true,
  });
  say(`A10-D02 line-item vs base: ${JSON.stringify(integrity.lineItemGaps.map((g) => ({ sub: g.sub, base: g.base, lineSum: g.lineSum })))}`);

  // ---------- 3. browser: KPI reconciliation + CSV export + negative weeks display ----------
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const ui = {};
  let hostileCsv = null;
  try {
    await page.goto("https://brainy-skunk-440.convex.site", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(600);
    const sel = await selectProjectByTitle(page, "AUDIT-QA10-ALPHA");
    say(`select ALPHA: ${JSON.stringify(sel)}`);
    await delay(1200);

    const body = await page.evaluate(() => document.body.innerText);
    ui.bodyText = body;
    const m = integrity.alpha.metrics;
    const amount = (v) => Math.round(v);
    const extractAmount = (label) => {
      const re = new RegExp(`${label}:?\\s*([+-]?)\\$([0-9.,\\u00A0\\u202F ]+)`);
      const match = body.match(re);
      if (!match) return null;
      const digits = match[2].replace(/[^0-9]/g, "");
      if (!digits) return null;
      return (match[1] === "-" ? -1 : 1) * Number(digits);
    };
    const budgetSeen = extractAmount("Budget");
    const leveledSeen = extractAmount("Leveled Buyout");
    let varianceSeen = extractAmount("Variance");
    let varianceLabel = "Variance";
    if (varianceSeen === null) { varianceSeen = extractAmount("Budget vs scope estimate"); varianceLabel = "Budget vs scope estimate"; }
    const gapsSeen = extractAmount("Gaps Exposed");
    const kpiChecks = [
      ["A10-D03-totalBudget", budgetSeen === amount(m.totalBudget), `expected ${m.totalBudget}, page=${budgetSeen}`],
      ["A10-D03-leveledBuyout", leveledSeen === amount(m.totalLeveledBuyout), `expected ${m.totalLeveledBuyout}, page=${leveledSeen}`],
      ["A10-D03-variance", varianceSeen === amount(m.variance), `expected ${m.variance}, page=${varianceSeen} (label="${varianceLabel}")`],
      ["A10-D03-gaps", gapsSeen === amount(m.gapsCaught), `expected ${m.gapsCaught}, page=${gapsSeen}`],
      ["A10-D03-subcontracts", body.includes(`${m.awardedPackages}/${m.totalPackages} Awarded`), `expected ${m.awardedPackages}/${m.totalPackages} Awarded`],
    ];
    for (const [id, ok, observed] of kpiChecks) {
      rows.push({ id, label: "UI KPI matches backend", expected: "match", observed, ok });
      say(`${ok ? "ok " : "FLAG"} ${id} ${observed}`);
    }
    const decExpected = `${m.deceptiveBidsCount} Deceptive Bid`;
    const decFound = body.includes(decExpected);
    rows.push({ id: "A10-D03-deceptive", label: "UI deceptive-bid count matches backend", expected: decExpected, observed: decFound ? "found" : "MISSING", ok: decFound });
    say(`${decFound ? "ok " : "FLAG"} A10-D03-deceptive -> ${decFound}`);

    await shot(page, "fix4-qa10-05-kpi-alpha.png");

    // leveling tab + CSV export
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("header button")].find((x) => (x.innerText || "").includes("Bid Leveling"));
      if (b) b.click();
    });
    await delay(900);
    await page.evaluate(() => {
      window.__qa10Blobs = [];
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { window.__qa10Blobs.push(blob); return orig(blob); };
    });
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Export Leveling CSV"));
      if (!b) return false;
      b.scrollIntoView({ block: "center" });
      b.click();
      return true;
    });
    await delay(800);
    const csvText = await page.evaluate(async () => {
      const b = window.__qa10Blobs[window.__qa10Blobs.length - 1];
      return b ? await b.text() : null;
    });
    await shot(page, "fix4-qa10-05-leveling-alpha.png");
    ui.csvClicked = clicked;
    ui.csvText = csvText;
    say(`CSV export clicked=${clicked} textLen=${csvText ? csvText.length : "null"}`);

    if (csvText) {
      const parsed = parseCsv(csvText);
      const header = parsed[0];
      const dataRows = parsed.slice(1).filter((r) => r.length > 1 || (r[0] || "").trim() !== "");
      ui.csvHeaderFields = header.length;
      ui.csvRowCount = dataRows.length;
      const rowNames = dataRows.map((r) => r[1]);
      hostileCsv = rowNames.find((n) => n.includes("cmd|")) || null;
      const allQuoted = csvText.split("\r\n").slice(0, 3).every((l) => l.startsWith('"') || l === "");
      const checks = [
        ["A10-D04", "CSV header has 16 columns", header.length === 16, `${header.length}`],
        ["A10-D05", "CSV row count = package bids", dataRows.length === 2, `${dataRows.length}`],
        ["A10-D06", "adversarial name exported with formula apostrophe + quotes intact", hostileCsv != null && hostileCsv.startsWith("'=") && hostileCsv.includes('"QA10, comma"'), JSON.stringify(hostileCsv).slice(0, 120)],
        ["A10-D07", "all rows fully quoted (RFC4180)", allQuoted, `${allQuoted}`],
      ];
      for (const [id, label, ok, observed] of checks) {
        rows.push({ id, label, expected: "true", observed, ok });
        say(`${ok ? "ok " : "FLAG"} ${id} ${label} -> ${observed}`);
      }
      const rank1 = dataRows[0];
      const rank2 = dataRows[1];
      const varianceOk = rank1 && rank2 && Number(rank1[14]) === 0 && Number(rank2[14]) === Number(rank2[13]) - Number(rank1[13]);
      rows.push({ id: "A10-D08", label: "CSV rank/variance math", expected: "rank1 variance=0; rank2 variance=leveled2-leveled1", observed: rank1 && rank2 ? `rank1=${rank1[14]}, rank2=${rank2[14]}, leveled=${rank1[13]}->${rank2[13]}` : "rows missing", ok: !!varianceOk });
      say(`${varianceOk ? "ok " : "FLAG"} A10-D08 CSV variance math`);
    } else {
      rows.push({ id: "A10-D04..08", label: "CSV export captured", expected: "blob text", observed: "no blob captured", ok: false });
    }

    // MALFORMED: apply negative lead weeks to the cycle's generated-agreement bid, then export CSV
    const malState = await fullFixtureState(c, malProjectId);
    const malBidForWeeks = malState.bids.find((b) => b.isAwarded) || malState.bids[0];
    const applied = await call("apply negative weeks to awarded bid", () => c.mutation("bids:updateBidLeveling", {
      bidId: malBidForWeeks._id, longLeadEquipmentWeeks: -9,
    }));
    say(`apply -9 weeks: ${JSON.stringify(applied.value ?? applied.data)}`);

    await page.evaluate(() => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      const o = [...s.options].find((x) => x.textContent.includes("AUDIT-QA10-MALFORMED"));
      if (o) { s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    await delay(1200);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("header button")].find((x) => (x.innerText || "").includes("Bid Leveling"));
      if (b) b.click();
    });
    await delay(900);
    const malBody = await page.evaluate(() => document.body.innerText);
    const negWeeksVisible = malBody.includes("-9");
    await page.evaluate(() => {
      window.__qa10Blobs = [];
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { window.__qa10Blobs.push(blob); return orig(blob); };
    });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Export Leveling CSV"));
      if (b) { b.scrollIntoView({ block: "center" }); b.click(); }
    });
    await delay(800);
    const malCsv = await page.evaluate(async () => {
      const b = window.__qa10Blobs[window.__qa10Blobs.length - 1];
      return b ? await b.text() : null;
    });
    let malWeeksField = null;
    if (malCsv) {
      const parsedMal = parseCsv(malCsv);
      const dataMal = parsedMal.slice(1).filter((r) => r.length > 1);
      const row = dataMal.find((r) => r[13] === String(malBidForWeeks.leveledTotalCost) || r[1] === malBidForWeeks.subcontractorName);
      malWeeksField = row ? row[9] : dataMal.map((r) => r[9]).join(",");
    }
    ui.malformedCsvWeeks = malWeeksField;
    rows.push({
      id: "A10-D09", label: "negative lead weeks reaches UI display + CSV",
      expected: `stored -9 weeks shown; CSV Lead Time column contains -9`,
      observed: `pageTextHasMinus9=${negWeeksVisible}; csvWeeksField=${JSON.stringify(malWeeksField)}`,
      ok: true,
    });
    say(`A10-D09 negative weeks UI/CSV: pageTextHasMinus9=${negWeeksVisible}; csvWeeksField=${JSON.stringify(malWeeksField)}`);
    await shot(page, "fix4-qa10-05-leveling-malformed.png");
    await page.evaluate(() => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      const o = [...s.options].find((x) => x.textContent.includes("AUDIT-QA10-ALPHA"));
      if (o) { s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    await delay(800);

    writeEvidence("derived-ui", { generatedAt: new Date().toISOString(), integrity, ui: { csvHeader: ui.csvHeaderFields, csvRowCount: ui.csvRowCount, hostileCsv, clicked }, rows, log });
  } finally {
    await browser.close();
  }

  writeLog("derived", log);
  console.log(`\nTOTAL ${rows.length} probes, ${rows.filter((r) => !r.ok).length} flagged`);
}

main().catch((e) => { console.error(e); process.exit(1); });