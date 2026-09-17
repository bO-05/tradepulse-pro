import fs from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  EVIDENCE_DIR,
  launchBrowser,
  waitForAppReady,
  selectProjectByTitle,
  bodyText,
  shot,
  writeLog,
  delay,
} from "./qa1-lib.mjs";

const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};
const checks = {};

const fixtures = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa9-fixtures.json"), "utf8"));
const FIXTURE_TITLE = fixtures.fixture.title;
const DEMO_TITLE = fixtures.demo.title;

const { browser, executablePath } = await launchBrowser();
say(`QA9 PRECISE CLASH/STALE-ERR PROBE at ${new Date().toISOString()}`);
say(`target: ${BASE_URL}`);
say(`executable: ${executablePath}`);

const context = await browser.createBrowserContext();
const page = await context.newPage();

const clickHeaderTab = (label) =>
  page.evaluate((needle) => {
    const header = document.querySelector("header");
    const btn = [...header.querySelectorAll("button")].find((b) => (b.textContent || "").includes(needle));
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true };
  }, label);

const selectAndSettle = async (title, markers) => {
  const res = await selectProjectByTitle(page, title);
  if (!res.ok) throw new Error(`select failed: ${JSON.stringify(res)}`);
  await page.waitForFunction(
    (names) => names.some((n) => document.body.innerText.includes(n)),
    { timeout: 30000 },
    markers
  );
  await delay(1100);
  return res;
};

const clashDomReport = () =>
  page.evaluate(() => {
    const text = document.body.innerText;
    const lower = text.toLowerCase();
    const count = (needle) => lower.split(needle).length - 1;
    const kpiCard = (label) => {
      const span = [...document.querySelectorAll("span")].find((s) => (s.textContent || "").trim() === label);
      if (!span) return null;
      const card = span.closest("div.bg-slate-900");
      return card ? card.innerText.replace(/\n+/g, " | ") : null;
    };
    const h4s = [...document.querySelectorAll("main h4")].map((h) => (h.textContent || "").trim());
    const tourBar = [...document.querySelectorAll("div")].find((d) =>
      (d.className || "").toString().includes("border-emerald-800")
    );
    const tourText = tourBar ? tourBar.innerText.replace(/\n+/g, " | ") : null;
    return {
      viewHeadingPresent: text.includes("Cross-Trade Scope Clash & Double-Buy Detection"),
      redundantBadgeCount: count("redundant double-buy detected"),
      deductedBadgeCount: count("credit deducted & leveled"),
      has50500: text.includes("$50,500"),
      has46500: text.includes("$46,500"),
      h4s,
      kpi: {
        doubleBuys: kpiCard("Redundant Double-Buys"),
        voids: kpiCard("Unassigned Scope Voids"),
        credits: kpiCard("Recoverable Buyout Credits"),
        risk: kpiCard("Coordination Risk Level"),
      },
      tourBarExists: !!tourBar,
      tourTextSnippet: tourText ? tourText.slice(0, 220) : null,
    };
  });

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1300);

  // dismiss tour bar so its narration cannot pollute later text checks (UI-level, no app source change)
  const tourDismissed = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").toLowerCase().includes("dismiss") || (b.textContent || "").trim() === "✕" && b.closest("div") && (b.closest("div").className || "").toString().includes("emerald"));
    if (btn) {
      btn.click();
      return { ok: true, label: btn.getAttribute("aria-label") || (btn.textContent || "").trim() };
    }
    return { ok: false };
  });
  say(`tour bar dismiss attempt: ${JSON.stringify(tourDismissed)}`);
  await delay(600);

  // ---------- EMPTY FIXTURE ----------
  say("\n----- EMPTY FIXTURE Scope Clash (precise DOM) -----");
  const selFix = await selectAndSettle(FIXTURE_TITLE, ["No Trade Packages Configured", "0 Pkgs", "QA-REM-QA9-CLASH"]);
  say(`selected: ${JSON.stringify({ text: selFix.text })}`);
  await clickHeaderTab("Scope Clash");
  await delay(1400);
  const fx = await clashDomReport();
  say(`empty fixture DOM report: ${JSON.stringify(fx, null, 2)}`);
  await shot(page, "remediation-qa9-09-clash-empty-fixture-precise.png");

  checks.emptyViewRendered = fx.viewHeadingPresent ? "PASS" : "FAIL";
  checks.emptyNoClashCards = fx.redundantBadgeCount === 0 && fx.h4s.length === 0 ? "PASS" : "FAIL";
  checks.emptyNoDemoAmounts = !fx.has50500 && !fx.has46500 ? "PASS" : "FAIL";
  checks.emptyKpiZero = /Redundant Double-Buys \| \$0 \| 0 equipment items priced by both trades/.test(fx.kpi.doubleBuys || "")
    ? "PASS"
    : "FAIL";
  checks.emptyVoidZero = /Unassigned Scope Voids \| \$0 \| 0 critical gaps excluded by both trades/.test(fx.kpi.voids || "") ? "PASS" : "FAIL";
  checks.emptyRiskResolved = /Coordination Risk Level \| Resolved \| 0 items awaiting resolution/.test(fx.kpi.risk || "") ? "PASS" : "FAIL";

  // ---------- DEMO ----------
  say("\n----- DEMO Scope Clash (precise DOM) -----");
  const selDemo = await selectAndSettle(DEMO_TITLE, ["$50,500", "Electrical & Lighting Systems", "Heating, Ventilating"]);
  say(`selected: ${JSON.stringify({ text: selDemo.text })}`);
  await clickHeaderTab("Scope Clash");
  await delay(1400);
  const dm = await clashDomReport();
  say(`demo DOM report: ${JSON.stringify(dm, null, 2)}`);
  await shot(page, "remediation-qa9-10-clash-demo-precise.png");

  checks.demoViewRendered = dm.viewHeadingPresent ? "PASS" : "FAIL";
  checks.demoTwoDoubleBuyCards =
    dm.redundantBadgeCount === 2 &&
    dm.h4s.some((t) => t.includes("Variable Frequency Drives (VFDs) for AHUs & Pumps")) &&
    dm.h4s.some((t) => t.includes("Rooftop Mechanical Equipment Disconnect Switches"))
      ? "PASS"
      : "FAIL";
  checks.demoTwoVoidCards =
    dm.h4s.some((t) => t.includes("Low-Voltage 24V BAS Control")) &&
    dm.h4s.some((t) => t.includes("Duct Smoke Detector Installation")) &&
    dm.kpi.voids &&
    dm.kpi.voids.includes("2 critical gaps excluded by both trades")
      ? "PASS"
      : "FAIL";
  checks.demoAmounts = dm.has50500 && dm.has46500 ? "PASS" : "FAIL";

  // ---------- STALE ERROR (dialog-scoped) ----------
  say("\n----- STALE ERROR dialog-scoped -----");
  const openRes = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("New Project"));
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
  await delay(700);
  await page.evaluate(() => {
    const labels = [...document.querySelectorAll("label")];
    const lab = labels.find((l) => (l.textContent || "").trim().startsWith("Project Title"));
    const el = lab.parentElement.querySelector("input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, "   ");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const submitRes = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Create Commercial Project"));
    b.click();
    return { ok: true };
  });
  await delay(900);
  const dialogAfterSubmit = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return { dialogFound: false };
    const errP = [...dlg.querySelectorAll("p")].map((p) => (p.textContent || "").trim()).filter(Boolean);
    return { dialogFound: true, errorParagraphs: errP };
  });
  say(`open=${JSON.stringify(openRes)} submit=${JSON.stringify(submitRes)}`);
  say(`dialog after whitespace submit: ${JSON.stringify(dialogAfterSubmit)}`);
  checks.dialogErrShown = dialogAfterSubmit.errorParagraphs.includes("Project title is required.") ? "PASS" : "FAIL";
  await shot(page, "remediation-qa9-11-staleerr-shown-precise.png");

  await page.evaluate(() => document.querySelector('button[aria-label="Close new project dialog"]').click());
  await delay(600);
  const modalClosed = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
  const reopen = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("New Project"));
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
  await delay(700);
  const dialogReopened = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return { dialogFound: false };
    const errP = [...dlg.querySelectorAll("p")].map((p) => (p.textContent || "").trim()).filter(Boolean);
    const titleInput = (() => {
      const labels = [...dlg.querySelectorAll("label")];
      const lab = labels.find((l) => (l.textContent || "").trim().startsWith("Project Title"));
      return lab ? lab.parentElement.querySelector("input").value : null;
    })();
    return { dialogFound: true, errorParagraphs: errP, titleInput };
  });
  say(`modal closed=${modalClosed}; reopen=${JSON.stringify(reopen)}`);
  say(`dialog after reopen: ${JSON.stringify(dialogReopened)}`);
  checks.staleErrGone = modalClosed && reopen.ok && dialogReopened.dialogFound && dialogReopened.errorParagraphs.length === 0 ? "PASS" : "FAIL";
  await shot(page, "remediation-qa9-12-staleerr-reopened-precise.png");

  const overall = Object.values(checks).every((v) => v === "PASS") ? "PASS" : "FAIL";
  say(`\nCHECKS: ${JSON.stringify(checks, null, 2)}`);
  say(`PRECISE PROBE RESULT: ${overall}`);
  writeLog("remediation-qa9-03-precise-log.txt", log);
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  writeLog("remediation-qa9-03-precise-log.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
}