import { ConvexHttpClient } from "convex/browser";
import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  selectProjectByTitle,
  bodyText,
  delay,
  waitForBodyText,
  clickButtonByText,
  createProjectViaUI,
  summarizeDiagnostics,
  writeLog,
  writeJson,
} from "./qa4-lib.mjs";

const log = [];
const say = (s) => { console.log(s); log.push(s); };
const CLOUD = "https://brainy-skunk-440.convex.cloud";

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
say(`JD TARGET: ${BASE_URL}`);
const page = await browser.newPage();
const diag = attachDiagnostics(page);

const title = `QA-REM-QA4-JD-${Date.now()}`;
say(`JD PROJECT: ${title}`);
let result = { jd: "FAIL", title };

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  const created = await createProjectViaUI(page, { title, budget: 5000000, weeks: 60 });
  say(`CREATE: ${JSON.stringify(created.waited)}`);
  await delay(700);

  const client = new ConvexHttpClient(CLOUD);
  const projects = await client.query("projects:listProjects", {});
  const proj = projects.find((p) => p.title === title);
  if (!proj) throw new Error("project not found in backend");
  result.projectId = proj._id;
  const pkgsBefore = await client.query("tradePackages:listByProject", { projectId: proj._id });
  say(`BACKEND PROJECT: ${proj._id} | packagesBefore=${pkgsBefore.length}`);

  const emptyShot = await shot(page, "remediation-qa4-jd-01-empty-project.png");
  const open = await clickButtonByText(page, "60s Judge Dock");
  say(`DOCK OPEN: ${JSON.stringify(open)}`);

  // The dock may show a confirmation step ("Start 60s Simulation") — detect and click if present.
  await waitForBodyText(page, ["Autonomous End-to-End Showcase"], 15000);
  await delay(700);
  const dockShot = await shot(page, "remediation-qa4-jd-02-dock-open.png");
  const dockText = await bodyText(page);
  const dockTargetLine = (dockText.match(/Target CSI Trade Package:[^\n]*/) || [])[0] ?? null;
  say(`DOCK READY: target="${dockTargetLine}" shot=${dockShot}`);

  const t0 = Date.now();
  const run = await clickButtonByText(page, "1-Click Run Full Autonomous Procurement Lifecycle");
  say(`RUN CLICK: ${JSON.stringify(run)} at t0`);
  if (!run.ok) throw new Error("run button not found: " + JSON.stringify(run.available));

  let outcome = null;
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    const text = await bodyText(page);
    if (text.includes("Full Autonomous Lifecycle Complete")) { outcome = "complete"; break; }
    if (text.includes("Lifecycle simulation failed")) { outcome = "failed"; break; }
    await delay(1000);
  }
  const durationMs = Date.now() - t0;
  await delay(800);
  const resultShot = await shot(page, "remediation-qa4-jd-03-result.png");
  const text = await bodyText(page);
  const completeLine = (text.match(/✓ Full Autonomous Lifecycle Complete![^\n]*/) || [])[0] ?? null;
  const failedLine = (text.match(/Lifecycle simulation failed[^\n]*/) || [])[0] ?? null;
  say(`OUTCOME: ${outcome} at ${durationMs}ms | completeLine=${JSON.stringify(completeLine)} | failedLine=${JSON.stringify(failedLine)} | shot=${resultShot}`);

  await delay(1500);
  // Close dock, verify UI badge reflects packages reactively.
  await clickButtonByText(page, "Close Dock", { exact: true });
  await delay(2000);
  const closedText = await bodyText(page);
  const pkgsBadge = (closedText.match(/(\d+)\s*Pkgs/) || [])[1] ?? null;
  const uiShot = await shot(page, "remediation-qa4-jd-04-packages-badge.png");
  say(`UI AFTER DOCK: pkgsBadge=${pkgsBadge} shot=${uiShot}`);

  // Backend persistence: packages, agreement, audit events
  const pkgs = await client.query("tradePackages:listByProject", { projectId: proj._id });
  const ags = await client.query("agreements:listAgreements", { projectId: proj._id });
  const logs = await client.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 50 });
  say(`BACKEND AFTER JD: packages=${pkgs.length} agreements=${ags.length} auditLogs=${logs.length}`);
  for (const p of pkgs) say(`   PKG ${p.csiDivision} | ${p.tradeName} | status=${p.status}`);
  for (const a of ags) say(`   AGR ${a.agreementNumber} | status=${a.status} | sub=${a.subcontractorName}`);
  for (const l of logs) say(`   LOG ${l.eventType} | ${l.title}`);

  // Reload persistence
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page, 45000);
  await delay(1200);
  await selectProjectByTitle(page, title);
  await waitForBodyText(page, [title], 20000);
  await delay(1000);
  const reloadText = await bodyText(page);
  const reloadBadge = (reloadText.match(/(\d+)\s*Pkgs/) || [])[1] ?? null;
  const reloadShot = await shot(page, "remediation-qa4-jd-05-after-reload.png");
  say(`AFTER RELOAD: pkgsBadge=${reloadBadge} shot=${reloadShot}`);

  const diagSummary = summarizeDiagnostics(diag);
  const requiredEvents = ["rfq_dispatched", "rfi_clarified", "contract_awarded"];
  const eventTypes = new Set(logs.map((l) => l.eventType));
  const allEvents = requiredEvents.every((e) => eventTypes.has(e));
  const pass =
    outcome === "complete" &&
    Boolean(completeLine) &&
    pkgs.length >= 1 &&
    ags.length >= 1 &&
    allEvents &&
    diagSummary.pageErrors.length === 0;
  say(`DIAGNOSTICS: ${JSON.stringify(diagSummary)}`);
  result = {
    jd: pass ? "PASS" : "FAIL",
    title,
    projectId: proj._id,
    outcome,
    durationMs,
    completeLine,
    failedLine,
    packagesBefore: pkgsBefore.length,
    backendPackages: pkgs.map((p) => ({ csiDivision: p.csiDivision, tradeName: p.tradeName, status: p.status })),
    agreements: ags.map((a) => ({ agreementNumber: a.agreementNumber, status: a.status, sub: a.subcontractorName })),
    auditLogCount: logs.length,
    auditEventTypes: [...eventTypes],
    requiredEventsPresent: allEvents,
    uiPkgsBadge: pkgsBadge,
    reloadPkgsBadge: reloadBadge,
    diagSummary,
  };
  say(`JD RESULT: ${result.jd}`);
} catch (err) {
  say(`JD ERROR: ${err.stack || err}`);
  result = { jd: "FAIL", title, error: String(err), diagSummary: summarizeDiagnostics(diag) };
} finally {
  const logPath = writeLog("remediation-qa4-jd-log.txt", log);
  writeJson("remediation-qa4-jd-result.json", result);
  say(`LOG: ${logPath}`);
  console.log("JSON_RESULT " + JSON.stringify(result));
  await browser.close();
  process.exitCode = result.jd === "PASS" ? 0 : 1;
}