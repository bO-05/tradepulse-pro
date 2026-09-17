// QA-13 (round 6) independent LIVE verification of P3/P4 closure items 1-8.
// Read-only against app source; creates no fixtures (run qa13-setup.mjs first);
// only interacts with QA-REM-* fixtures + demo read-only paths.
// Usage: node scripts/qa-rem/qa13-browser.mjs
import {
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  delay,
  BASE_URL,
  writeLog,
  getSelectorState,
  bodyText,
} from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const fixture = JSON.parse(
  fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa13-fixtures.json"), "utf8")
);
const client = new ConvexHttpClient(fixture.backend);

const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 600) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "..." : s;
};
const RESULTS = [];
const record = (item, verdict, detail) => {
  RESULTS.push({ item, verdict, detail });
  ev(`>>> ${item}: ${verdict} :: ${detail}`);
};

async function state(page) {
  const sel = await getSelectorState(page);
  return page.evaluate(
    (selState) => {
      const stageSel = document.querySelector('select[aria-label="Navigate procurement stage"]');
      return {
        url: location.href,
        selectedProject: selState ? selState.selectedText : null,
        selectedValue: selState ? selState.value : null,
        activeStage: stageSel ? stageSel.value : null,
      };
    },
    sel
  );
}

async function clickTab(page, label) {
  return page.evaluate((label) => {
    const header = document.querySelector("header");
    if (!header) return { ok: false, reason: "no header" };
    const btns = [...header.querySelectorAll("button")];
    const match =
      btns.find((b) => (b.getAttribute("title") || "").includes(label)) ||
      btns.find((b) => (b.textContent || "").includes(label));
    if (!match) {
      return {
        ok: false,
        reason: "tab button not found",
        available: btns.map((b) => (b.getAttribute("title") || "").trim() || (b.textContent || "").trim().slice(0, 40)).slice(0, 40),
      };
    }
    match.scrollIntoView({ block: "center" });
    match.click();
    return { ok: true, text: (match.textContent || "").trim().slice(0, 60), title: match.getAttribute("title") };
  }, label);
}

async function clickButtonByText(page, needle, opts = {}) {
  return page.evaluate(
    (needle, exact) => {
      const buttons = [...document.querySelectorAll("button")];
      const match = buttons.find((b) => {
        const t = (b.textContent || "").trim();
        return exact ? t === needle : t.includes(needle);
      });
      if (!match) {
        return { ok: false, reason: "button not found", available: buttons.map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 50) };
      }
      match.scrollIntoView({ block: "center" });
      match.click();
      return { ok: true, text: (match.textContent || "").trim(), disabled: match.disabled };
    },
    needle,
    !!opts.exact
  );
}

const SKELETON_RECORDER = () => {
  window.__qa13 = {
    startedAt: Date.now(),
    skeletonSeen: false,
    skeletonFirstAt: null,
    skeletonLastAt: null,
    emptySeen: false,
    emptyAt: null,
    samples: 0,
  };
  const check = () => {
    try {
      window.__qa13.samples += 1;
      const el = document.querySelector('[aria-label="Loading trade packages"]');
      const now = Date.now();
      if (el) {
        if (!window.__qa13.skeletonSeen) {
          window.__qa13.skeletonSeen = true;
          window.__qa13.skeletonFirstAt = now;
        }
        window.__qa13.skeletonLastAt = now;
      }
      if (!window.__qa13.emptySeen && document.body && document.body.innerText.includes("No Trade Packages Configured")) {
        window.__qa13.emptySeen = true;
        window.__qa13.emptyAt = now;
      }
    } catch (e) {
      /* ignore */
    }
  };
  const obs = new MutationObserver(check);
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-label"] });
      check();
    },
    { once: true }
  );
  setInterval(check, 5);
};

async function run() {
  const { browser } = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    const diag = attachDiagnostics(page);
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem("tradepulse.tourDismissed", "1");
      } catch (e) {
        /* ignore */
      }
    });
    await page.evaluateOnNewDocument(SKELETON_RECORDER);

    ev("=== QA-13 LIVE VERIFICATION (round 6) ===");
    ev(`UTC: ${new Date().toISOString()}`);
    ev(`Live: ${BASE_URL}`);
    ev(`Fixture: ${J(fixture)}`);

    // ---------------- ITEM 1: deep links / history ----------------
    ev("");
    ev("### ITEM 1: deep links & history");
    const demoProject = await client.query("projects:getDemoProject", {});
    ev(`demoProject=${J({ id: demoProject._id, title: demoProject.title })}`);
    await page.goto(`${BASE_URL}/?project=${fixture.emptyProjectId}&tab=leveling`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(1800);
    let s = await state(page);
    let body = await bodyText(page);
    ev(`[1a] ${J(s)}`);
    const levelingEmptySeen = body.includes("Please select a trade package to inspect the bid leveling matrix.");
    ev(`[1a] leveling-empty-state-visible=${levelingEmptySeen}`);
    await shot(page, "remediation-qa13-item1a-deeplink-leveling.png");

    await clickTab(page, "Discovery");
    await delay(800);
    s = await state(page);
    ev(`[1b] after Discovery click: ${J(s)}`);
    const tabB = s.activeStage === "discovery" && s.url.includes("tab=discovery");
    await shot(page, "remediation-qa13-item1b-tab-clicked-discovery.png");

    let backOk = false;
    try {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 });
      await delay(900);
      s = await state(page);
      backOk = s.activeStage === "leveling" && s.url.includes("tab=leveling");
      ev(`[1c] after Back: ${J(s)} -> back-to-leveling=${backOk}`);
    } catch (e) {
      ev(`[1c] goBack error: ${e.message}`);
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2000);
    s = await state(page);
    body = await bodyText(page);
    const reloadOk = s.activeStage === "leveling" && s.url.includes("tab=leveling") && s.selectedValue === fixture.emptyProjectId;
    ev(`[1d] after reload: ${J(s)} -> deep-link-persists=${reloadOk}`);
    await shot(page, "remediation-qa13-item1d-reload-persists.png");

    const fakeId = "j000000000000000000000000000000";
    await page.goto(`${BASE_URL}/?project=${fakeId}&tab=leveling`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(3000);
    s = await state(page);
    body = await bodyText(page);
    const fakeFallbackOk = s.selectedValue === demoProject._id && !s.url.includes(fakeId);
    ev(`[1e] fake project URL: ${J(s)}`);
    ev(`[1e] fallback to demo project=${fakeFallbackOk}; url-corrected=${!s.url.includes(fakeId)}`);
    await shot(page, "remediation-qa13-item1e-fake-project-fallback.png");
    const item1Ok = levelingEmptySeen && tabB && backOk && reloadOk && fakeFallbackOk;
    record("ITEM 1 deep links/history", item1Ok ? "PASS" : "FAIL", J({ levelingEmptySeen, tabUrlUpdates: tabB, backToPreviousTab: backOk, reloadPersists: reloadOk, fakeGracefulFallback: fakeFallbackOk, fakeUrl: s.url }));

    // ---------------- ITEM 2: empty-state CTAs ----------------
    ev("");
    ev("### ITEM 2: empty-state CTAs (0-package fixture)");
    const item2Results = {};
    for (const [tabLabel, tabId] of [
      ["Discovery", "discovery"],
      ["Pre-Bid Q&A", "qna"],
      ["Bid Leveling", "leveling"],
    ]) {
      await page.goto(`${BASE_URL}/?project=${fixture.emptyProjectId}&tab=${tabId}`, { waitUntil: "domcontentloaded" });
      await waitForAppReady(page);
      await delay(1800);
      body = await bodyText(page);
      const hasCta = body.includes("Go to CSI Scoping");
      await shot(page, `remediation-qa13-item2-${tabId}-empty-state.png`);
      const clickRes = await clickButtonByText(page, "Go to CSI Scoping");
      await delay(900);
      s = await state(page);
      const navigated = s.activeStage === "packages";
      item2Results[tabId] = { ctaVisible: hasCta, click: clickRes.ok, navigated };
      ev(`[2] ${tabLabel}: CTA visible=${hasCta} clicked=${clickRes.ok} activeStage=${s.activeStage} url=${s.url}`);
      await shot(page, `remediation-qa13-item2-${tabId}-after-cta-click.png`);
    }
    const item2Ok = Object.values(item2Results).every((r) => r.ctaVisible && r.click && r.navigated);
    record("ITEM 2 empty-state CTAs", item2Ok ? "PASS" : "FAIL", J(item2Results));

    // ---------------- ITEM 3: loading skeleton ----------------
    ev("");
    ev("### ITEM 3: package loading skeleton");
    await page.goto(`${BASE_URL}/?project=${fixture.emptyProjectId}&tab=packages`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("No Trade Packages Configured"), { timeout: 20000 });
    await delay(300);
    let skel = await page.evaluate(() => window.__qa13 || null);
    const unthrottledObs = skel ? { skeletonSeen: skel.skeletonSeen, skeletonFirstAt: skel.skeletonFirstAt, emptyAt: skel.emptyAt, samples: skel.samples } : null;
    ev(`[3] unthrottled observation: ${J(unthrottledObs)}`);
    let skeletonObserved = !!(skel && skel.skeletonSeen);
    let throttled = false;
    let throttledObs = null;
    if (!skeletonObserved) {
      ev("[3] not observed unthrottled; retrying with CDP network throttling (latency 1500ms)");
      const cdp = await page.createCDPSession();
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 1500,
        downloadThroughput: 100 * 1024,
        uploadThroughput: 100 * 1024,
      });
      throttled = true;
      await page.goto(`${BASE_URL}/?project=${fixture.emptyProjectId}&tab=packages`, { waitUntil: "domcontentloaded" });
      try {
        await page.waitForSelector('[aria-label="Loading trade packages"]', { timeout: 6000 });
        await shot(page, "remediation-qa13-item3-skeleton-throttled.png");
        ev("[3] skeleton element captured (throttled) screenshot taken");
      } catch (e) {
        ev(`[3] skeleton selector not seen even under throttling: ${e.message.split("\n")[0]}`);
      }
      await page.waitForFunction(() => document.querySelector('[aria-label="Loading trade packages"]') === null && document.body.innerText.includes("No Trade Packages Configured"), { timeout: 30000 }).catch(() => {});
      await delay(300);
      skel = await page.evaluate(() => window.__qa13 || null);
      throttledObs = skel ? { skeletonSeen: skel.skeletonSeen, skeletonFirstAt: skel.skeletonFirstAt, emptyAt: skel.emptyAt, samples: skel.samples } : null;
      ev(`[3] throttled observation: ${J(throttledObs)}`);
      skeletonObserved = !!(skel && skel.skeletonSeen);
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      }).catch(() => {});
      await cdp.detach().catch(() => {});
    }
    record(
      "ITEM 3 loading skeleton",
      skeletonObserved ? "PASS" : "FAIL",
      J({ skeletonObserved, unthrottledObs, throttledRetry: throttled, throttledObs })
    );

    // ---------------- ITEM 4: clash resolution persistence ----------------
    ev("");
    ev("### ITEM 4: clash resolution persistence");
    const clashBefore = await client.query("coordination:detectCrossTradeClashes", { projectId: fixture.clashProjectId });
    ev(`[4] backend initial: activeClashesCount=${clashBefore.summary.activeClashesCount} doubleBuys=${clashBefore.doubleBuys.map((d) => `${d.id}:${d.status}`).join(",")} voids=${clashBefore.scopeVoids.map((v) => `${v.id}:${v.status}`).join(",")}`);
    await page.goto(`${BASE_URL}/?project=${fixture.clashProjectId}&tab=coordination`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2200);
    body = await bodyText(page);
    const uiCards =
      body.includes("Variable Frequency Drives (VFDs) for AHUs & Pumps") &&
      body.includes("$38,500") &&
      body.includes("$12,000") &&
      body.includes("$28,000") &&
      body.includes("$18,500") &&
      body.includes("1-Click Deduct Credit");
    ev(`[4a] UI shows both double-buy cards + both void cards = ${uiCards}`);
    await shot(page, "remediation-qa13-item4a-clashes-detected.png");

    const deductClick = await clickButtonByText(page, "1-Click Deduct Credit");
    ev(`[4b] deduct click: ${J(deductClick)}`);
    let deductedSeen = false;
    try {
      await page.waitForFunction(
        () => document.body.innerText.includes("Deducted $38,500 credit from proposal"),
        { timeout: 20000 }
      );
      deductedSeen = true;
    } catch (e) {
      ev(`[4b] wait for deducted state failed: ${e.message.split("\n")[0]}`);
    }
    await shot(page, "remediation-qa13-item4b-deducted-card.png");
    ev(`[4b] deducted card state visible=${deductedSeen}`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2500);
    body = await bodyText(page);
    const deductedPersists =
      body.includes("Deducted $38,500 credit from proposal") &&
      !body.includes("1-Click Deduct Credit (-$38,500)");
    ev(`[4c] after reload deducted persists=${deductedPersists}`);
    await shot(page, "remediation-qa13-item4c-deducted-after-reload.png");
    const clashMid = await client.query("coordination:detectCrossTradeClashes", { projectId: fixture.clashProjectId });
    ev(`[4c] backend after deduct: active=${clashMid.summary.activeClashesCount} clash-vfd-01=${clashMid.doubleBuys.find((d) => d.id === "clash-vfd-01").status}`);

    const assignClick = await clickButtonByText(page, "Assign to Div 26 (Electrical)");
    ev(`[4d] assign click: ${J(assignClick)}`);
    let assignedSeen = false;
    try {
      await page.waitForFunction(() => document.body.innerText.includes("Assigned to Division 26 Electrical"), { timeout: 20000 });
      assignedSeen = true;
    } catch (e) {
      ev(`[4d] wait for assigned state failed: ${e.message.split("\n")[0]}`);
    }
    await shot(page, "remediation-qa13-item4d-void-assigned.png");

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2500);
    body = await bodyText(page);
    const assignedPersists = body.includes("Assigned to Division 26 Electrical");
    ev(`[4e] after reload assigned persists=${assignedPersists}`);
    await shot(page, "remediation-qa13-item4e-void-assigned-after-reload.png");

    const clashAfter = await client.query("coordination:detectCrossTradeClashes", { projectId: fixture.clashProjectId });
    ev(`[4f] backend final: activeClashesCount=${clashAfter.summary.activeClashesCount} doubleBuys=${JSON.stringify(clashAfter.doubleBuys.map((d) => ({ id: d.id, status: d.status })))} voids=${JSON.stringify(clashAfter.scopeVoids.map((v) => ({ id: v.id, status: v.status })))}`);
    const item4Ok =
      uiCards &&
      deductClick.ok &&
      deductedSeen &&
      deductedPersists &&
      clashMid.doubleBuys.find((d) => d.id === "clash-vfd-01").status === "deducted" &&
      assignClick.ok &&
      assignedSeen &&
      assignedPersists &&
      clashAfter.scopeVoids.find((v) => v.id === "void-bas-wiring-01").status === "assigned" &&
      clashBefore.summary.activeClashesCount === 4 &&
      clashAfter.summary.activeClashesCount === 2;
    record(
      "ITEM 4 clash resolution persistence",
      item4Ok ? "PASS" : "FAIL",
      J({ uiCards, deductedSeen, deductedPersists, assignedSeen, assignedPersists, activeCount: `${clashBefore.summary.activeClashesCount}->${clashAfter.summary.activeClashesCount}` })
    );

    // ---------------- ITEM 5: bid revision marker ----------------
    ev("");
    ev("### ITEM 5: bid revision marker (ingest same contractor twice)");
    const quoteText = [
      "PROPOSAL AND QUOTATION",
      "Subcontractor: QA-REM QA13 Electric LLC",
      "Project: QA-REM QA13 Clash Fixture",
      "Base Bid Price: $1,250,000.00",
      "SCOPE INCLUSIONS (100% COMPLETE):",
      "- Crane hoisting to penthouse switchgear room INCLUDED",
      "- UL 1479 rated firestop penetrations INCLUDED",
      "- Seismic bracing engineering INCLUDED",
      "Lead time: 10 weeks.",
      "Insurance: Fully compliant ACORD 25 with $5M Umbrella.",
    ].join("\n");
    const quoteText2 = quoteText.replace("$1,250,000.00", "$1,240,000.00");

    async function ingestOnce(text, fileLabel) {
      const open = await clickButtonByText(page, "Ingest Quote / PDF");
      if (!open.ok) return { ok: false, stage: "open-modal", detail: open };
      await page.waitForSelector('textarea[placeholder^="Paste raw text"]', { timeout: 10000 });
      await delay(400);
      const setRes = await page.evaluate(
        (contractorId, textVal, label) => {
          const selects = [...document.querySelectorAll("select")];
          const select = selects.find((s) =>
            [...s.options].some((o) => (o.textContent || "").includes("QA-REM QA13 Electric LLC"))
          );
          if (!select) {
            return {
              ok: false,
              reason: "contractor select with fixture option not found",
              selects: selects.map((s) => ({ value: s.value, options: [...s.options].map((o) => o.textContent.trim()).slice(0, 6) })),
            };
          }
          const opt = [...select.options].find((o) => o.value === contractorId);
          if (!opt) {
            return { ok: false, reason: "fixture contractor option missing", options: [...select.options].map((o) => o.textContent.trim()) };
          }
          select.value = contractorId;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          const ta = document.querySelector('textarea[placeholder^="Paste raw text"]');
          const proto = HTMLTextAreaElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value").set.call(ta, textVal);
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          ta.dispatchEvent(new Event("change", { bubbles: true }));
          const fn = document.querySelector('input[placeholder^="e.g. Acme_Electrical"]');
          if (fn) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(fn, label);
            fn.dispatchEvent(new Event("input", { bubbles: true }));
            fn.dispatchEvent(new Event("change", { bubbles: true }));
          }
          return { ok: true, selectValue: select.value };
        },
        fixture.contractorId,
        text,
        fileLabel
      );
      ev(`[5] ingest form fill: ${J(setRes)}`);
      if (!setRes.ok) return { ok: false, stage: "fill", detail: setRes };
      const submit = await clickButtonByText(page, "Extract & Level Bid");
      ev(`[5] submit: ${J(submit)}`);
      return { ok: submit.ok, stage: "submitted", detail: submit };
    }

    await page.goto(`${BASE_URL}/?project=${fixture.clashProjectId}&tab=leveling`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2200);
    s = await state(page);
    ev(`[5] leveling tab active: ${J(s)}`);
    await shot(page, "remediation-qa13-item5-before-ingest.png");
    const ing1 = await ingestOnce(quoteText, "QA13_Electrical_Initial_Proposal.pdf");
    if (ing1.ok) {
      await page.waitForFunction(() => document.body.innerText.includes("QA-REM QA13 Electric LLC"), { timeout: 45000 }).catch(() => {});
      await delay(2500);
      await shot(page, "remediation-qa13-item5-first-ingest.png");
    }
    const ing2 = await ingestOnce(quoteText2, "QA13_Electrical_Revised_Proposal.pdf");
    let rev2Seen = false;
    if (ing2.ok) {
      rev2Seen = await page
        .waitForFunction(() => document.body.innerText.includes("Rev 2"), { timeout: 45000 })
        .then(() => true)
        .catch(() => false);
      await delay(1200);
      await shot(page, "remediation-qa13-item5-rev2-badge.png");
    }
    body = await bodyText(page);
    const bidsPkg26 = await client.query("bids:listByPackage", { tradePackageId: fixture.pkg26 });
    const fixtureBid = bidsPkg26.find((b) => b.contractorId === fixture.contractorId);
    ev(`[5] backend bid for fixture contractor: ${J(fixtureBid && { id: fixtureBid._id, sub: fixtureBid.subcontractorName, base: fixtureBid.baseBidAmount, rev: fixtureBid.revisionNumber, receivedAt: fixtureBid.receivedAt })}`);
    const item5Ok = !!(ing1.ok && ing2.ok && rev2Seen && fixtureBid && fixtureBid.revisionNumber === 2);
    record(
      "ITEM 5 bid revision marker",
      item5Ok ? "PASS" : "FAIL",
      J({ ingest1: ing1.ok, ingest2: ing2.ok, rev2BadgeSeen: rev2Seen, backendRevision: fixtureBid ? fixtureBid.revisionNumber : null })
    );

    // ---------------- ITEM 6: document size truth ----------------
    ev("");
    ev("### ITEM 6: document size truth (demo files)");
    await page.goto(`${BASE_URL}/?project=${demoProject._id}&tab=packages`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2200);
    const domFiles = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("h4")].filter((h) => /\.(pdf|txt|dwg|dxf|md)$/i.test(h.textContent || ""));
      return rows.map((h) => {
        const row = h.closest("div.p-4") || h.parentElement.parentElement.parentElement;
        const sizeMatch = (row ? row.innerText : "").match(/([\d.]+) KB/);
        return { name: (h.textContent || "").trim(), labelKB: sizeMatch ? parseFloat(sizeMatch[1]) : null };
      });
    });
    ev(`[6] UI file rows: ${J(domFiles)}`);
    await shot(page, "remediation-qa13-item6-files-list.png");
    const demoFiles = await client.query("files:listFilesByProject", { projectId: demoProject._id });
    const served = [];
    for (const f of demoFiles) {
      if (!f.url || !f.url.startsWith("/")) {
        served.push({ name: f.fileName, backendSize: f.fileSize, servedBytes: null, note: "non-static url" });
        continue;
      }
      const r = await fetch(`${BASE_URL}${f.url}`);
      const buf = Buffer.from(await r.arrayBuffer());
      served.push({ name: f.fileName, backendSize: f.fileSize, servedBytes: buf.length, httpStatus: r.status, match: buf.length === f.fileSize });
    }
    ev(`[6] backend vs served bytes: ${J(served, 1600)}`);
    // UI download of one /specs file via CDP download behavior
    const dlDir = path.join("C:/Users/user/AppData/Local/Temp/opencode", `qa13-downloads-${Date.now()}`);
    fs.mkdirSync(dlDir, { recursive: true });
    let dlResult = null;
    try {
      const cdp = await page.createCDPSession();
      await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir, eventsEnabled: true });
      const dlClick = await page.evaluate(() => {
        const h = [...document.querySelectorAll("h4")].find((x) => (x.textContent || "").includes("26_00_00_Electrical_Systems_Spec.pdf"));
        if (!h) return { ok: false };
        const row = h.closest("div.p-4");
        const btn = [...row.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "").includes("Download file from Convex Storage"));
        if (!btn) return { ok: false, reason: "download button missing" };
        btn.click();
        return { ok: true };
      });
      let dlPath = null;
      for (let i = 0; i < 40 && !dlPath; i++) {
        await sleep(250);
        const entries = fs.readdirSync(dlDir);
        if (entries.length > 0) dlPath = path.join(dlDir, entries[0]);
      }
      if (dlPath) {
        const st = fs.statSync(dlPath);
        dlResult = { clicked: dlClick.ok, file: path.basename(dlPath), bytes: st.size };
      } else {
        dlResult = { clicked: dlClick.ok, file: null, bytes: null, error: "download not captured in 10s" };
      }
      await cdp.detach().catch(() => {});
    } catch (e) {
      dlResult = { error: e.message.split("\n")[0] };
    }
    ev(`[6] UI download result: ${J(dlResult)}`);
    const specBackend = demoFiles.find((f) => f.fileName === "26_00_00_Electrical_Systems_Spec.pdf");
    const domSpec = domFiles.find((d) => d.name === "26_00_00_Electrical_Systems_Spec.pdf");
    const labelMatchesBytes = dlResult && dlResult.bytes !== null && domSpec && domSpec.labelKB !== null && Math.abs(domSpec.labelKB - dlResult.bytes / 1024) < 0.05;
    const backendMatchesBytes = dlResult && dlResult.bytes !== null && specBackend && specBackend.fileSize === dlResult.bytes;
    const allServedMatch = served.every((x) => x.match !== false);
    const item6Ok = !!labelMatchesBytes && !!backendMatchesBytes && allServedMatch;
    record(
      "ITEM 6 document size truth",
      item6Ok ? "PASS" : "FAIL",
      J({ uiLabelKB: domSpec ? domSpec.labelKB : null, downloadedBytes: dlResult && dlResult.bytes, backendFileSize: specBackend ? specBackend.fileSize : null, allStaticDocsServedMatch: allServedMatch, served })
    );

    // ---------------- ITEM 7a: surfaced trace fields ----------------
    ev("");
    ev("### ITEM 7a: Evals & Architecture trace drawer");
    await page.goto(`${BASE_URL}/?tab=diagnostics`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2500);
    await page.waitForFunction(() => document.body.innerText.includes("Case-by-Case Forensic Audit Trail"), { timeout: 20000 }).catch(() => {});
    const inspectClick = await clickButtonByText(page, "Inspect");
    await delay(1200);
    body = await bodyText(page);
    const drawer =
      body.includes("System Prompt") &&
      body.includes("Raw Model Response") &&
      /Cost: \$/.test(body) &&
      body.includes("Execution Trace:");
    ev(`[7a] inspect clicked=${inspectClick.ok}; drawer has SystemPrompt/RawResponse/Cost=${drawer}`);
    await shot(page, "remediation-qa13-item7a-trace-drawer.png");
    record("ITEM 7a trace drawer fields", drawer ? "PASS" : "FAIL", J({ inspectClick: inspectClick.ok, systemPrompt: body.includes("System Prompt"), rawResponse: body.includes("Raw Model Response"), providerCost: /Cost: \$/.test(body) }));

    // ---------------- ITEM 7b: certified RFI shows PM name ----------------
    ev("");
    ev("### ITEM 7b: certified RFI PM name (fixture)");
    await page.goto(`${BASE_URL}/?project=${fixture.clashProjectId}&tab=qna`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2200);
    const rfiSubject = `QA-REM QA13 RFI ${Date.now().toString().slice(-6)}`;
    const rfiFill = await page.evaluate(
      (subjectVal) => {
        const ta = [...document.querySelectorAll("textarea")].find((t) => (t.placeholder || "").includes("Ask a technical"));
        const subjInput = [...document.querySelectorAll("input")].find((i) => (i.placeholder || "").includes("Hoisting responsibility"));
        if (!ta || !subjInput) return { ok: false, reason: "RFI form fields not found" };
        const setI = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        const setT = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setI.call(subjInput, subjectVal);
        subjInput.dispatchEvent(new Event("input", { bubbles: true }));
        subjInput.dispatchEvent(new Event("change", { bubbles: true }));
        setT.call(ta, "Who furnishes the low-voltage BAS control wiring between VAV boxes and the DDC panels? Please confirm scope responsibility.");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      },
      rfiSubject
    );
    ev(`[7b] RFI form fill: ${J(rfiFill)}`);
    const rfiSubmit = await clickButtonByText(page, "Submit RFI for Clarification");
    ev(`[7b] RFI submit: ${J(rfiSubmit)}`);
    let rfiCardSeen = false;
    if (rfiFill.ok && rfiSubmit.ok) {
      rfiCardSeen = await page
        .waitForFunction((subj) => document.body.innerText.includes(subj), { timeout: 60000 }, rfiSubject)
        .then(() => true)
        .catch(() => false);
    }
    await shot(page, "remediation-qa13-item7b-rfi-submitted.png");
    let pmCertifiedSeen = false;
    if (rfiCardSeen) {
      const approve = await clickButtonByText(page, "Approve");
      ev(`[7b] approve click: ${J(approve)}`);
      pmCertifiedSeen = await page
        .waitForFunction(() => document.body.innerText.includes("Certified by Project Manager"), { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
    }
    await delay(800);
    await shot(page, "remediation-qa13-item7b-rfi-pm-certified.png");
    ev(`[7b] RFI card seen=${rfiCardSeen}; 'Certified by Project Manager' visible=${pmCertifiedSeen}`);
    record(
      "ITEM 7b certified RFI PM name",
      pmCertifiedSeen ? "PASS" : rfiCardSeen ? "FAIL" : "BLOCKED",
      J({ rfiFill, rfiSubmit: rfiSubmit.ok, rfiCardSeen, pmCertifiedSeen })
    );

    // ---------------- ITEM 8: Judge Dock copy ----------------
    ev("");
    ev("### ITEM 8: Judge Dock with no package selected");
    await page.goto(`${BASE_URL}/?project=${fixture.emptyProjectId}&tab=packages`, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(1800);
    const dockOpen = await clickButtonByText(page, "60s Judge Dock");
    ev(`[8] dock open: ${J(dockOpen)}`);
    await page.waitForSelector('[role="dialog"][aria-labelledby="judge-dock-title"]', { timeout: 10000 }).catch(() => {});
    await delay(600);
    const dockText = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"][aria-labelledby="judge-dock-title"]');
      return dlg ? dlg.innerText : null;
    });
    const hasNoPackageString = dockText ? dockText.includes("No package selected") : null;
    const targetLine = dockText ? (dockText.split("\n").find((l) => l.includes("Auto-provisioned when the cycle runs")) || null) : null;
    ev(`[8] dockText null=${dockText === null}; contains 'No package selected'=${hasNoPackageString}; graceful target line=${J(targetLine)}`);
    await shot(page, "remediation-qa13-item8-judge-dock-no-package.png");
    const item8Ok = dockText !== null && hasNoPackageString === false && targetLine !== null;
    record("ITEM 8 Judge Dock copy", item8Ok ? "PASS" : "FAIL", J({ dockOpened: dockText !== null, containsNoPackageSelected: hasNoPackageString, targetLine }));

    // ---------------- diag ----------------
    ev("");
    const consoleErrors = diag.consoleLogs.filter((l) => l.type === "error");
    const consoleWarnings = diag.consoleLogs.filter((l) => l.type === "warning");
    ev(`[diag] console errors=${consoleErrors.length} warnings=${consoleWarnings.length} pageerrors=${diag.pageErrors.length} failedRequests=${diag.failedRequests.length}`);
    for (const e of consoleErrors) ev(`  [console.error] ${e.text}`);
    for (const w of consoleWarnings) ev(`  [console.warn] ${w.text}`);
    for (const p of diag.pageErrors) ev(`  [pageerror] ${p}`);
    for (const f of diag.failedRequests) ev(`  [failedRequest] ${f}`);

    ev("");
    ev("=== VERDICT SUMMARY ===");
    for (const r of RESULTS) ev(`${r.item}: ${r.verdict}`);

    const logPath = writeLog("remediation-qa13-verify-log.txt", LOG.concat([`DIAG-JSON: ${J({ consoleErrors: consoleErrors.map((c) => c.text), consoleWarnings: consoleWarnings.map((c) => c.text), pageErrors: diag.pageErrors, failedRequests: diag.failedRequests }, 4000)}`]));
    console.log(`Wrote ${logPath}`);
    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa13-results.json"), JSON.stringify(RESULTS, null, 2), "utf8");
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});