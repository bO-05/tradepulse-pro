import fs from "node:fs";
import path from "node:path";
import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, writeLog, delay,
} from "./lib.mjs";
import {
  findButton, findField, findHandles, realClick, realClickText, typeInto, typeIntoField,
  selectProject, projectOptionState, clickTab, waitForText, waitForTextGone, dismissTour,
  openNewProjectModal, createFixtureName,
} from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const EV = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/evidence";
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const PROJECT_TITLE = createFixtureName("BIDS");
const PKG_NAME = "AUDIT-QA1 Electrical";
const R = { startedAt: new Date().toISOString(), projectTitle: PROJECT_TITLE };
const log = [];
const L = (m) => { log.push(`[${new Date().toISOString()}] ${m}`); console.log(m); };

const q = async (fn, tries = 6) => {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await delay(1500); }
  }
  throw last;
};
const bidsOf = async (pid) => await q(() => http.query("bids:listAllProjectBids", { projectId: pid }));
const pkgsOf = async (pid) => await q(() => http.query("tradePackages:listByProject", { projectId: pid }));
const agrsOf = async (pid) => await q(() => http.query("agreements:listAgreements", { projectId: pid }));

const normalize = (b) => ({
  id: b._id, sub: b.subcontractorName, base: b.baseBidAmount, leveled: b.leveledTotalCost,
  awarded: b.isAwarded, rev: b.revisionNumber ?? null, weeks: b.longLeadEquipmentWeeks,
  leadPenalty: b.leadTimePenalty, coiPenalty: b.coiPenalty, coi: b.coiComplianceStatus,
  excl: (b.identifiedExclusions || []).map((x) => ({ d: x.description, c: x.costImpact, w: !!x.isWaived })),
});

async function ingestQuote(page, { contractorName, selectExisting, quoteText, fileName }) {
  const out = { contractorName, selectExisting: selectExisting || null };
  const openBtn = await findButton(page, "Ingest Quote / PDF");
  if (!openBtn) return { ...out, ok: false, reason: "ingest button not found" };
  await realClick(page, openBtn);
  await waitForText(page, "Direct Quote / PDF Bid Ingestion", 10000);
  await delay(400);

  const selects = await findHandles(page, "select", (m) => m.visible && (m.value === "" || m.text.includes("Select Registered") || m.text.includes("Select")) , null);
  if (selectExisting) {
    let chosen = null;
    for (const s of selects) {
      for (const opt of s.meta.text.split("\n")) {
        if (opt.includes(selectExisting)) {
          const val = await s.handle.evaluate((el, name) => {
            const o = [...el.options].find((x) => x.textContent.includes(name));
            return o ? o.value : null;
          }, selectExisting);
          if (val) { await s.handle.select(val); chosen = val; }
        }
      }
    }
    out.selected = chosen;
    if (!chosen) return { ...out, ok: false, reason: "existing contractor option not found" };
  } else {
    const newOpt = selects.length ? await selects[0].handle.evaluate((el) => {
      const o = [...el.options].find((x) => x.value === "new_contractor");
      return o ? "new_contractor" : null;
    }) : null;
    if (newOpt) { await selects[0].handle.select("new_contractor"); await delay(300); }
    else if (selects.length === 0) { out.noSelect = true; }
    if (contractorName) {
      const nameField = await findField(page, "Enter Subcontractor Company Name");
      if (!nameField) return { ...out, ok: false, reason: "contractor name field not found" };
      await typeInto(page, nameField, contractorName);
    }
  }
  if (fileName) {
    const f = await findField(page, "Acme_Electrical_Final_Bid_Revision_2");
    if (f) await typeInto(page, f, fileName);
  }
  const area = await findField(page, "Paste raw text or PDF transcript");
  if (!area) return { ...out, ok: false, reason: "quote textarea not found" };
  await typeInto(page, area, quoteText);

  const submit = await findButton(page, "Extract & Level Bid");
  if (!submit) return { ...out, ok: false, reason: "submit not found" };
  if (submit.meta.disabled) return { ...out, ok: false, reason: "submit disabled" };
  await realClick(page, submit);
  const start = Date.now();
  let outcome = "timeout";
  let errText = null;
  while (Date.now() - start < 180000) {
    const state = await page.evaluate(() => {
      const t = document.body.innerText;
      const errMatch = t.match(/Bid ingestion failed:([^\n]{0,400})/);
      return {
        modal: t.includes("Direct Quote / PDF Bid Ingestion"),
        err: errMatch ? errMatch[1].trim() : null,
        ingesting: t.includes("Extracting & Normalizing via AI"),
      };
    });
    if (state.err) { outcome = "error"; errText = state.err; break; }
    if (!state.modal) { outcome = "closed"; break; }
    await delay(1500);
  }
  out.ok = outcome === "closed";
  out.outcome = outcome;
  out.errText = errText;
  out.ms = Date.now() - start;
  return out;
}

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await dismissTour(page);
    await shot(page, "fix4-qa1-00-landing.png");

    let projects = await http.query("projects:listProjects", {});
    let proj = projects.find((p) => p.title === PROJECT_TITLE);
    if (!proj) {
      // ---------- Create fixture project (real mouse + keyboard)
      let modal = await openNewProjectModal(page);
      L("new project modal: " + JSON.stringify(modal));
      await typeIntoField(page, "Austin Innovation Tower - Phase II", PROJECT_TITLE);
      await typeIntoField(page, "e.g. Austin, TX", "Austin, TX");
      await typeIntoField(page, "e.g. Healthcare / Mixed-Use", "Commercial MEP Tower");
      await typeIntoField(page, "e.g. Austin Commercial, LP", "Austin Commercial, LP");
      await typeIntoField(page, "Estimated budget in dollars", "2000000");
      await typeIntoField(page, "Target completion duration in weeks", "52");
      await typeIntoField(page, "Outline high-level trade scopes", "QA1 adversarial fixture. Div 26 electrical scope.");
      await shot(page, "fix4-qa1-01-new-project-filled.png");
      const createBtn = await findButton(page, "Create Commercial Project");
      R.createClick = await realClick(page, createBtn);
      let sel = null;
      for (let i = 0; i < 30; i++) {
        await delay(1000);
        sel = await projectOptionState(page);
        if (sel && sel.options.some((o) => o.text.includes(PROJECT_TITLE))) break;
      }
      R.createResult = { found: !!(sel && sel.options.some((o) => o.text.includes(PROJECT_TITLE))) };
      L("fixture created: " + R.createResult.found);
      await shot(page, "fix4-qa1-02-project-created.png");
      projects = await http.query("projects:listProjects", {});
      proj = projects.find((p) => p.title === PROJECT_TITLE);
    } else {
      R.createResult = { found: true, reused: true };
    }
    if (!proj) throw new Error("fixture project not found in backend");
    R.projectId = proj._id;

    // ---------- Create Div 26 package via UI
    await selectProject(page, PROJECT_TITLE);
    await delay(2500);
    await clickTab(page, "01:");
    await delay(1200);
    await dismissTour(page);
    let pkgs = await pkgsOf(proj._id);
    if (!pkgs.some((p) => p.tradeName === PKG_NAME)) {
      const cp = await findButton(page, "Create Trade Package");
      R.openPackageModal = await realClick(page, cp);
      await waitForText(page, "Create CSI Trade Package", 8000);
      await typeIntoField(page, "e.g. 26 00 00", "26 00 00");
      await typeIntoField(page, "e.g. Electrical & Lighting Systems", PKG_NAME);
      const budgetInputs = await findHandles(page, "input", (m) => m.type === "number" || /^\d+$/.test(m.value), null);
      const budgetHandle = budgetInputs.find((b) => b.meta.ph === "" && b.meta.value !== "" && b.meta.value.length <= 8);
      if (budgetHandle) await typeInto(page, budgetHandle, "1000000");
      await typeIntoField(page, "Scope details...", "QA1 electrical distribution scope.");
      // Native date inputs are unreliable with synthetic keyboard; set programmatically.
      await page.evaluate(() => {
        const dlg = document.querySelector('[aria-labelledby="create-package-title"]');
        const el = dlg.querySelector('input[type="date"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(el, "2026-12-31");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await delay(300);
      R.packageFormDate = await page.evaluate(() => document.querySelector('[aria-labelledby="create-package-title"] input[type="date"]').value);
      await shot(page, "fix4-qa1-03-package-form.png");
      const pkgBtn = await findButton(page, "Create Package");
      R.createPkgClick = await realClick(page, pkgBtn);
      for (let i = 0; i < 15; i++) {
        await delay(1000);
        pkgs = await pkgsOf(proj._id);
        if (pkgs.some((p) => p.tradeName === PKG_NAME)) break;
      }
    }
    R.packageCreated = pkgs.find((p) => p.tradeName === PKG_NAME) || null;
    L("package: " + JSON.stringify(R.packageCreated));
    if (!R.packageCreated) throw new Error("package not created");
    R.packageId = R.packageCreated._id;
    await shot(page, "fix4-qa1-04-package-created.png");

    // ---------- Leveling tab + bid A (compliant)
    await clickTab(page, "04:");
    await delay(1500);
    await dismissTour(page);
    const textCompliant = `PROPOSAL AND QUOTATION
Subcontractor: AUDIT QA1 Beacon Power Systems
Project: QA1 Commercial MEP
Base Bid Price: $1,210,000.00
SCOPE INCLUSIONS (100% COMPLETE):
- Crane hoisting to penthouse switchgear room INCLUDED
- UL 1479 rated firestop penetrations INCLUDED
- Seismic bracing engineering INCLUDED
- 400A temporary power distribution INCLUDED
Lead time: 10 weeks.
Insurance: Fully compliant ACORD 25 with $5M Umbrella.`;
    R.bidA = await ingestQuote(page, { contractorName: "Beacon Power Systems", quoteText: textCompliant, fileName: "QA1_Beacon_Compliant.pdf" });
    L("bidA: " + JSON.stringify(R.bidA));
    await delay(2500);
    let bids = await bidsOf(proj._id);
    R.afterA = bids.map(normalize);
    await shot(page, "fix4-qa1-05-bidA.png", { full: true });

    // ---------- Bid B (low paper price + hidden exclusions)
    const textDeceptive = `PROPOSAL AND QUOTATION
Subcontractor: AUDIT QA1 Apex Electric
Project: QA1 Commercial MEP
Base Bid Price: $1,020,000.00
EXCLUSIONS:
- Crane hoisting & rigging to penthouse mechanical floor excluded (GC to furnish)
- UL 1479 firestop floor penetrations excluded (By drywall trade)
- Seismic engineered structural bracing excluded (By others)
- Overtime/weekend acceleration excluded from base rate
Lead time on switchgear: 20 weeks.
Insurance: Standard statutory limits (Umbrella endorsement fee not included).`;
    R.bidB = await ingestQuote(page, { contractorName: "Apex Electric", quoteText: textDeceptive, fileName: "QA1_Apex_Low.pdf" });
    L("bidB: " + JSON.stringify(R.bidB));
    await delay(2500);
    bids = await bidsOf(proj._id);
    R.afterB = bids.map(normalize);
    await shot(page, "fix4-qa1-06-bidB.png", { full: true });

    // ---------- Bid C = revision of A (same contractor, changed amount)
    const textRevision = `PROPOSAL AND QUOTATION
Subcontractor: AUDIT QA1 Beacon Power Systems
Project: QA1 Commercial MEP
Base Bid Price: $1,155,000.00
SCOPE INCLUSIONS (100% COMPLETE):
- Crane hoisting to penthouse switchgear room INCLUDED
- UL 1479 rated firestop penetrations INCLUDED
- Seismic bracing engineering INCLUDED
Lead time: 12 weeks.
Insurance: Fully compliant ACORD 25 with $5M Umbrella.`;
    R.bidC = await ingestQuote(page, { selectExisting: "Beacon Power Systems", quoteText: textRevision, fileName: "QA1_Beacon_Rev2.pdf" });
    L("bidC: " + JSON.stringify(R.bidC));
    await delay(2500);
    bids = await bidsOf(proj._id);
    R.afterC = bids.map(normalize);
    await shot(page, "fix4-qa1-07-bidC-rev.png", { full: true });

    // ---------- Bid D suspicious low (<50% budget)
    const textLow = `PROPOSAL AND QUOTATION
Subcontractor: AUDIT QA1 Speedy Volt LLC
Project: QA1 Commercial MEP
Base Bid Price: $430,000.00
SCOPE INCLUSIONS (100% COMPLETE):
- Complete electrical distribution INCLUDED
Lead time: 8 weeks.
Insurance: Fully compliant ACORD 25 with $5M Umbrella.`;
    R.bidD = await ingestQuote(page, { contractorName: "Speedy Volt LLC", quoteText: textLow, fileName: "QA1_Speedy_Low.pdf" });
    L("bidD: " + JSON.stringify(R.bidD));
    await delay(2500);
    bids = await bidsOf(proj._id);
    R.afterD = bids.map(normalize);
    await shot(page, "fix4-qa1-08-bidD-low.png", { full: true });

    // ---------- Absurd values on the same package (separate contractors each)
    const absurd = [
      { label: "zero", amount: "$0.00", text: (a) => `PROPOSAL AND QUOTATION\nSubcontractor: AUDIT QA1 Zero Co\nBase Bid Price: ${a}\nSCOPE INCLUSIONS (100% COMPLETE):\n- Nothing\nLead time: 4 weeks.\nInsurance: Fully compliant ACORD 25 with $5M Umbrella.` },
      { label: "negative", amount: "-$75,000.00", text: (a) => `PROPOSAL AND QUOTATION\nSubcontractor: AUDIT QA1 Negative Co\nBase Bid Price: ${a}\nSCOPE INCLUSIONS (100% COMPLETE):\n- Nothing\nLead time: 4 weeks.\nInsurance: Fully compliant ACORD 25 with $5M Umbrella.` },
      { label: "huge", amount: "$987,654,321,000.00", text: (a) => `PROPOSAL AND QUOTATION\nSubcontractor: AUDIT QA1 Huge Co\nBase Bid Price: ${a}\nSCOPE INCLUSIONS (100% COMPLETE):\n- Nothing\nLead time: 4 weeks.\nInsurance: Fully compliant ACORD 25 with $5M Umbrella.` },
      { label: "decimal", amount: "$1,234,567.89", text: (a) => `PROPOSAL AND QUOTATION\nSubcontractor: AUDIT QA1 Decimal Co\nBase Bid Price: ${a}\nSCOPE INCLUSIONS (100% COMPLETE):\n- Nothing\nLead time: 4 weeks.\nInsurance: Fully compliant ACORD 25 with $5M Umbrella.` },
    ];
    R.absurd = [];
    for (const t of absurd) {
      const before = await bidsOf(proj._id);
      const res = await ingestQuote(page, { contractorName: t.label + " co", quoteText: t.text(t.amount), fileName: `QA1_${t.label}.pdf` });
      await delay(2000);
      const after = await bidsOf(proj._id);
      const created = after.filter((b) => !before.some((x) => x._id === b._id));
      R.absurd.push({ label: t.label, amount: t.amount, ingest: res, newBids: created.map(normalize), countBefore: before.length, countAfter: after.length });
      L(`absurd ${t.label}: outcome=${res.outcome} err=${res.errText ? res.errText.slice(0, 120) : null} new=${created.length}`);
      await shot(page, `fix4-qa1-09-absurd-${t.label}.png`);
    }

    // ---------- Backend numbers + UI KPI reconciliation
    bids = await bidsOf(proj._id);
    pkgs = await pkgsOf(proj._id);
    const pkg = pkgs.find((p) => p._id === R.packageId);
    const getBreakdown = (b) => {
      const ex = (b.identifiedExclusions || []).reduce((s, x) => (x.isWaived ? s : s + (x.costImpact || 0)), 0);
      const ve = (b.valueEngineeringAlternates || []).reduce((s, x) => (x.isAccepted ? s + (x.costDeduct || 0) : s), 0);
      return { ex, ve, totalUplift: ex + (b.leadTimePenalty || 0) + (b.coiPenalty || 0) - ve };
    };
    const deceptiveIds = () => {
      const lowest = bids.length ? [...bids].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost)[0] : null;
      if (!lowest) return [];
      return bids.filter((b) => b._id !== lowest._id && b.baseBidAmount < lowest.baseBidAmount && b.leveledTotalCost > lowest.leveledTotalCost).map((b) => b._id);
    };
    const lowest = [...bids].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost)[0];
    const gaps = deceptiveIds().reduce((s, id) => s + getBreakdown(bids.find((b) => b._id === id)).totalUplift, 0);
    R.backend = {
      bids: bids.map(normalize),
      package: pkg,
      expected: {
        totalBudget: proj.estBudget,
        totalLeveledBuyout: lowest ? lowest.leveledTotalCost : pkg.budgetEstimate,
        effectiveBid: lowest ? { id: lowest._id, sub: lowest.subcontractorName, leveled: lowest.leveledTotalCost } : null,
        deceptiveIds: deceptiveIds(),
        gapsCaught: gaps,
        buyoutProgress: `0/1`,
      },
    };
    const kpi = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        leveled: (t.match(/Leveled Buyout: \$([\d,]+)/) || [])[1] || null,
        leveledShort: (t.match(/Leveled Buyout: \$[\d,]+ ?\(([^)]+)\)/) || [])[1] || null,
        variance: (t.match(/Variance: ([+-])\$([\d,]+)/) || []).slice(1),
        deceptive: (t.match(/(\d+) Deceptive Bid/) || [])[1] || null,
        gaps: (t.match(/Gaps Exposed: \+?\$([\d,]+)/) || [])[1] || null,
        awards: (t.match(/Subcontracts: (\d+)\/(\d+) Awarded/) || []).slice(1),
      };
    });
    R.kpi = kpi;
    const rank = await page.evaluate(() => [...document.body.innerText.matchAll(/Rank #(\d+)/g)].map((m) => m[1]));
    R.uiRankOrder = rank;
    R.revisionShown = await page.evaluate(() => {
      const t = document.body.innerText;
      return { revs: (t.match(/Rev(?:ision)? ?#?\d+/g) || []).slice(0, 10), text: (t.match(/Revision[^\n]{0,80}/g) || []).slice(0, 6) };
    });
    await shot(page, "fix4-qa1-10-kpi-reconcile.png", { full: true });

    R.consoleErrors = diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 200)).slice(0, 10);
    R.pageErrors = diag.pageErrors.slice(0, 5);
    R.failedRequests = diag.failedRequests.slice(0, 5);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    await shot(page, "fix4-qa1-99-error.png", { full: true }).catch(() => {});
  } finally {
    await browser.close();
    writeJson("fix4-qa1-bids.json", R);
    writeLog("fix4-qa1-bids.log", log);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 16000));
};
run();