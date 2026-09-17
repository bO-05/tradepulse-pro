// QA-14 browser sweep (independent round-6):
//  A. default landing = demo project (fresh profile)
//  B. deep-link claim: ?project=&tab=, click->URL sync, Back, reload
//  C. 8-tab sweep on a populated QA-REM fixture: zero console errors / zero >=400 responses
//  D. two-context realtime Judge Dock spot-check (peer view updates without refresh; seconds + backend counts)
//  E. mobile 375x812 overflow per project type (demo / populated fixture / empty fixture)
// Usage: node scripts/qa-rem/qa14-browser-sweep.mjs
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { launchBrowser, EVIDENCE_DIR, BASE_URL, waitForAppReady, shot, delay } from "./qa1-lib.mjs";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(BACKEND);
const TAG = `QA-REM-QA14-UI-${Date.now()}`;
const EMPTY_TAG = `QA-REM-QA14-EMPTY-${Date.now()}`;

const LOG = [];
const OUT = { tag: TAG, emptyTag: EMPTY_TAG, site: BASE_URL, backend: BACKEND, startedAt: new Date().toISOString(), items: {}, tabs: [], mobile: [], realtime: null };
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const TAB_ORDER = [
  { id: "packages", label: "CSI Scoping", keyword: "CSI MasterFormat Trade Packages" },
  { id: "discovery", label: "Discovery", keyword: "Discovery & Directory" },
  { id: "qna", label: "Pre-Bid Q&A", keyword: "Pre-Bid RFI Autonomous Clarification" },
  { id: "leveling", label: "Bid Leveling", keyword: "Real-Time Forensic Bid Leveling Matrix" },
  { id: "coordination", label: "Scope Clash", keyword: "Cross-Trade Scope Clash" },
  { id: "contracts", label: "Subcontracts", keyword: "Subcontract Agreements Register" },
  { id: "audit", label: "Live Activity Audit", keyword: "Live Reactive Activity Audit Stream" },
  { id: "diagnostics", label: "Evals & Architecture", keyword: "Sponsor Integration Hub" },
];

function attachNet(page) {
  const state = { consoleErrors: [], consoleWarnings: [], pageErrors: [], badResponses: [], requestFailed: [] };
  page.on("console", (m) => {
    if (m.type() === "error") state.consoleErrors.push(m.text());
    if (m.type() === "warning") state.consoleWarnings.push(m.text());
  });
  page.on("pageerror", (e) => state.pageErrors.push(String(e?.message || e)));
  page.on("response", (r) => {
    const s = r.status();
    if (s >= 400) state.badResponses.push(`${s} ${r.request().method()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => state.requestFailed.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText || "unknown"}`));
  return state;
}
const diffCount = (a, b) => b.length - a.length;
const slice = (arr, from) => arr.slice(from);

async function dismissTour(page) {
  await page.evaluate(() => {
    const byTitle = [...document.querySelectorAll("button[title]")].find((b) =>
      /Close Demo Tour|Close Teleprompter/i.test(b.getAttribute("title") || "")
    );
    if (byTitle) byTitle.click();
  });
  await delay(250);
}
async function getSelectedProject(page) {
  return page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    if (!sel) return null;
    return sel.options[sel.selectedIndex]?.textContent?.trim() || null;
  });
}
async function clickTab(page, label, isMobile = false) {
  if (isMobile) {
    const ok = await page.evaluate((lbl) => {
      const sel = document.querySelector('select[aria-label="Navigate procurement stage"]');
      if (!sel) return false;
      const opt = [...sel.options].find((o) => o.textContent.trim() === lbl);
      if (!opt) return false;
      sel.value = opt.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, label);
    await delay(400);
    return ok;
  }
  const res = await page.evaluate((lbl) => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().includes(lbl));
    if (!btn) return { ok: false };
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return { ok: true, title: btn.getAttribute("title") || "" };
  }, label);
  await delay(400);
  return res.ok;
}
async function urlTab(page) {
  return page.evaluate(() => new URLSearchParams(window.location.search).get("tab"));
}
async function urlProject(page) {
  return page.evaluate(() => new URLSearchParams(window.location.search).get("project"));
}
async function bodyHas(page, text) {
  return page.evaluate((t) => document.body.innerText.includes(t), text);
}
async function overflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const vw = window.innerWidth;
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && String(el.className).slice(0, 70)) || "",
          left: Math.round(r.left),
          right: Math.round(r.right),
          text: (el.textContent || "").trim().slice(0, 60),
        });
        if (offenders.length >= 12) break;
      }
    }
    return { innerWidth: vw, scrollWidth: doc.scrollWidth, overflowPx: Math.max(0, doc.scrollWidth - vw), offenders };
  });
}

async function snapshotCounts(projectId) {
  const packages = await client.query("tradePackages:listByProject", { projectId });
  const bids = await client.query("bids:listAllProjectBids", { projectId });
  const agreements = await client.query("agreements:listAgreements", { projectId });
  const logs = await client.query("auditLogs:listRecentLogs", { projectId, limit: 1000 });
  const contractors = await client.query("contractors:listByProject", { projectId });
  return { packages: packages.length, bids: bids.length, agreements: agreements.length, auditLogs: logs.length, contractors: contractors.length };
}

async function main() {
  ev("=== QA-14 BROWSER SWEEP ===");
  ev(`Site: ${BASE_URL}`);
  ev(`UTC : ${new Date().toISOString()}`);
  ev("");

  // ---- fixtures ----
  const populatedId = await client.mutation("projects:createProject", {
    title: TAG, location: "Austin, TX", projectType: "commercial QA", estBudget: 2800000,
    targetCompletionWeeks: 44, specDocumentText: "QA-14 populated browser fixture (Div 26 + 23).", isDemoProject: false,
  });
  const elecPkgId = await client.mutation("tradePackages:createTradePackage", {
    projectId: populatedId, csiDivision: "26 00 00", tradeName: "QA-14 Electrical Browser", budgetEstimate: 1250000,
    scopeSummary: "QA-14 browser fixture electrical scope", mandatoryInclusions: ["Switchgear"], bidDeadline: "2026-12-31",
  });
  await client.mutation("tradePackages:createTradePackage", {
    projectId: populatedId, csiDivision: "23 00 00", tradeName: "QA-14 HVAC Browser", budgetEstimate: 900000,
    scopeSummary: "QA-14 browser fixture mechanical scope", mandatoryInclusions: ["RTUs"], bidDeadline: "2026-12-31",
  });
  const ctrId = await client.mutation("contractors:createContractor", {
    tradePackageId: elecPkgId, companyName: "QA-14 Browser Electric", contactEmail: "qa14.browser@tradepulse-pro.test",
    phone: "+1 (512) 555-0143", licenseNumber: "TX-TECL-QA14U", licenseStatus: "Active / Verified",
    sourceUrl: "https://tradepulse-pro.test/qa14u", rfqStatus: "invited",
  });
  await client.mutation("bids:submitDirectBid", {
    tradePackageId: elecPkgId, contractorId: ctrId, subcontractorName: "QA-14 Browser Electric", baseBidAmount: 1105000,
  });
  const emptyId = await client.mutation("projects:createProject", {
    title: EMPTY_TAG, location: "Austin, TX", projectType: "commercial QA", estBudget: 1500000,
    targetCompletionWeeks: 30, specDocumentText: "QA-14 empty browser fixture.", isDemoProject: false,
  });
  const projects = await client.query("projects:listProjects", {});
  const demo = projects.find((p) => p.isDemoProject);
  ev(`[fixtures] populated=${populatedId} empty=${emptyId} demo=${demo?._id} totalProjects=${projects.length}`);
  OUT.fixtures = { populatedId, emptyId, elecPkgId, ctrId, demoId: demo?._id, demoTitle: demo?.title, projectCountAfterCreate: projects.length };
  ev("");

  const { browser, executablePath } = await launchBrowser();
  ev(`[browser] ${executablePath}`);
  try {
    // ---- A. landing ----
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    const diagLanding = attachNet(page);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    const landingSelected = await getSelectedProject(page);
    const landingUrl = await page.evaluate(() => window.location.href);
    const landingDemo = Boolean(landingSelected && demo && landingSelected.includes("Domain Tower B"));
    ev(`[A] landing selected="${landingSelected}" demoMatch=${landingDemo}`);
    ev(`[A] landing url=${landingUrl}`);
    await shot(page, "remediation-qa14-landing.png");
    OUT.items.landing_demo = landingDemo;
    OUT.landing = { selected: landingSelected, url: landingUrl, consoleErrors: diagLanding.consoleErrors, badResponses: diagLanding.badResponses };
    ev("");

    // ---- B. deep-link claim ----
    const dl = { steps: {} };
    await page.goto(`${BASE_URL}/?project=${demo._id}&tab=coordination`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    dl.steps.boot = {
      urlTab: await urlTab(page),
      urlProject: await urlProject(page),
      selected: await getSelectedProject(page),
      coordinationContent: await bodyHas(page, "Cross-Trade Scope Clash"),
    };
    await shot(page, "remediation-qa14-deeplink-coordination.png");
    ev(`[B] deep link boot: tab=${dl.steps.boot.urlTab} project=${dl.steps.boot.urlProject === demo._id ? "demo" : dl.steps.boot.urlProject} selected="${dl.steps.boot.selected}" coordContent=${dl.steps.boot.coordinationContent}`);

    await clickTab(page, "Subcontracts");
    dl.steps.clickSync = { urlTab: await urlTab(page), contractsContent: await bodyHas(page, "Subcontract Agreements Register") };
    ev(`[B] click Subcontracts -> urlTab=${dl.steps.clickSync.urlTab} content=${dl.steps.clickSync.contractsContent}`);

    await page.goBack({ waitUntil: "domcontentloaded" });
    await delay(700);
    dl.steps.back = { urlTab: await urlTab(page), coordinationContent: await bodyHas(page, "Cross-Trade Scope Clash") };
    ev(`[B] back -> urlTab=${dl.steps.back.urlTab} coordContent=${dl.steps.back.coordinationContent}`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    dl.steps.reload = { urlTab: await urlTab(page), urlProject: await urlProject(page), selected: await getSelectedProject(page) };
    ev(`[B] reload -> urlTab=${dl.steps.reload.urlTab} projectKept=${dl.steps.reload.urlProject === demo._id}`);
    OUT.deepLink = dl;
    OUT.items.deep_link = Boolean(
      dl.steps.boot.urlTab === "coordination" &&
      dl.steps.boot.coordinationContent &&
      dl.steps.clickSync.urlTab === "contracts" &&
      dl.steps.clickSync.contractsContent &&
      dl.steps.back.urlTab === "coordination" &&
      dl.steps.back.coordinationContent &&
      dl.steps.reload.urlTab === "coordination" &&
      dl.steps.reload.urlProject === demo._id
    );
    ev("");

    // ---- C. 8-tab sweep on populated fixture ----
    await page.goto(`${BASE_URL}/?project=${populatedId}&tab=packages`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(800);
    let sweepErrors = 0;
    for (const tab of TAB_ORDER) {
      const baseline = {
        ce: diagLanding.consoleErrors.length, cw: diagLanding.consoleWarnings.length,
        pe: diagLanding.pageErrors.length, br: diagLanding.badResponses.length, rf: diagLanding.requestFailed.length,
      };
      const clicked = await clickTab(page, tab.label);
      await delay(1000);
      const tabNow = await urlTab(page);
      const keywordFound = await bodyHas(page, tab.keyword);
      await shot(page, `remediation-qa14-tab-${tab.id}.png`);
      const rec = {
        id: tab.id, label: tab.label, clicked, urlTab: tabNow, keywordFound,
        newConsoleErrors: slice(diagLanding.consoleErrors, baseline.ce),
        newConsoleWarnings: slice(diagLanding.consoleWarnings, baseline.cw),
        newPageErrors: slice(diagLanding.pageErrors, baseline.pe),
        newBadResponses: slice(diagLanding.badResponses, baseline.br),
        newRequestFailed: slice(diagLanding.requestFailed, baseline.rf),
      };
      rec.ok = clicked && tabNow === tab.id && rec.newConsoleErrors.length === 0 && rec.newPageErrors.length === 0 && rec.newBadResponses.length === 0;
      if (!rec.ok) sweepErrors += 1;
      OUT.tabs.push(rec);
      ev(`[C] tab ${tab.id}: clicked=${clicked} urlTab=${tabNow} content=${keywordFound} consoleErr=${rec.newConsoleErrors.length} pageErr=${rec.newPageErrors.length} bad>=400=${rec.newBadResponses.length} reqFailed=${rec.newRequestFailed.length} ${rec.ok ? "OK" : "ISSUE"}`);
    }
    OUT.items.tab_sweep_clean = sweepErrors === 0;
    OUT.items.tab_sweep_content_all = OUT.tabs.every((t) => t.keywordFound);
    ev(`[C] total failures this sweep: ${sweepErrors}`);
    ev("");

    // ---- D. two-context realtime Judge Dock ----
    const countsBefore = await snapshotCounts(populatedId);
    const pageA = await browser.newPage();
    await pageA.setViewport({ width: 1600, height: 1000 });
    const diagA = attachNet(pageA);
    await pageA.goto(`${BASE_URL}/?project=${populatedId}&tab=audit`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(pageA, 45000);
    await dismissTour(pageA);
    await delay(500);
    const auditTextBefore = await pageA.evaluate(() => document.body.innerText);

    const pageB = await browser.newPage();
    await pageB.setViewport({ width: 1600, height: 1000 });
    await pageB.goto(`${BASE_URL}/?project=${populatedId}&tab=packages`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(pageB, 45000);
    await dismissTour(pageB);
    await delay(500);
    const dockOpen = await pageB.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Judge Dock"));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await delay(600);
    const dockReady = await bodyHas(pageB, "Full Autonomous Procurement Lifecycle");
    const t0 = Date.now();
    const cycleClicked = await pageB.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Run Full Autonomous Procurement Lifecycle"));
      if (!btn) return false;
      btn.click();
      return true;
    });
    let peerUpdated = false;
    let secondsToPeerUpdate = null;
    let peerMarkerSeen = null;
    const deadline = Date.now() + 120000;
    const markers = ["Subcontract Awarded", "Awarded Division", "Agreement Executed"];
    while (Date.now() < deadline) {
      const txt = await pageA.evaluate(() => document.body.innerText);
      const marker = markers.find((m) => txt.includes(m) && !auditTextBefore.includes(m));
      if (marker) {
        peerUpdated = true;
        peerMarkerSeen = marker;
        secondsToPeerUpdate = (Date.now() - t0) / 1000;
        break;
      }
      await delay(250);
    }
    await delay(500);
    const countsAfter = await snapshotCounts(populatedId);
    await shot(pageA, "remediation-qa14-realtime-peer-audit.png");
    await shot(pageB, "remediation-qa14-realtime-dock-trigger.png");
    OUT.realtime = {
      dockOpen, dockReady, cycleClicked, peerUpdated,
      secondsToPeerUpdate, peerMarkerSeen,
      countsBefore, countsAfter,
      peerConsoleErrors: diagA.consoleErrors, peerBadResponses: diagA.badResponses,
    };
    OUT.items.realtime_dock = Boolean(dockOpen && dockReady && cycleClicked && peerUpdated);
    ev(`[D] dockOpen=${dockOpen} dockReady=${dockReady} cycleClicked=${cycleClicked} peerUpdated=${peerUpdated} in ${secondsToPeerUpdate ?? "n/a"}s`);
    ev(`[D] backend counts before=${JSON.stringify(countsBefore)} after=${JSON.stringify(countsAfter)}`);
    await pageA.close();
    await pageB.close();
    ev("");

    // ---- E. mobile 375x812 ----
    const mobile = await browser.newPage();
    await mobile.setViewport({ width: 375, height: 812 });
    for (const proj of [
      { type: "demo", id: demo._id, title: demo.title },
      { type: "populated_fixture", id: populatedId, title: TAG },
      { type: "empty_fixture", id: emptyId, title: EMPTY_TAG },
    ]) {
      const rec = { type: proj.type, id: proj.id, tabs: [], maxOverflow: 0 };
      await mobile.goto(`${BASE_URL}/?project=${proj.id}&tab=packages`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForAppReady(mobile, 45000);
      await dismissTour(mobile);
      await delay(700);
      for (const tab of TAB_ORDER) {
        const clicked = await clickTab(mobile, tab.label, true);
        await delay(650);
        const ov = await overflow(mobile);
        rec.tabs.push({ id: tab.id, clicked, overflowPx: ov.overflowPx, offenders: ov.offenders });
        rec.maxOverflow = Math.max(rec.maxOverflow, ov.overflowPx);
      }
      await shot(mobile, `remediation-qa14-mobile-${proj.type}.png`);
      OUT.mobile.push(rec);
      ev(`[E] mobile ${proj.type}: maxOverflow=${rec.maxOverflow}px tabs=${rec.tabs.map((t) => `${t.id}:${t.overflowPx}`).join(" ")}`);
    }
    OUT.items.mobile_no_overflow = OUT.mobile.every((m) => m.maxOverflow === 0);
    await mobile.close();
  } finally {
    await browser.close();
  }

  // ---- cleanup fixtures + demo check ----
  const delPop = await client.mutation("projects:deleteProject", { projectId: populatedId }).then(() => true).catch((e) => String(e?.message));
  const delEmpty = await client.mutation("projects:deleteProject", { projectId: emptyId }).then(() => true).catch((e) => String(e?.message));
  const after = await client.query("projects:listProjects", {});
  const onlyDemo = after.length === 1 && after[0].isDemoProject === true;
  OUT.cleanup = { delPop, delEmpty, remaining: after.map((p) => ({ title: p.title, isDemo: Boolean(p.isDemoProject) })) };
  OUT.items.cleanup_only_demo = onlyDemo;
  ev(`[cleanup] deleted fixtures; remaining projects=${after.length} onlyDemo=${onlyDemo}`);

  const failed = Object.entries(OUT.items).filter(([, v]) => !v).map(([k]) => k);
  OUT.finishedAt = new Date().toISOString();
  OUT.failedItems = failed;
  OUT.overall = failed.length === 0 ? "PASS" : "FAIL";
  ev(`ITEMS: ${Object.entries(OUT.items).map(([k, v]) => `${k}=${v ? "PASS" : "FAIL"}`).join(" | ")}`);
  ev(`OVERALL: ${OUT.overall}${failed.length ? ` (failed: ${failed.join(", ")})` : ""}`);

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa14-browser-sweep.txt"), LOG.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa14-browser-sweep.json"), JSON.stringify(OUT, null, 2), "utf8");
  console.log("Wrote browser sweep evidence.");
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa14-browser-sweep.txt"), LOG.join("\n") + `\nFATAL: ${e?.stack || e?.message}\n`, "utf8");
  process.exit(1);
});