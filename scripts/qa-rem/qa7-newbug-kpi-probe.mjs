import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import {
  BASE_URL,
  EVIDENCE_DIR,
  launchBrowser,
  attachDiagnostics,
  waitForAppReady,
  getSelectorState,
  selectProjectByTitle,
  shot,
  writeLog,
  summarizeDiagnostics,
  delay,
} from "./qa1-lib.mjs";

const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};
const fixtures = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa7-fixtures.json"), "utf8"));
const project = fixtures.project;

const client = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
async function withRetry(label, fn, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      say(`  backend ${label} attempt ${i + 1} failed: ${String(err).slice(0, 140)}`);
      await delay(2000);
    }
  }
  throw lastErr;
}

const tempTitle = `QA-REM-R3-KPIPROBE-${Date.now()}`;
say(`QA7 NEW-BUG PROBE #2 (KPI bar values on empty project) at ${new Date().toISOString()}`);
const tempId = await withRetry("createTempProject", () =>
  client.mutation("projects:createProject", {
    title: tempTitle,
    location: "Austin, TX",
    projectType: "QA KPI probe",
    estBudget: 3000000,
    targetCompletionWeeks: 40,
    specDocumentText: "Temporary KPI probe fixture.",
    isDemoProject: false,
  })
);
say(`temp empty project created: ${tempTitle} [${tempId}]`);
let tempPkgs = await withRetry("tempPkgs", () => client.query("tradePackages:listByProject", { projectId: tempId }));
say(`temp project packages: ${tempPkgs.length}`);

const { browser } = await launchBrowser();
const context =
  typeof browser.createBrowserContext === "function"
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
const page = await context.newPage();
const diag = attachDiagnostics(page);

const kpiText = () =>
  page.evaluate(() => {
    const lines = document.body.innerText.split("\n").map((l) => l.trim()).filter(Boolean);
    const budgetLine = lines.find((l) => l.includes("Budget:") && l.includes("Buyout"));
    const buyoutLine = lines.find((l) => l.includes("Buyout:"));
    const awardedFrag = (document.body.innerText.match(/Buyout:\s*\d+\/\d+\s*Awarded/) || [])[0] || null;
    return { budgetLine: budgetLine || null, buyoutLine: buyoutLine || null, awardedFrag };
  });

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1500);

  const demoState = await kpiText();
  say(`demo project KPI settled: ${JSON.stringify(demoState)}`);
  await shot(page, "remediation-qa7-newbug-kpi-01-demo.png");

  // switch to temp empty project
  const t0 = Date.now();
  await page.select('select[aria-label="Select Commercial Construction Project"]', tempId);
  const samples = [];
  for (const wait of [0, 400, 600, 1000, 2000, 3000]) {
    if (wait) await delay(wait);
    const st = await kpiText();
    const sel = await getSelectorState(page);
    samples.push({ ms: Date.now() - t0, ...st, selected: sel?.selectedText });
    say(`  KPI sample t+${Date.now() - t0}ms ${JSON.stringify(st)}`);
  }
  await shot(page, "remediation-qa7-newbug-kpi-02-temp-empty-project.png");

  const settled = samples[samples.length - 1];
  const demoAwarded = demoState.awardedFrag;
  const settledAwarded = settled.awardedFrag;
  say(`demo awardedFrag=${JSON.stringify(demoAwarded)}; empty-project settled awardedFrag=${JSON.stringify(settledAwarded)}`);
  say(`empty-project settled budgetLine=${JSON.stringify(settled.budgetLine)}`);

  // switch to fixture project with 2 packages
  await page.select('select[aria-label="Select Commercial Construction Project"]', project.id);
  await delay(3000);
  const fixtureKpi = await kpiText();
  say(`fixture project (2 pkgs) KPI settled: ${JSON.stringify(fixtureKpi)}`);
  await shot(page, "remediation-qa7-newbug-kpi-03-fixture-2pkgs.png");

  const diagSummary = summarizeDiagnostics(diag);
  say(`diagnostics: ${JSON.stringify(diagSummary)}`);

  // cleanup temp project
  await withRetry("deleteTempProject", () => client.mutation("projects:deleteProject", { projectId: tempId }));
  say(`temp project deleted: ${tempTitle}`);
  const remaining = await withRetry("listProjects", () => client.query("projects:listProjects", {}));
  say(`remaining projects: ${remaining.map((p) => p.title).join(" | ")}`);

  writeLog("remediation-qa7-newbug-kpi-log.txt", log);
  console.log(
    "JSON_RESULT " +
      JSON.stringify({
        newBugProbe: "kpi-empty-project-values",
        tempProject: { title: tempTitle, id: tempId, packages: tempPkgs.length },
        demoKpi: demoState,
        emptyProjectSamples: samples,
        fixtureProjectKpi: fixtureKpi,
        diagnostics: diagSummary,
        cleanedUp: true,
      })
  );
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  try {
    await withRetry("deleteTempProject", () => client.mutation("projects:deleteProject", { projectId: tempId }));
    say(`temp project deleted during error handling: ${tempTitle}`);
  } catch (e2) {
    say(`temp cleanup failed: ${String(e2)}`);
  }
  writeLog("remediation-qa7-newbug-kpi-log.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
}