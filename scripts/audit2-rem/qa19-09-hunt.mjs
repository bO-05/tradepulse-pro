/** QA19-09: cross-tab/project selection persistence + clash-free scan copy hunt. */
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, clickTab } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa19-lib.mjs";

const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${JSON.stringify(detail)}`);
};

const pressed = () =>
  [...document.querySelectorAll("button[aria-pressed]")]
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70));

async function main() {
  const c = client();

  // ---- clash-free forensic scan copy ----
  let scan = null;
  try {
    scan = await c.action("coordination:scanCrossTradeClashes", { projectId: F.live.id });
  } catch (e) {
    scan = { error: String(e?.data ?? e?.message).slice(0, 300) };
  }
  const scanText = String(scan?.analysis || scan?.error || "");
  const falseClaim = /\$38,500|\$38\.5k|\$50,500|\$46,500|\$12,000|\$28,000/.test(scanText);
  record("A19-scan.clash-free-no-hardcoded-dollar-claim", !falseClaim, {
    provider: scan?.provider,
    head: scanText.slice(0, 260),
  });
  const out = { scan: { head: scanText.slice(0, 800), falseClaim, error: scan?.error || null } };

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${F.live.id}&tab=discovery&qa19=hunt`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(1500);

  // ---- A: selection persists across tabs ----
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("AUDIT-QA19-LIVE Beta Plumbing"));
    b?.click();
  });
  await delay(1500);
  const afterSelect = await page.evaluate(pressed);
  const tabStates = {};
  for (const tab of ["Bid Leveling", "Pre-Bid Q&A", "Scope Clash", "CSI Scoping"]) {
    await clickTab(page, tab);
    await delay(1500);
    tabStates[tab] = await page.evaluate(pressed);
  }
  const observableTabs = Object.entries(tabStates).filter(([, v]) => v.length > 0);
  const allBeta = observableTabs.every(([, v]) => v.some((t) => t.includes("Beta Plumbing")));
  const coreTabsObservable = tabStates["Bid Leveling"].length > 0 && tabStates["Pre-Bid Q&A"].length > 0;
  record("A19-selection.cross-tab-persists", allBeta && coreTabsObservable, {
    afterSelect,
    observable: Object.keys(Object.fromEntries(observableTabs)),
    tabStates: Object.fromEntries(Object.entries(tabStates).map(([k, v]) => [k, v[0] || null])),
    note: "Scope Clash / CSI Scoping do not render the aria-pressed package ribbon (project-wide or all-packages views)",
  });
  out.tabStates = tabStates;

  // ---- B: cross-project storage does not leak into the active project ----
  await page.goto(`${BASE}/?project=${F.live.id}&tab=discovery&qa19=hunt2`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await delay(1500);
  await page.evaluate((otherPkg) => {
    window.localStorage.setItem("tradepulse.selectedPackageId", otherPkg);
  }, F.sim.p1);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await delay(2500);
  const storedAfter = await page.evaluate(() => localStorage.getItem("tradepulse.selectedPackageId"));
  const pressedAfter = await page.evaluate(pressed);
  const livePkgIds = [F.live.p1, F.live.p2];
  record("A19-selection.cross-project-storage-repaired", storedAfter !== F.sim.p1 && livePkgIds.includes(storedAfter), {
    seeded: F.sim.p1,
    storedAfter,
    pressed: pressedAfter,
  });
  out.crossProject = { storedAfter, pressedAfter };

  // ---- C: switching project resets then back does not resurrect old package ----
  await page.evaluate((projId) => {
    const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    sel.value = projId;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, F.sim.id);
  let simStored = null;
  for (let i = 0; i < 16 && simStored !== F.sim.p1; i++) {
    await delay(500);
    simStored = await page.evaluate(() => localStorage.getItem("tradepulse.selectedPackageId"));
  }
  const simPressed = await page.evaluate(pressed);
  await page.evaluate((projId) => {
    const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    sel.value = projId;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, F.live.id);
  let backStored = null;
  for (let i = 0; i < 16 && !livePkgIds.includes(backStored); i++) {
    await delay(500);
    backStored = await page.evaluate(() => localStorage.getItem("tradepulse.selectedPackageId"));
  }
  const backPressed = await page.evaluate(pressed);
  record("A19-selection.project-switch-consistent", simStored === F.sim.p1 && livePkgIds.includes(backStored), {
    simPressed,
    simStored,
    backPressed,
    backStored,
  });
  out.projectSwitch = { simPressed, simStored, backPressed, backStored };

  out.results = results;
  out.pageErrors = diag.pageErrors.slice(0, 3);
  writeEvidence("hunt", out);
  writeLog("hunt", log);
  await browser.close();
  console.log(`results: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("hunt-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});