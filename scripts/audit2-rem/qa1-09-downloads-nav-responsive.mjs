import fs from "node:fs";
import path from "node:path";
import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, writeLog, delay,
} from "./lib.mjs";
import {
  findButton, findField, findHandles, realClick, clickConfirm, selectProject, clickTab,
  waitForText, dismissTour, getToast, typeInto,
} from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const BASE = "https://brainy-skunk-440.convex.site/";
const EV = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/evidence";
const DL = path.join(EV, "fix4-qa1-downloads");
fs.mkdirSync(DL, { recursive: true });
const TITLE = "AUDIT-QA1-BIDS-2026-09-18";
const PKG_NAME = "AUDIT-QA1 Electrical";
const R = { startedAt: new Date().toISOString() };
const log = [];
const L = (m) => { log.push(`[${new Date().toISOString()}] ${m}`); console.log(m); };
const q = async (fn, tries = 6) => { let last; for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; await delay(1500); } } throw last; };

const TABS = ["packages", "discovery", "qna", "leveling", "coordination", "contracts", "audit", "diagnostics"];
const TAB_MARKERS = {
  packages: "CSI MasterFormat Trade Packages",
  discovery: "Discovery",
  qna: "Pre-Bid",
  leveling: "Real-Time Forensic Bid Leveling Matrix",
  coordination: "Clash",
  contracts: "Subcontract",
  audit: "Audit",
  diagnostics: "Evals",
};

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const timings = [];
  let reqStart = new Map();
  page.on("request", (r) => reqStart.set(r, Date.now()));
  page.on("requestfinished", (r) => { const t = reqStart.get(r); if (t) timings.push({ url: r.url().slice(0, 120), ms: Date.now() - t }); });
  const client = await page.target().createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL }).catch(() => {});

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await dismissTour(page);
    await selectProject(page, TITLE);
    await delay(2500);
    await dismissTour(page);
    const projects = await q(() => http.query("projects:listProjects", {}));
    const proj = projects.find((p) => p.title === TITLE);
    const pkgs = await q(() => http.query("tradePackages:listByProject", { projectId: proj._id }));
    const pkg = pkgs.find((p) => p.tradeName === PKG_NAME);
    R.projectId = proj._id;

    // ---------- A) RFI refresh mid-flight
    await clickTab(page, "03:");
    await delay(2500);
    await dismissTour(page);
    const subj = await findField(page, "e.g. Hoisting responsibility for switchgear");
    const question = await findField(page, "Ask a technical or scope coordination question");
    if (subj && question) {
      await typeInto(page, subj, "QA1 midflight RFI");
      await typeInto(page, question, "Does the Division 26 scope include rooftop switchgear crane hoisting and street closure permits, and are seismic bracing calculations included?");
      const submitRfi = await findButton(page, "Submit RFI for Clarification");
      R.rfiSubmitClick = await realClick(page, submitRfi);
      await delay(2500);
      await page.evaluate(() => window.location.reload()).catch(() => {});
      await delay(6000);
      await waitForAppReady(page, 60000).catch(() => {});
      await delay(55000);
      const convos = await q(() => http.query("rfq:listConversations", { tradePackageId: pkg._id }));
      R.refreshRfi = {
        found: convos.filter((c) => (c.inboundSubject || "").includes("midflight RFI")).map((c) => ({ id: c._id, status: c.status, error: c.analysisError || null, replyLen: (c.autonomousReply || "").length })),
        total: convos.length,
        statuses: convos.slice(0, 6).map((c) => c.status),
      };
      const ui = await page.evaluate(() => {
        const t = document.body.innerText;
        return { showsPending: /pending analysis/i.test(t), showsFailed: /failed analysis|analysis failed/i.test(t), showsRetry: /Retry/.test(t), showsClarified: /clarified/i.test(t) };
      });
      R.refreshRfi.ui = ui;
      await shot(page, "fix4-qa1-dl-01-rfi-after-refresh.png", { full: true });
    } else {
      R.refreshRfi = { error: "fields not found" };
    }
    L("rfi refresh: " + JSON.stringify(R.refreshRfi?.found));

    // ---------- B) Export Leveling CSV
    await clickTab(page, "04:");
    await delay(2200);
    await dismissTour(page);
    const before = await q(() => http.query("bids:listAllProjectBids", { projectId: proj._id }));
    const pkgBids = before.filter((b) => b.tradePackageId === pkg._id);
    R.exportClick = await findButton(page, "Export Leveling CSV");
    R.exportClickOk = R.exportClick ? await realClick(page, R.exportClick) : null;
    await delay(4000);
    const files = fs.existsSync(DL) ? fs.readdirSync(DL).filter((f) => f.endsWith(".csv")) : [];
    R.csvFiles = files;
    if (files.length) {
      const raw = fs.readFileSync(path.join(DL, files[files.length - 1]), "utf8");
      const parseCsv = (text) => {
        const rows = []; let row = []; let cell = ""; let inQ = false;
        for (let i = 0; i < text.length; i++) {
          const c = text[i];
          if (inQ) {
            if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (c === '"') inQ = false;
            else cell += c;
          } else if (c === '"') inQ = true;
          else if (c === ",") { row.push(cell); cell = ""; }
          else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
          else cell += c;
        }
        if (cell || row.length) { row.push(cell); rows.push(row); }
        return rows;
      };
      const rows = parseCsv(raw);
      R.csv = {
        bytes: raw.length,
        lines: raw.split("\n").length,
        parsedRows: rows.length,
        headerCols: rows[0]?.length,
        expectedRows: pkgBids.length + 1,
        rowCols: rows.slice(1).map((r) => r.length),
        names: rows.slice(1).map((r) => r[1]),
        leveled: rows.slice(1).map((r) => Number(r[13])),
        backendNames: pkgBids.map((b) => b.subcontractorName),
        backendLeveled: pkgBids.map((b) => b.leveledTotalCost),
      };
      R.csv.match = JSON.stringify([...R.csv.names].sort()) === JSON.stringify([...R.csv.backendNames].sort());
    }

    // ---------- C) Deep links + Back/Forward per tab
    await clickTab(page, "01:");
    await delay(1200);
    await clickTab(page, "04:");
    await delay(1200);
    R.deep = {};
    for (const tab of TABS) {
      await page.goto(`${BASE}?project=${proj._id}&tab=${tab}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForAppReady(page, 60000);
      await delay(1600);
      R.deep[tab] = await page.evaluate((marker) => {
        const active = [...document.querySelectorAll("button")].find((b) => (b.className || "").includes("ring-1") && (b.getAttribute("title") || "").includes(":"));
        return {
          url: location.search,
          activeTitle: active ? active.getAttribute("title").split(" - ")[0] : null,
          hasMarker: document.body.innerText.includes(marker),
          bodyLen: document.body.innerText.length,
        };
      }, TAB_MARKERS[tab]);
    }
    // invalid tab fallback
    await page.goto(`${BASE}?project=${proj._id}&tab=bogus`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 60000);
    await delay(1200);
    R.deep.invalidTab = await page.evaluate(() => {
      const active = [...document.querySelectorAll("button")].find((b) => (b.className || "").includes("ring-1") && (b.getAttribute("title") || "").includes(":"));
      return { url: location.search, activeTitle: active ? active.getAttribute("title").split(" - ")[0] : null };
    });
    // back/forward
    await page.goto(`${BASE}?project=${proj._id}&tab=leveling`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await clickTab(page, "06:");
    await delay(1400);
    R.historyAfterClick = await page.evaluate(() => location.search);
    await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
    await delay(1800);
    R.historyBack = await page.evaluate(() => ({ search: location.search, hasLeveling: document.body.innerText.includes("Real-Time Forensic Bid Leveling Matrix") }));
    await page.goForward({ waitUntil: "domcontentloaded" }).catch(() => {});
    await delay(1800);
    R.historyForward = await page.evaluate(() => ({ search: location.search, hasContracts: document.body.innerText.includes("Subcontract") }));
    // reload persistence
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1500);
    R.reloadPersistence = await page.evaluate(() => ({
      search: location.search,
      projectSelect: document.querySelector('select[aria-label="Select Commercial Construction Project"]')?.selectedOptions[0]?.textContent.trim(),
    }));

    // ---------- D) Responsive / zoom per tab
    R.responsive = {};
    for (const tab of TABS) {
      await page.goto(`${BASE}?project=${proj._id}&tab=${tab}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForAppReady(page);
      await delay(1300);
      await page.setViewport({ width: 375, height: 800, deviceScaleFactor: 1 });
      await delay(700);
      const wide = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth - window.innerWidth;
        const clipped = [];
        for (const b of document.querySelectorAll("button, select, input, a")) {
          const r = b.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && (r.right > window.innerWidth + 3 || r.left < -3)) {
            const label = (b.getAttribute("title") || b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 40);
            if (label) clipped.push({ label, left: Math.round(r.left), right: Math.round(r.right) });
          }
        }
        return { overflow, clipped: clipped.slice(0, 8), clippedCount: clipped.length };
      });
      await page.setViewport({ width: 720, height: 450, deviceScaleFactor: 1 });
      await delay(700);
      const zoom = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      R.responsive[tab] = { overflow375: wide.overflow, clippedCount: wide.clippedCount, clipped: wide.clipped, overflowZoom200: zoom };
      if (tab === "leveling" && wide.overflow > 0) await shot(page, "fix4-qa1-dl-02-leveling-375.png", { full: true });
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      await delay(400);
    }

    // ---------- E) Network summary
    const dupes = {};
    for (const t of timings) { const key = t.url; dupes[key] = (dupes[key] || 0) + 1; }
    R.network = {
      totalRequests: timings.length,
      slow: timings.filter((t) => t.ms > 2000).slice(0, 15),
      duplicates: Object.entries(dupes).filter(([, n]) => n > 1).slice(0, 20).map(([url, n]) => ({ url, n })),
      failed: diag.failedRequests.slice(0, 10),
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 180)).slice(0, 15),
      consoleWarnings: diag.consoleLogs.filter((l) => l.type === "warning").map((l) => l.text.slice(0, 150)).slice(0, 10),
      pageErrors: diag.pageErrors.slice(0, 8),
    };
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    await shot(page, "fix4-qa1-dl-error.png", { full: true }).catch(() => {});
  } finally {
    await browser.close();
    writeJson("fix4-qa1-downloads-nav-responsive.json", R);
    writeLog("fix4-qa1-downloads-nav-responsive.log", log);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 18000));
};
run();