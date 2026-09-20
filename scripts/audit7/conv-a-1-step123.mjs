/**
 * AUDIT7 CONV-A round 1 — Steps 1-3:
 * 1) BYO project + Div 22 package + contractor + quote with NON-ROUND numbers via the UI.
 * 2) Verify persisted exclusions/lead/COI/VE/leveled against stated amounts + capture card arithmetic.
 * 3) Re-ingest the IDENTICAL quote text and verify persisted numbers are byte-identical.
 * Fixtures: AUDIT7-CONV-A-<date>. No file under convex/ or src/ is modified; UI-driven only.
 */
import fs from "node:fs";
import path from "node:path";
import {
  delay, openApp, q, call, clickTab, selectProject, clickText, makeFixtureProject, makePackage,
  addContractor, ingestQuote, poll, writeEvidence, deleteProject, PREFIX, DAILY, BASE,
} from "./lib.mjs";

const TITLE = `${PREFIX}CONV-A-${DAILY}`;
const GC = "AUDIT7 CONV-A Cascade Ridge Builders JV";
const BUDGET = 4250000;
const PKG_CSI = "22 00 00";
const PKG_NAME = "AUDIT7-CONV-A Div 22 Plumbing & Booster Systems";
const PKG_BUDGET = 1250000;
const CTR1 = "Cascade Mechanical Contractors LLC";
const CTR1_EMAIL = "estimating@cascade-mech.example";
const CTR1_LIC = "OR-CCB-221907";
const CTR2 = "QuickFlow Plumbing LLC";
const CTR2_EMAIL = "bids@quickflow-plumbing.example";
const CTR2_LIC = "OR-CCB-118342";

const QUOTE_A = [
  "PROPOSAL AND QUOTATION",
  `Subcontractor: ${CTR1}`,
  `Project: ${TITLE}`,
  "Base Bid Price: $613,777.13",
  "Scope: complete Division 22 plumbing scope including domestic water, sanitary waste, vent piping, and the triplex booster pump system.",
  "Exclusions: crane rigging and hoisting excluded ($18,600); UL firestopping penetrations excluded ($9,950); seismic bracing and snubbers excluded ($7,400).",
  "Schedule: equipment procurement lead time is 17 weeks from notice to proceed; the project target is 12 weeks.",
  "Insurance: umbrella liability endorsement excluded.",
  "Value Engineering: LED lighting alternate credit of $35,000 offered (GC to decide).",
].join("\n");

const EXPECT = {
  base: 613777.13,
  exclusions: [18600, 9950, 7400],
  exclusionsSum: 35950,
  leadWeeks: 17,
  leadTarget: 16,
  leadPenalty: 6000,
  coiPenalty: 15000,
  veDeduct: 35000,
  veAccepted: false,
  leveled: 613777.13 + 35950 + 6000 + 15000,
};

const out = {
  startedAt: new Date().toISOString(),
  title: TITLE,
  quoteA: QUOTE_A,
  expected: EXPECT,
  preClean: [],
  assertions: {},
  bidA: null,
  bidARev2: null,
  cardText: null,
  tableText: null,
};

const evidenceDir = path.join(process.cwd(), "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });

function projection(b) {
  if (!b) return null;
  const exclusions = (b.identifiedExclusions || []).map((e) => ({
    code: e.canonicalCode ?? null,
    desc: e.description,
    cost: e.costImpact,
    waived: Boolean(e.isWaived),
  }));
  const ve = (b.valueEngineeringAlternates || []).map((v) => ({
    desc: v.description,
    deduct: v.costDeduct,
    accepted: Boolean(v.isAccepted),
  }));
  return {
    subcontractorName: b.subcontractorName,
    baseBidAmount: b.baseBidAmount,
    exclusionCosts: exclusions.map((e) => e.cost),
    exclusionsSum: exclusions.reduce((s, e) => s + (e.waived ? 0 : e.cost), 0),
    exclusions,
    longLeadEquipmentWeeks: b.longLeadEquipmentWeeks,
    leadTimeTargetWeeks: b.leadTimeTargetWeeks ?? null,
    leadTimePenalty: b.leadTimePenalty,
    coiComplianceStatus: b.coiComplianceStatus,
    coiPenalty: b.coiPenalty,
    ve,
    veDeducts: ve.map((v) => v.deduct),
    acceptedVeDeduct: ve.reduce((s, v) => s + (v.accepted ? v.deduct : 0), 0),
    leveledTotalCost: b.leveledTotalCost,
    revisionNumber: b.revisionNumber ?? 1,
  };
}

/** Numeric-only projection for the determinism contract. */
function numericProjection(p) {
  return {
    baseBidAmount: p.baseBidAmount,
    exclusionCosts: p.exclusionCosts,
    exclusionsSum: p.exclusionsSum,
    longLeadEquipmentWeeks: p.longLeadEquipmentWeeks,
    leadTimeTargetWeeks: p.leadTimeTargetWeeks,
    leadTimePenalty: p.leadTimePenalty,
    coiPenalty: p.coiPenalty,
    veDeducts: p.veDeducts,
    veAcceptedFlags: p.ve.map((v) => v.accepted),
    acceptedVeDeduct: p.acceptedVeDeduct,
    leveledTotalCost: p.leveledTotalCost,
  };
}

async function cardTextFor(page, name) {
  return page.evaluate((needle) => {
    const els = [...document.querySelectorAll("div")].filter(
      (e) => e.innerText && e.innerText.includes(needle) && e.innerText.includes("True Leveled Cost")
    );
    if (!els.length) return null;
    els.sort((a, b) => a.innerText.length - b.innerText.length);
    return els[0].innerText.replace(/\n+/g, " | ");
  }, name);
}

// pre-clean every AUDIT7 fixture (mine and leftovers from earlier audit rounds)
for (const p of ((await q("projects:listProjects", {})) || []).filter((x) => x.title.startsWith(PREFIX))) {
  const ok = await deleteProject(p._id);
  out.preClean.push({ _id: p._id, title: p.title, deleted: ok });
}

const { browser, page } = await openApp(1440, 900);
try {
  // ---------- Step 1: project via UI ----------
  const proj = await makeFixtureProject(page, {
    title: TITLE,
    gc: GC,
    budget: BUDGET,
    weeks: 64,
    spec: "Division 22 plumbing and Division 23 HVAC scope for the AUDIT7 CONV-A adversarial probe.",
  });
  out.assertions.projectCreatedViaUi = Boolean(proj.proj);
  out.project = proj.proj
    ? { _id: proj.proj._id, title: proj.proj.title, gc: proj.proj.generalContractorName, budget: proj.proj.estBudget }
    : null;
  if (!proj.proj) throw new Error("CONV-A fixture not created via UI");
  await selectProject(page, proj.proj._id);
  await page.screenshot({ path: path.join(evidenceDir, "a7conv-a-project.png") });

  // public-demo banner (honesty surface #3)
  out.assertions.publicDemoBanner = await page.evaluate(() =>
    document.body.innerText.includes("Public shared demo — everything here is visible to anyone with this URL")
  );

  // ---------- Step 1b: Div 22 package via UI ----------
  await clickTab(page, "01:");
  await delay(800);
  await makePackage(page, PKG_CSI, PKG_NAME, PKG_BUDGET, "Division 22 plumbing scope: domestic water, sanitary waste, vent piping, booster pump skid.");
  const pkgs = await poll(
    () => q("tradePackages:listByProject", { projectId: proj.proj._id }),
    (x) => (x || []).some((p) => String(p.csiDivision).startsWith("22")),
    45000,
    1500
  );
  const pkg = (pkgs || []).find((p) => String(p.csiDivision).startsWith("22"));
  out.package = pkg ? { _id: pkg._id, csiDivision: pkg.csiDivision, tradeName: pkg.tradeName, budgetEstimate: pkg.budgetEstimate } : null;
  if (!pkg) throw new Error("Div 22 package not created via UI");

  // ---------- Step 1c: contractor #1 via UI ----------
  await addContractor(page, pkg.tradeName, CTR1, CTR1_EMAIL, CTR1_LIC);
  const ctrs = (await q("contractors:listByPackage", { tradePackageId: pkg._id })) || [];
  const ctr1 = ctrs.find((c) => c.companyName === CTR1);
  out.contractor1 = ctr1 ? { _id: ctr1._id, companyName: ctr1.companyName, contactEmail: ctr1.contactEmail, licenseNumber: ctr1.licenseNumber } : null;
  if (!ctr1) throw new Error("contractor 1 not added via UI");

  // ---------- Step 2: ingest quote A via UI ----------
  const ingest1 = await ingestQuote(page, ctr1._id, QUOTE_A);
  out.assertions.ingest1Submitted = ingest1.ok;
  let bidA = await poll(
    () => q("bids:listByPackage", { tradePackageId: pkg._id }).then((bs) => (bs || []).find((b) => b.contractorId === ctr1._id)),
    (b) => Boolean(b),
    180000,
    2500
  );
  await delay(1500);
  out.bidA = projection(bidA);
  out.cardText = await cardTextFor(page, CTR1);
  await page.screenshot({ path: path.join(evidenceDir, "a7conv-a-step2-ingested.png") });

  // spread table text
  const tableToggle = await clickText(page, "Spread Table View");
  out.assertions.tableToggle = tableToggle.ok;
  await delay(900);
  out.tableText = await page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText;
    const i = t.indexOf("Equipment Lead Time");
    return i === -1 ? null : t.slice(Math.max(0, i - 120), i + 700).replace(/\n+/g, " | ");
  });
  await page.screenshot({ path: path.join(evidenceDir, "a7conv-a-step2-table.png") });
  await clickText(page, "Card View");
  await delay(600);

  // assertion detail for step 2
  const p = out.bidA || {};
  out.assertions.step2 = {
    baseExact: p.baseBidAmount === EXPECT.base,
    exclusionCostsExactlyStated:
      JSON.stringify(p.exclusionCosts) === JSON.stringify(EXPECT.exclusions),
    exclusionSum: p.exclusionsSum,
    leadPenaltyExact: p.leadTimePenalty === EXPECT.leadPenalty,
    leadWeeksExact: p.longLeadEquipmentWeeks === EXPECT.leadWeeks,
    leadTargetExact: p.leadTimeTargetWeeks === EXPECT.leadTarget,
    coiPenaltyExact: p.coiPenalty === EXPECT.coiPenalty,
    coiStatus: p.coiComplianceStatus,
    veAcceptedFalse: (p.ve || []).every((v) => v.accepted === false),
    veDeductExact: (p.ve || []).some((v) => v.deduct === EXPECT.veDeduct),
    leveledExact: p.leveledTotalCost === EXPECT.leveled,
    cardShowsArithmetic: Boolean(
      out.cardText &&
        /17\s*wks vs 16-wk baseline/.test(out.cardText) &&
        /\(17\s*−\s*16\)\s*×\s*\$6,000\s*=\s*\+\$6,000/.test(out.cardText)
    ),
    cardShowsCoi: Boolean(out.cardText && /\+\$15,000 \(Deficient\)/.test(out.cardText)),
    cardShowsVeDeclined: Boolean(out.cardText && /\$35,000 \(declined\)/.test(out.cardText)),
    cardShowsLeveled: Boolean(out.cardText && out.cardText.includes(`$${EXPECT.leveled.toLocaleString("en-US")}`)),
  };

  // ---------- Step 3: re-ingest IDENTICAL quote text ----------
  const ingest2 = await ingestQuote(page, ctr1._id, QUOTE_A);
  out.assertions.ingest2Submitted = ingest2.ok;
  const bidA2 = await poll(
    () => q("bids:listByPackage", { tradePackageId: pkg._id }).then((bs) => (bs || []).find((b) => b.contractorId === ctr1._id)),
    (b) => Boolean(b) && (b.revisionNumber ?? 1) >= (out.bidA?.revisionNumber ?? 1) + 1,
    180000,
    2500
  );
  await delay(1200);
  out.bidARev2 = projection(bidA2);
  const n1 = numericProjection(out.bidA);
  const n2 = numericProjection(out.bidARev2);
  out.assertions.step3 = {
    revisionAdvanced: (out.bidARev2?.revisionNumber ?? 0) > (out.bidA?.revisionNumber ?? 0),
    numericByteIdentical: JSON.stringify(n1) === JSON.stringify(n2),
    rev1Numeric: n1,
    rev2Numeric: n2,
    descDidDiffer: JSON.stringify((out.bidA?.exclusions || []).map((e) => e.desc)) !== JSON.stringify((out.bidARev2?.exclusions || []).map((e) => e.desc)),
  };
} catch (err) {
  out.error = String(err?.stack ?? err);
  console.error(err);
} finally {
  await browser.close();
}
await writeEvidence("a7conv-a-step123.json", out);
console.log(JSON.stringify({ project: out.project, package: out.package, contractor1: out.contractor1, assertions: out.assertions, bidA: out.bidA, bidARev2: out.bidARev2, cardText: out.cardText, tableText: out.tableText }, null, 2));