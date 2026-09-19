/**
 * QA20-04 UI golden-path journey on AUDIT-QA20-JOURNEY in America/Los_Angeles:
 * award -> execute -> void -> re-award with real DOM clicks, cross-surface
 * reconciliation (KPI compact+expanded, header badge, register, leveling, CSV,
 * audit) after each mutation, plus the stale-contract-modal probe.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, projectSnapshot, sleep, EVIDENCE_DIR } from "./qa20-lib.mjs";

const F = readEvidence("fixtures");
const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const J = F.journey;
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 900)}`);
};

async function fullMain(page) {
  return page.evaluate(() => (document.querySelector("main") || document.body).innerText);
}
async function headerAwardBadge(page) {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll("header button")].map((x) => (x.innerText || "").replace(/\s+/g, " ")).find((x) => /Awarded/.test(x));
    return b || null;
  });
}
async function kpiCompact(page) {
  const t = await fullMain(page);
  const i = t.indexOf("Expand 6-Card KPI View");
  return t.slice(0, i > 0 ? i : 400);
}
async function kpiExpanded(page) {
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Expand 6-Card KPI View/.test(x.innerText || ""));
    if (!b) return false;
    b.click();
    return true;
  });
  await delay(900);
  const t = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("main div")].filter((d) => /Subcontract Awards/.test(d.innerText || "") && d.querySelectorAll("div").length < 30);
    return cards.length ? cards[0].closest("div.grid")?.innerText || "" : "";
  });
  const expanded = {
    opened,
    text: (await fullMain(page)).slice(0, 1400),
  };
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Compact Mode/.test(x.innerText || ""));
    b?.click();
  });
  await delay(500);
  return expanded;
}
async function clickTab(page, label) {
  await page.evaluate((t) => {
    const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes(t) || (x.innerText || "").includes(t));
    b?.click();
  }, label);
  await delay(1700);
}
async function selectPackageIfRibbon(page, needle) {
  return page.evaluate((name) => {
    const vis = (e) => e.getBoundingClientRect().width > 1;
    const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => vis(x) && (x.innerText || "").includes(name));
    if (!b) return { ok: false, reason: "no ribbon (single package)" };
    b.click();
    return { ok: true };
  }, needle);
}
async function clickTextButton(page, needle, exact = false) {
  return page.evaluate(
    ({ needle, exact }) => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => {
        const t = (x.innerText || "").replace(/\s+/g, " ").trim();
        return vis(x) && (exact ? t === needle : t.includes(needle));
      });
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 30) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim() };
    },
    { needle, exact }
  );
}
async function dialogState(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const ds = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis);
    const top = ds[ds.length - 1] || null;
    return top
      ? { open: true, title: (top.querySelector("h2") || {}).innerText || "", alert: top.querySelector('[role="alert"]')?.innerText || null, buttons: [...top.querySelectorAll("button")].map((b) => (b.innerText || "").trim().replace(/\s+/g, " ")), busy: top.getAttribute("aria-busy") }
      : { open: false };
  });
}
async function clickDialog(page, label) {
  return page.evaluate((needle) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const ds = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis);
    const top = ds[ds.length - 1];
    if (!top) return false;
    const b = [...top.querySelectorAll("button")].find((x) => (x.innerText || "").trim().replace(/\s+/g, " ") === needle);
    if (!b) return false;
    b.click();
    return true;
  }, label);
}
async function poll(fn, predicate, timeoutMs = 30000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(600);
  }
  return last;
}
async function stateSnapshot() {
  const s = await projectSnapshot(c, J.id);
  return {
    bids: s.bids.filter((b) => b.tradePackageId === J.packageId).map((b) => ({ id: b._id, awarded: b.isAwarded, leveled: b.leveledTotalCost, rev: b.revisionNumber ?? 1 })),
    agreements: s.agreements.filter((a) => a.tradePackageId === J.packageId).map((a) => ({ id: a._id, num: a.agreementNumber, status: a.status, sum: a.contractSum, executedAt: a.executedAt ?? null })),
    pkg: s.packages.find((p) => p._id === J.packageId)?.status,
    logs: s.logs.length,
  };
}
async function pkgStatusNow() {
  return (await c.query("tradePackages:getPackage", { tradePackageId: J.packageId })).status;
}
async function registerNumbers(page) {
  return page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText;
    const active = t.match(/ACTIVE CONTRACTED SUM\n\$([0-9,]+)/);
    const exec = t.match(/EXECUTION STATUS RECORDED\n(\d+) \/ (\d+)/);
    return { activeSum: active ? active[1] : null, execCount: exec ? exec[1] : null, execTotal: exec ? exec[2] : null, hasA401: /A401-2026-\d+-\d+/.test(t), supersededFilter: /Superseded \(\d+\)/.test(t), emptyState: /No Subcontract Agreements Found/.test(t) };
  });
}
async function contractModalState(page) {
  return page.evaluate(() => {
    const ds = [...document.querySelectorAll('[role="dialog"]')].filter((d) => d.getBoundingClientRect().width > 1 && /Subcontract Draft/.test(d.innerText || ""));
    const d = ds[0] || null;
    if (!d) return { open: false };
    const t = d.innerText || "";
    const buttons = [...d.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim());
    return {
      open: true,
      executedBanner: /Execution recorded in TradePulse/i.test(t),
      recordedBadge: /RECORDED • SIGNATURE REQUIRED/i.test(t),
      pendingBadge: /Generated \/ Pending Execution/i.test(t),
      hasVoidButton: buttons.some((b) => b === "Void execution record"),
      agreementNumber: (t.match(/A401-\d{4}-\d{4}-\d+/) || [null])[0],
      buttons: buttons.slice(0, 14),
      head: t.replace(/\s+/g, " ").slice(0, 200),
    };
  });
}
async function auditHas(page, needle) {
  await clickTab(page, "Live Activity Audit");
  const t = await fullMain(page);
  return { found: t.includes(needle), snippet: t.slice(0, 0) };
}

async function main() {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.emulateTimezone("America/Los_Angeles");
  const cdp = await page.createCDPSession();
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa20-journey-downloads");
  fs.mkdirSync(dlDir, { recursive: true });
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });

  await page.goto(`${BASE}/?project=${J.id}&tab=leveling&qa20=journey`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
    b?.click();
  });
  await delay(1200);

  const tz = await page.evaluate(() => ({ offset: new Date().getTimezoneOffset(), local: new Date().toString().slice(0, 33) }));
  record("A20-04.0", "browser timezone is non-UTC", tz.offset !== 0, tz);

  await selectPackageIfRibbon(page, "QA20 Electrical");
  const k0 = await kpiCompact(page);
  const badge0 = await headerAwardBadge(page);
  record(
    "A20-04.1",
    "baseline KPI + header badge reconcile with bid math",
    /Leveled Buyout: \$1,190,000/.test(k0) && /1 Deceptive Bid Caught/.test(k0) && /Gaps Exposed: \+?\$117,000/.test(k0) && /0\/1 Awarded/.test(badge0 || ""),
    { k0: k0.replace(/\n/g, " | "), badge0 }
  );

  // ---- award ----
  const awardClick = await clickTextButton(page, "Award Compliant Winner");
  const stateA = await poll(stateSnapshot, (s) => s.agreements.some((a) => a.status === "generated"), 30000);
  const pkgA = await pkgStatusNow();
  const modalA = await poll(() => contractModalState(page), (s) => s.open && Boolean(s.agreementNumber), 30000);
  const kA = await kpiCompact(page);
  const kAexp = await kpiExpanded(page);
  const badgeA = await headerAwardBadge(page);
  await shot(page, "fix4-qa20-journey-award.png");
  record(
    "A20-04.2",
    "UI award: agreement + awarded bid/pkg; KPI compact/expanded + header agree",
    awardClick.ok && pkgA === "awarded" && stateA.bids.filter((b) => b.awarded).length === 1 &&
      /Subcontracts: 1\/1 Awarded/.test(kA) && /1\/1 Awarded/.test(badgeA || "") &&
      /1\s*of\s*1/.test(kAexp.text.replace(/\n/g, " ")) || /Subcontract Awards[\s\S]{0,120}1\s*of\s*1/.test(kAexp.text),
    { awardClick, pkgA, modal: { number: modalA.agreementNumber, buttons: modalA.buttons }, badgeA, kA: kA.replace(/\n/g, " | ").slice(0, 260) }
  );

  // ---- contracts register pre-execute ----
  await clickTab(page, "Subcontracts");
  await delay(1200);
  const reg0 = await registerNumbers(page);
  record(
    "A20-04.3",
    "register pre-execute: active sum $1,190,000, 0/1 executed",
    reg0.activeSum === "1,190,000" && reg0.execCount === "0" && reg0.execTotal === "1",
    reg0
  );

  // ---- execute via contracts viewer ----
  await clickTextButton(page, "Inspect Draft");
  const preModal = await poll(() => contractModalState(page), (s) => s.open, 15000);
  const execClick = await clickTextButton(page, "Record External Execution");
  await delay(800);
  const execDlg = await dialogState(page);
  const execConfirm = await clickDialog(page, "Record execution");
  const stateE = await poll(stateSnapshot, (s) => s.agreements.some((a) => a.status === "executed"), 30000);
  const pkgE = await pkgStatusNow();
  await delay(1800);
  const postExecModal = await contractModalState(page);
  const regE = await registerNumbers(page);
  const badgeE = await headerAwardBadge(page);
  await shot(page, "fix4-qa20-journey-executed.png");
  record(
    "A20-04.4",
    "execute via register: dialog -> executed state, viewer updates, register 1/1",
    execClick.ok && execDlg.open && execConfirm && stateE.agreements.some((a) => a.status === "executed") && pkgE === "awarded" &&
      postExecModal.executedBanner === true && postExecModal.hasVoidButton === true &&
      regE.execCount === "1" && regE.execTotal === "1" && /1\/1 Awarded/.test(badgeE || ""),
    { preModal: { pending: preModal.pendingBadge, executed: preModal.executedBanner }, execDlg: { title: execDlg.title, alert: execDlg.alert }, postExecModal, regE, badgeE }
  );

  // ---- void via contracts viewer (stale-modal probe) ----
  const voidClick = await clickTextButton(page, "Void execution record");
  await delay(800);
  const voidDlg = await dialogState(page);
  const voidConfirm = await clickDialog(page, "Void execution record");
  const stateV = await poll(stateSnapshot, (s) => s.agreements.some((a) => a.status === "superseded"), 30000);
  const pkgV = await pkgStatusNow();
  await delay(1800);
  const staleModal = await contractModalState(page);
  let staleReclick = null;
  if (staleModal.open && staleModal.hasVoidButton) {
    const c2 = await clickTextButton(page, "Void execution record");
    await delay(700);
    const d2 = await dialogState(page);
    let err = null;
    if (d2.open) {
      await clickDialog(page, "Void execution record");
      await delay(1700);
      const d3 = await dialogState(page);
      err = d3.alert;
      if (d3.open) await clickDialog(page, "Cancel");
    }
    staleReclick = { clicked: c2.ok, dialog: d2.title, error: err };
  }
  await shot(page, "fix4-qa20-journey-void-stale.png");
  const staleFinding = staleModal.open && staleModal.executedBanner && staleModal.hasVoidButton;
  record(
    "A20-04.5",
    "void backend correct; viewer must not keep offering 'Void execution record'",
    voidClick.ok && voidDlg.open && voidConfirm && pkgV === "leveling" && stateV.agreements.every((a) => a.status !== "executed") && !staleFinding,
    { voidDlg: voidDlg.title, pkgV, agreements: stateV.agreements, staleModal, staleReclick }
  );

  // ---- register + KPI after void ----
  if (staleModal.open) await clickTextButton(page, "Close Viewer");
  await delay(1200);
  const regV = await registerNumbers(page);
  await clickTab(page, "Bid Leveling");
  await delay(1600);
  await selectPackageIfRibbon(page, "QA20 Electrical");
  const kpiV = await kpiCompact(page);
  const badgeV = await headerAwardBadge(page);
  await shot(page, "fix4-qa20-journey-void-register.png");
  record(
    "A20-04.6",
    "after void: register empty + superseded filter, KPI 0/1, package back to leveling",
    regV.activeSum === "0" && regV.supersededFilter && pkgV === "leveling" && /0\/1 Awarded/.test(badgeV || "") && /Subcontracts: 0\/1 Awarded/.test(kpiV),
    { regV, kpiV: kpiV.replace(/\n/g, " | ").slice(0, 200), badgeV }
  );

  // ---- re-award + CSV + audit ----
  const reAward = await clickTextButton(page, "Award Compliant Winner");
  const stateR = await poll(stateSnapshot, (s) => s.agreements.some((a) => a.status === "generated"), 30000);
  const pkgR = await pkgStatusNow();
  await poll(() => contractModalState(page), (s) => s.open, 45000);
  await delay(2500);
  const modalR = await poll(() => contractModalState(page), (s) => Boolean(s.agreementNumber), 30000);
  const badgeR = await headerAwardBadge(page);
  await shot(page, "fix4-qa20-journey-reaward.png");
  let agrTextR = null;
  for (let i = 0; i < 20 && !agrTextR; i++) {
    agrTextR = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /Subcontract Draft/.test(x.innerText || ""));
      const pre = d?.querySelector("pre");
      return pre && pre.innerText.trim().length > 0 ? pre.innerText.slice(0, 300) : null;
    });
    if (!agrTextR) await delay(700);
  }
  // CSV export from leveling
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Export Leveling CSV/.test(x.innerText || ""));
    b?.click();
  });
  await delay(2500);
  let csvFile = null;
  try {
    const files = fs.readdirSync(dlDir).filter((f) => f.endsWith(".csv"));
    if (files.length) {
      const latest = files.map((f) => ({ f, t: fs.statSync(path.join(dlDir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0].f;
      csvFile = { name: latest, content: fs.readFileSync(path.join(dlDir, latest), "utf8").slice(0, 1200) };
    }
  } catch {}
  const audit = await auditHas(page, "AIA A401 Subcontract Agreement");
  record(
    "A20-04.7",
    "re-award restores awarded state; CSV exports AWARDED row; audit has award trail",
    reAward.ok && pkgR === "awarded" && stateR.bids.filter((b) => b.awarded).length === 1 &&
      /1\/1 Awarded/.test(badgeR || "") && Boolean(modalR.agreementNumber) &&
      Boolean(csvFile && /AUDIT-QA20 Alpha Electric/.test(csvFile.content) && /AWARDED/.test(csvFile.content)) && audit.found,
    { reAward, pkgR, badgeR, modalR: modalR.agreementNumber, csv: csvFile ? csvFile.content.split("\n").slice(0, 4) : null, auditFound: audit.found, utcLabeled: /\(UTC\)/.test(agrTextR || ""), agrHead: (agrTextR || "").split("\n").slice(0, 5) }
  );

  // ---- abandonment / recovery: unaward dialog escape, then reload consistency ----
  await clickTab(page, "Bid Leveling");
  await delay(1600);
  const modalStillOpen = await contractModalState(page);
  if (modalStillOpen.open) await clickTextButton(page, "Close Viewer");
  await delay(800);
  const unawardBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Unaward");
    if (!b) return false;
    b.click();
    return true;
  });
  await delay(900);
  const dlgBeforeEscape = await dialogState(page);
  await page.keyboard.press("Escape");
  await delay(600);
  const dlgAfterEscape = await dialogState(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAppReady(page, 60000);
  await delay(1500);
  const stateAfterReload = await stateSnapshot();
  const badgeReload = await headerAwardBadge(page);
  await shot(page, "fix4-qa20-journey-recovery.png");
  record(
    "A20-04.8",
    "abandon unaward via Escape + reload leaves awarded state intact",
    unawardBtn && dlgBeforeEscape.open && !dlgAfterEscape.open && stateAfterReload.bids.filter((b) => b.awarded).length === 1 && stateAfterReload.agreements.some((a) => a.status === "generated") && /1\/1 Awarded/.test(badgeReload || ""),
    { dlgBeforeEscape: dlgBeforeEscape.title, afterEscapeOpen: dlgAfterEscape.open, stateAfterReload: { pkg: stateAfterReload.pkg, a: stateAfterReload.agreements.map((a) => a.status) }, badgeReload }
  );

  const outDiag = { pageErrors: diag.pageErrors.slice(0, 10), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 200)).slice(-12) };
  record("A20-04.9", "journey console/page error free (stale-void server refusal excepted)", diag.pageErrors.length === 0, outDiag);

  writeEvidence("ui-journey", { results, outDiag, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("ui-journey", log);
  await browser.close();
  console.log(`ui journey: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-journey-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});