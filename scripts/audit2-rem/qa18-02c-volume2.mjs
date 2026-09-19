import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog, client } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = { vol: fx.vol.id, checks: {} };

async function countNeedle(page, needle) {
  return page.evaluate((n) => {
    const text = document.body.innerText;
    let count = 0, idx = 0;
    while ((idx = text.indexOf(n, idx)) !== -1) { count++; idx += n.length; }
    return count;
  }, needle);
}

async function waitText(page, needle, timeout = 30000) {
  const t = Date.now();
  try {
    await page.waitForFunction((nd) => document.body.innerText.includes(nd), { timeout, polling: 150 }, needle);
    return { ok: true, ms: Date.now() - t };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: String(e.message).split("\n")[0] };
  }
}

async function waitCount(page, needle, n, timeout = 30000) {
  const t = Date.now();
  try {
    await page.waitForFunction(
      (nd, want) => {
        const text = document.body.innerText;
        let c = 0, i = 0;
        while ((i = text.indexOf(nd, i)) !== -1) { c++; i += nd.length; }
        return c >= want;
      },
      { timeout, polling: 150 },
      needle,
      n
    );
    return { ok: true, ms: Date.now() - t };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: String(e.message).split("\n")[0] };
  }
}

async function clickPackageRibbon(page, needle) {
  return page.evaluate((nd) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes(nd));
    if (!b) return { ok: false };
    b.scrollIntoView({ inline: "center", block: "nearest" });
    b.click();
    return { ok: true, text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70) };
  }, needle);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function main() {
  const c = client();
  const backendBids = (await c.query("bids:listByPackage", { tradePackageId: fx.vol.mainPackage })).map((b) => ({
    sub: b.subcontractorName,
    base: b.baseBidAmount,
    exclusions: (b.identifiedExclusions || []).reduce((s, x) => (x.isWaived ? s : s + (x.costImpact || 0)), 0),
    ve: (b.valueEngineeringAlternates || []).reduce((s, x) => (x.isAccepted ? s + (x.costDeduct || 0) : s), 0),
    lead: b.leadTimePenalty || 0,
    coi: b.coiPenalty || 0,
    expected: Math.max(0, b.baseBidAmount + (b.identifiedExclusions || []).reduce((s, x) => (x.isWaived ? s : s + (x.costImpact || 0)), 0) + (b.leadTimePenalty || 0) + (b.coiPenalty || 0) - (b.valueEngineeringAlternates || []).reduce((s, x) => (x.isAccepted ? s + (x.costDeduct || 0) : s), 0)),
  }));
  say(`backend main-package bids: ${backendBids.length}`);

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  const t0 = Date.now();
  await page.goto(`${BASE}/?project=${fx.vol.id}&tab=packages&qa18=vol2`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  const bootMs = Date.now() - t0;
  const pkgCount = await countNeedle(page, "AUDIT-QA18-VOL Package");
  say(`boot ${bootMs}ms; packages text occurrences=${pkgCount}`);
  out.checks.packages = { bootMs, occurrences: pkgCount };
  await shot(page, "fix4-qa18-volume-packages.png");

  // ---- Bid Leveling with main package ----
  const tb = Date.now();
  await clickTab(page, "Bid Leveling");
  const lvlChrome = await waitText(page, "Real-Time Forensic Bid Leveling Matrix", 30000);
  const lvlTabMs = Date.now() - tb;
  const pkgClick = await clickPackageRibbon(page, "AUDIT-QA18-VOL Package 10");
  const lvlWait = await waitCount(page, "AUDIT-QA18 VOL Sub", 20, 30000);
  const lvlSubs = await countNeedle(page, "AUDIT-QA18 VOL Sub");
  const badges = await page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b) => (b.textContent || "").replace(/\s+/g, " ").trim()).filter((t) => / Pkgs| Subs| RFIs| Bids| Clashes| Awarded| Clear/.test(t))
  );
  const fit = await page.evaluate(() => {
    const de = document.documentElement;
    const nav = [...document.querySelectorAll("button")].filter((b) => / Pkgs| Subs| RFIs| Bids| Clashes| Awarded| Clear/.test(b.textContent || ""));
    return { vw: de.clientWidth, docScrollW: de.scrollWidth, buttons: nav.map((b) => ({ text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 36), sw: b.scrollWidth, cw: b.clientWidth })) };
  });
  say(`leveling tab chrome ${lvlTabMs}ms; pkgClick=${JSON.stringify(pkgClick)}; 20-subs wait=${JSON.stringify(lvlWait)}; domSubs=${lvlSubs}`);
  say(`badges=${JSON.stringify(badges)}`);
  say(`navFit vw=${fit.vw} docScrollW=${fit.docScrollW} ${JSON.stringify(fit.buttons)}`);
  out.checks.leveling = { tabChromeMs: lvlTabMs, pkgClick, wait: lvlWait, domSubs: lvlSubs, badges, fit };
  await shot(page, "fix4-qa18-volume-leveling.png");

  const junk = await page.evaluate(() => {
    const t = document.body.innerText;
    return { undefined: (t.match(/undefined/g) || []).length, nan: (t.match(/\bNaN\b/g) || []).length, inf: (t.match(/Infinity/g) || []).length };
  });
  out.checks.levelingJunk = junk;

  // ---- CSV ----
  await page.evaluate(() => {
    window.__qa18Csv = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      try { if (blob instanceof Blob && String(blob.type).includes("csv")) blob.text().then((t) => { window.__qa18Csv = t; }); } catch {}
      return orig(blob);
    };
  });
  const csvClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Export Leveling CSV"));
    if (!b) return { ok: false };
    b.click();
    return { ok: true, disabled: b.disabled };
  });
  await page.waitForFunction(() => window.__qa18Csv != null, { timeout: 15000 }).catch(() => {});
  const csv = await page.evaluate(() => window.__qa18Csv);
  if (csv) {
    const rows = parseCsv(csv);
    const data = rows.slice(1);
    const bySub = new Map(data.map((r) => [r[1], r]));
    const mismatches = [];
    for (const b of backendBids) {
      const r = bySub.get(b.sub);
      if (!r) { mismatches.push({ sub: b.sub, reason: "missing row" }); continue; }
      const csvLeveled = Number(r[13]);
      if (csvLeveled !== b.expected) mismatches.push({ sub: b.sub, csv: csvLeveled, expected: b.expected });
    }
    const csvInfo = {
      click: csvClick,
      rowCount: data.length,
      headerCols: rows[0].length,
      mismatches,
      rankCol: data.map((r) => r[0]),
      varianceFirst: data[0][14],
      fileFirstRow: rows[0].slice(0, 4),
    };
    say(`CSV: rows=${data.length} mismatches=${JSON.stringify(mismatches).slice(0, 500)}`);
    out.checks.csv = csvInfo;
  } else {
    say(`CSV capture FAILED click=${JSON.stringify(csvClick)}`);
    out.checks.csv = { click: csvClick, present: false };
  }

  // ---- Discovery with main package ----
  const td = Date.now();
  await clickTab(page, "Discovery");
  const discChrome = await waitText(page, "Select Trade:", 30000);
  const discTabMs = Date.now() - td;
  const dClick = await clickPackageRibbon(page, "AUDIT-QA18-VOL Package 10");
  const dWait = await waitCount(page, "AUDIT-QA18 VOL Sub", 20, 30000);
  const dSubs = await countNeedle(page, "AUDIT-QA18 VOL Sub");
  say(`discovery chrome ${discTabMs}ms; pkgClick=${JSON.stringify(dClick)}; wait=${JSON.stringify(dWait)} domSubs=${dSubs}`);
  out.checks.discovery = { tabChromeMs: discTabMs, pkgClick: dClick, wait: dWait, domSubs: dSubs };
  await shot(page, "fix4-qa18-volume-discovery.png");

  // ---- Remaining tabs quick ----
  for (const label of ["Pre-Bid Q&A", "Scope Clash", "Subcontracts", "Live Activity Audit", "Evals & Architecture"]) {
    const t = Date.now();
    await clickTab(page, label);
    await delay(1200);
    say(`[${label}] settled in ${Date.now() - t}ms`);
    out.checks[`tab_${label.replace(/\W+/g, "")}`] = { settleMs: Date.now() - t };
  }

  out.pageErrors = diag.pageErrors.slice(0, 10);
  out.consoleErrors = diag.consoleLogs.filter((c) => c.type === "error").slice(0, 10);
  out.failedRequests = diag.failedRequests.slice(0, 10);
  say(`pageErrors=${out.pageErrors.length} consoleErrors=${out.consoleErrors.length} failedRequests=${out.failedRequests.length}`);

  writeEvidence("volume2", out);
  writeLog("volume2", log);
  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  writeLog("volume2-crash", [String(e && e.stack ? e.stack : e)]);
  process.exit(1);
});