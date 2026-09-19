import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickButtonByText } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, sleep } from "./qa16-lib.mjs";

const fx = readEvidence("fixtures");
const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = {};
const step = (name, value) => { results[name] = value; say(`[${name}] ${JSON.stringify(value).slice(0, 450)}`); };

async function findProjectByTitle(title) {
  const ps = await c.query("projects:listProjects", {});
  return ps.find((p) => p.title === title);
}

async function main() {
  const journey = await findProjectByTitle("AUDIT-QA16-JOURNEY");
  const jPkgs = await c.query("tradePackages:listByProject", { projectId: journey._id });
  const div01 = jPkgs.find((p) => p.csiDivision === "01 00 00");
  const div26 = jPkgs.find((p) => p.csiDivision === "26 00 00");

  // ---------- 1) clean cold-load performance ----------
  {
    const { browser } = await launchBrowser(1440, 900);
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      window.__qa = { longTasks: [], cls: 0, shifts: [] };
      try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration > 50) window.__qa.longTasks.push(Math.round(e.duration)); }).observe({ entryTypes: ["longtask"] });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (!e.hadRecentInput) { window.__qa.cls += e.value; window.__qa.shifts.push({ v: Number(e.value.toFixed(4)), t: Math.round(e.startTime) }); } } }).observe({ entryTypes: ["layout-shift"] });
      } catch {}
    });
    const t0 = Date.now();
    await page.goto(`https://brainy-skunk-440.convex.site/?project=${fx.projectEdge.id}&tab=packages&qa16=perf`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    const tReady = Date.now() - t0;
    await delay(5000);
    const perf = await page.evaluate(() => ({
      nav: (() => { const n = performance.getEntriesByType("navigation")[0]; return n ? { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), ttfb: Math.round(n.responseStart) } : null; })(),
      fp: performance.getEntriesByName("first-paint")[0]?.startTime ?? null,
      fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
      longTasks: window.__qa.longTasks,
      cls: Number(window.__qa.cls.toFixed(4)),
      topShifts: window.__qa.shifts.sort((a, b) => b.v - a.v).slice(0, 5),
    }));
    step("cold-perf", { timeToAppReadyMs: tReady, ...perf });
    await browser.close();
  }

  // ---------- 2) deceptive banner with correct package ----------
  {
    const { browser } = await launchBrowser(1440, 900);
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((pid) => {
      window.localStorage.setItem("tradepulse.selectedProjectId", pid);
      window.localStorage.setItem("tradepulse.selectedPackageId", pid);
    }, journey._id);
    await page.evaluateOnNewDocument((pkgId) => window.localStorage.setItem("tradepulse.selectedPackageId", pkgId), div01._id);
    await page.goto(`https://brainy-skunk-440.convex.site/?project=${journey._id}&tab=leveling&qa16=deceptive`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(1200);
    const text = await page.evaluate(() => document.querySelector("main")?.innerText || "");
    const active = await page.evaluate(() => (document.querySelector("main")?.innerText || "").match(/Div 01 00 00|Div 26 00 00/) || null);
    step("deceptive-banner", {
      selectedDiv01: Boolean(active),
      hasDeceptive: /Deceptive Low Bid Flagged/i.test(text),
      hasVariance: /\+\$400,000 True Variance/.test(text),
      hasCleanWinner: /Journey Clean Co/.test(text),
      snippet: (text.match(/.{0,120}Deceptive.{0,120}/i) || [null])[0],
    });
    await shot(page, "fix4-qa16-deceptive-banner.png");
    await browser.close();
  }

  // ---------- 3) real mouse double-click on Award (120ms) ----------
  {
    const ctr = await c.mutation("contractors:createContractor", {
      tradePackageId: div26._id, companyName: "AUDIT-QA16 DoubleClick Electric", contactEmail: "qa16.dbl@qa16.invalid",
      phone: "+81 3 5555 0199", licenseNumber: "JP-QA16-9", licenseStatus: "Active / Verified (QA16)", sourceUrl: "https://qa16.example.invalid/dbl", rfqStatus: "invited",
    });
    await c.mutation("bids:submitDirectBid", {
      tradePackageId: div26._id, contractorId: ctr, subcontractorName: "AUDIT-QA16 DoubleClick Electric",
      baseBidAmount: 2_800_000, longLeadEquipmentWeeks: 8, coiComplianceStatus: "compliant",
    });
    await sleep(500);

    const { browser } = await launchBrowser(1440, 900);
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((pkgId) => window.localStorage.setItem("tradepulse.selectedPackageId", pkgId), div26._id);
    await page.goto(`https://brainy-skunk-440.convex.site/?project=${journey._id}&tab=leveling&qa16=dblclick`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(1200);

    const box = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Award Compliant Winner"));
      if (!b) return null;
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: b.disabled, text: b.textContent.trim().slice(0, 60) };
    });
    let after = null;
    if (box) {
      await page.mouse.click(box.x, box.y);
      await delay(120); // realistic fast double click gap
      const state2 = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Award Compliant Winner"));
        return { disabledNow: b ? b.disabled : "gone" };
      });
      await page.mouse.click(box.x, box.y);
      await delay(2500);
      const agrs = await c.query("agreements:listAgreements", { projectId: journey._id });
      const div26Agrs = agrs.filter((a) => a.tradePackageId === div26._id);
      const logs = await c.query("auditLogs:listRecentLogs", { projectId: journey._id, limit: 200 });
      after = {
        disabledBetweenClicks: state2.disabledNow,
        div26AgreementRows: div26Agrs.length,
        statuses: div26Agrs.map((a) => a.status),
        awardLogTitles: logs.filter((l) => /Subcontract Agreement (Awarded|Re-Awarded)/.test(l.title) && /DoubleClick/.test(l.title)).map((l) => l.title),
      };
    }
    step("real-dblclick-award", { box, after });
    await shot(page, "fix4-qa16-dblclick-award.png");
    await browser.close();
  }

  writeEvidence("final-probes", results);
  writeLog("final-probes", log);
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  writeLog("final-probes-crash", [String(e && e.stack ? e.stack : e)]);
  process.exit(1);
});