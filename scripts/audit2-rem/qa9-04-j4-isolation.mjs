/**
 * QA9 Journey 4: cross-project isolation — create a second fixture via UI, verify
 * counts, package selectors, KPI band and CSV export never leak across projects.
 * Evidence: evidence/fix4-qa9-j4-*.json + downloaded CSV
 */
import fs from "node:fs";
import path from "node:path";
import {
  client, launchBrowser, attachDiagnostics, diagnosticsSummary, waitForAppReady, delay,
  selectProjectByTitle, currentProjectLabel, typeInto, clickByText, shot, writeEvidence, EVIDENCE_DIR, FIXTURE_TAG,
} from "./qa9-lib.mjs";

const c = client();
const P1 = `${FIXTURE_TAG}-J1-ESTIMATOR`;
const P2 = `${FIXTURE_TAG}-J4-ISOLATION`;
const log = []; const problems = [];
const step = (s) => { log.push(s); console.log("STEP:", s); };

for (const p of (await c.query("projects:listProjects", {})).filter((x) => x.title === P2)) {
  try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
}
const p1 = (await c.query("projects:listProjects", {})).find((p) => p.title === P1);
if (!p1) throw new Error("J1 fixture missing");

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
const result = { journey: "J4", steps: log, data: {} };

async function kpiBand() {
  return page.evaluate(() => (document.querySelector("main")?.innerText || "").split("\n").slice(0, 12).join(" | "));
}
async function packageOptions() {
  return page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Target trade package for this RFI"]');
    return sel ? [...sel.options].map((o) => o.textContent.trim()) : null;
  });
}
async function levelingPkgButtons() {
  return page.evaluate(() => [...document.querySelectorAll("main button")].map((b) => (b.textContent || "").trim()).filter((t) => /^Div \d/.test(t) || /^\d\d \d\d \d\d/.test(t)));
}
async function discoveryPkgButtons() {
  return page.evaluate(() => [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter((t) => /^\d\d \d\d \d\d/.test(t)));
}

try {
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  // --- create second fixture via UI typed ---
  await clickByText(page, "New Project", { exact: false });
  await delay(600);
  await typeInto(page, 'input[aria-label="Project title"]', P2);
  await typeInto(page, 'input[aria-label="Project location"]', "Reno, NV");
  await typeInto(page, 'input[aria-label="Project type"]', "Industrial Warehouse");
  await typeInto(page, 'input[aria-label="General contractor or contracting entity"]', "QA9 Sierra Builders");
  await typeInto(page, 'input[aria-label="Estimated budget in dollars"]', "1000000");
  await typeInto(page, 'input[aria-label="Target completion duration in weeks"]', "40");
  await clickByText(page, "Create Commercial Project", { exact: false });
  const p2 = (await (async () => {
    for (let i = 0; i < 20; i++) {
      const hit = (await c.query("projects:listProjects", {})).find((p) => p.title === P2);
      if (hit) return hit;
      await delay(800);
    }
    return null;
  })());
  if (!p2) throw new Error("J4 project not created");
  result.data.p2 = { id: p2._id, budget: p2.estBudget };
  await delay(1200);
  step(`J4 project created id=${p2._id}`);

  // backend seed: 2 packages + contractor + 2 bids on J4
  const pkgA = await c.mutation("tradePackages:createTradePackage", {
    projectId: p2._id, csiDivision: "28 00 00", tradeName: "QA9 Electronic Safety",
    budgetEstimate: 380000, scopeSummary: "Fire alarm and access control.",
    mandatoryInclusions: ["Fire alarm", "Access control"], bidDeadline: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
  });
  const pkgB = await c.mutation("tradePackages:createTradePackage", {
    projectId: p2._id, csiDivision: "31 00 00", tradeName: "QA9 Earthwork",
    budgetEstimate: 620000, scopeSummary: "Site grading and utilities.",
    mandatoryInclusions: ["Grading", "Utilities"], bidDeadline: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
  });
  const ctr = await c.mutation("contractors:createContractor", {
    tradePackageId: pkgA, companyName: "QA9 Sierra Alarm", contactEmail: "bids@qa9-sierra.test",
    phone: "(775) 555-0101", licenseNumber: "NV-QA9-1", licenseStatus: "Active & Verified",
    sourceUrl: "https://qa9-sierra.test", rfqStatus: "invited",
  });
  await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgA, contractorId: ctr, subcontractorName: "QA9 Sierra Alarm",
    baseBidAmount: 350000, coiComplianceStatus: "compliant", longLeadEquipmentWeeks: 8, leadTimePenalty: 0,
  });
  await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgA, contractorId: ctr, subcontractorName: "QA9 Sierra Alarm (Revision)",
    baseBidAmount: 120000, coiComplianceStatus: "compliant", longLeadEquipmentWeeks: 8, leadTimePenalty: 0,
  });

  // --- verify J4 isolation in leveling ---
  await delay(1500);
  await page.keyboard.press("Digit4");
  await delay(1800);
  result.data.j4LevelingPkgs = await levelingPkgButtons();
  result.data.j4Kpi = await kpiBand();
  result.data.j4HasJ1Pkg = /QA9 Conveying Systems|QA9 Equipment Test|Specialties & Signage/i.test(await page.evaluate(() => document.body.innerText));
  step(`J4 leveling pkgs=${JSON.stringify(result.data.j4LevelingPkgs)} kpi=${result.data.j4Kpi.slice(0, 120)} hasJ1=${result.data.j4HasJ1Pkg}`);
  if (result.data.j4HasJ1Pkg) problems.push({ id: "A9-60", sev: "High", title: "J1 package content leaked into J4 leveling view" });
  if (!/1,000,000/.test(result.data.j4Kpi)) problems.push({ id: "A9-61", sev: "High", title: "J4 KPI band does not show J4 budget", detail: result.data.j4Kpi.slice(0, 160) });

  // ---- CSV export isolation ----
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa9-j4-downloads");
  fs.mkdirSync(dlDir, { recursive: true });
  const cdp = await page.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir, eventsEnabled: true });
  await clickByText(page, "Export Leveling CSV", { exact: false });
  await delay(2500);
  const files = fs.readdirSync(dlDir).filter((f) => f.endsWith(".csv"));
  result.data.csvFiles = files;
  let csv = null;
  if (files.length) {
    csv = fs.readFileSync(path.join(dlDir, files[files.length - 1]), "utf8");
    result.data.csvPath = path.join(dlDir, files[files.length - 1]);
    fs.writeFileSync(path.join(EVIDENCE_DIR, "fix4-qa9-j4-export.csv"), csv);
    result.data.csvRows = csv.split("\n").length - 1;
    result.data.csvHasJ4 = /QA9 Sierra Alarm/.test(csv);
    result.data.csvHasJ1 = /QA9 Conveying|QA9 Equipment|Specialties & Signage|Clean Electric/i.test(csv);
    step(`csv rows=${result.data.csvRows} hasJ4=${result.data.csvHasJ4} hasJ1=${result.data.csvHasJ1}`);
    if (!result.data.csvHasJ4) problems.push({ id: "A9-62", sev: "Medium", title: "J4 CSV export missing J4 bids" });
    if (result.data.csvHasJ1) problems.push({ id: "A9-63", sev: "High", title: "J1 bids leaked into J4 CSV export" });
  } else {
    problems.push({ id: "A9-64", sev: "Medium", title: "Export Leveling CSV produced no file" });
  }
  await shot(page, "fix4-qa9-j4-leveling.png");

  // --- QnA + discovery package selectors ---
  await page.keyboard.press("Digit3");
  await delay(1600);
  result.data.j4QnaOptions = await packageOptions();
  if (result.data.j4QnaOptions && result.data.j4QnaOptions.some((t) => /QA9 Conveying|QA9 Equipment|Specialties & Signage/i.test(t))) {
    problems.push({ id: "A9-65", sev: "High", title: "J1 package leaked into J4 RFI package selector", detail: JSON.stringify(result.data.j4QnaOptions) });
  }
  await page.keyboard.press("Digit2");
  await delay(1600);
  result.data.j4DiscoveryPkgs = await discoveryPkgButtons();
  await shot(page, "fix4-qa9-j4-selectors.png");

  // --- switch back to J1 and verify reverse isolation ---
  await selectProjectByTitle(page, P1);
  await delay(1600);
  await page.keyboard.press("Digit4");
  await delay(1600);
  result.data.j1LevelingHasJ4 = /QA9 Electronic Safety|QA9 Earthwork|QA9 Sierra/i.test(await page.evaluate(() => document.body.innerText));
  result.data.j1Kpi = await kpiBand();
  step(`J1 after switch: hasJ4=${result.data.j1LevelingHasJ4} kpi=${result.data.j1Kpi.slice(0, 100)}`);
  if (result.data.j1LevelingHasJ4) problems.push({ id: "A9-66", sev: "High", title: "J4 content leaked into J1 view after switching back" });
  if (/1,000,000/.test(result.data.j1Kpi) && !/6,400,000/.test(result.data.j1Kpi)) problems.push({ id: "A9-67", sev: "High", title: "KPI band stale after project switch", detail: result.data.j1Kpi.slice(0, 160) });
  await shot(page, "fix4-qa9-j4-back-to-j1.png");
  result.console = diagnosticsSummary(diag);
} catch (err) {
  problems.push({ id: "A9-90", sev: "High", title: "J4 crashed: " + (err?.message ?? String(err)).split("\n")[0] });
  await shot(page, "fix4-qa9-j4-crash.png").catch(() => {});
} finally {
  result.findings = problems;
  result.verdict = problems.some((p) => p.sev === "High") ? "blocked" : problems.length ? "complete-with-issues" : "complete";
  writeEvidence("j4-isolation", result);
  await browser.close();
}
console.log(`J4 verdict=${result.verdict} findings=${problems.length}`);