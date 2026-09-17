import { ConvexHttpClient } from "convex/browser";
import { launchBrowser, attachDiagnostics, waitForAppReady, getSelectorState, clickButtonByText, shot, writeLog } from "./qa1-lib.mjs";
import { setTimeout as delay } from "node:timers/promises";

const client = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const urlParam = (page, key) => page.evaluate((k) => new URLSearchParams(window.location.search).get(k), key);

// fixture: empty project for CTA + deep-link tests
const title = `QA-REM-R6-UI-${Date.now()}`;
const fixtureId = await client.mutation("projects:createProject", {
  title, location: "Austin, TX", projectType: "QA R6 UI", estBudget: 2000000,
  targetCompletionWeeks: 30, specDocumentText: "R6 UI fixture.", isDemoProject: false,
});

const { browser } = await launchBrowser();
const page = await browser.newPage();
const diag = attachDiagnostics(page);

// Deep link: open the empty fixture directly on the discovery tab
await page.goto(`https://brainy-skunk-440.convex.site/?project=${fixtureId}&tab=discovery`, { waitUntil: "domcontentloaded", timeout: 60000 });
await waitForAppReady(page);
await delay(1500);
const sel = await getSelectorState(page);
const deepOk = Boolean(sel?.value === fixtureId);
say(`deep-link project: ${sel?.value === fixtureId ? "PASS" : `FAIL (${sel?.value})`}`);
const cta = await clickButtonByText(page, "Go to CSI Scoping");
say(`empty-state CTA on Discovery: ${cta.ok ? "PASS" : `FAIL (${JSON.stringify(cta)})`}`);
await delay(1200);
const tabAfterCta = await urlParam(page, "tab");
say(`CTA navigation -> tab=${tabAfterCta} (${tabAfterCta === "packages" ? "PASS" : "FAIL"})`);
await shot(page, "remediation-r6-01-cta-navigation.png");

// History: back should return to Discovery
await page.evaluate(() => window.history.back());
await delay(1500);
const tabAfterBack = await urlParam(page, "tab");
say(`history.back() -> tab=${tabAfterBack} (${tabAfterBack === "discovery" ? "PASS" : "FAIL"})`);

// Query params survive reload
await page.reload({ waitUntil: "domcontentloaded" });
await waitForAppReady(page);
await delay(1200);
const tabAfterReload = await urlParam(page, "tab");
const selAfterReload = await getSelectorState(page);
say(`reload keeps deep link: project=${selAfterReload?.value === fixtureId} tab=${tabAfterReload}`);

// Loading skeleton probe on an empty fixture: select packages tab and sample quickly
await page.goto(`https://brainy-skunk-440.convex.site/?project=${fixtureId}&tab=packages`, { waitUntil: "domcontentloaded", timeout: 60000 });
const skeletonSeen = await page.evaluate(async () => {
  const hasSkeleton = () => Boolean(document.querySelector('[aria-label="Loading trade packages"]'));
  for (let i = 0; i < 40; i += 1) {
    if (hasSkeleton()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
});
say(`package loading skeleton observed: ${skeletonSeen ? "PASS" : "NOT OBSERVED (query resolved before first paint)"}`);

const diagSummary = {
  consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text),
  pageErrors: diag.pageErrors,
  failedRequests: diag.failedRequests,
};
say(`diagnostics: ${JSON.stringify(diagSummary)}`);
writeLog("remediation-r6-ui-log.txt", log);
await browser.close();

await client.mutation("projects:deleteProject", { projectId: fixtureId });
const remaining = await client.query("projects:listProjects", {});
say(`cleanup: projects=${remaining.length} demo=${remaining[0]?.isDemoProject}`);
writeLog("remediation-r6-ui-log.txt", log);
process.exitCode = deepOk && cta.ok && tabAfterCta === "packages" && tabAfterBack === "discovery" ? 0 : 1;