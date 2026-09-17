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
const results = {};

const fixtures = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa7-fixtures.json"), "utf8"));
const myProject = fixtures.project;
say(`QA7 ITEM 7 (selector contents / audit cleanup) + MY FIXTURE CLEANUP at ${new Date().toISOString()}`);
say(`my fixture project: ${myProject.title} [${myProject.id}]`);

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
const listProjects = () => withRetry("listProjects", () => client.query("projects:listProjects", {}));

const { browser } = await launchBrowser();
const context =
  typeof browser.createBrowserContext === "function"
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
const page = await context.newPage();
const diag = attachDiagnostics(page);

const AUDIT_LEFTOVER_PATTERNS = ["Pass2", "Production Audit Temporary", "QA Test Tower", "Temporary Audit"];

try {
  // ---------- Phase 1: backend project inventory ----------
  const backendProjects = await listProjects();
  say("BACKEND PROJECT INVENTORY:");
  for (const p of backendProjects) {
    say(
      `  - ${p.title} (demo=${Boolean(p.isDemoProject)}) id=${p._id} created=${new Date(p._creationTime).toISOString()}`
    );
  }
  const demo = backendProjects.filter((p) => p.isDemoProject);
  const mine = backendProjects.filter((p) => p._id === myProject.id);
  const foreign = backendProjects.filter((p) => !p.isDemoProject && p._id !== myProject.id);
  say(`demo=${demo.length} mine=${mine.length} foreign-non-demo=${foreign.length}`);
  for (const f of foreign) {
    say(`  FOREIGN (not created by QA7): ${f.title} [${f._id}] created=${new Date(f._creationTime).toISOString()}`);
  }
  const auditLeftovers = backendProjects.filter((p) => AUDIT_LEFTOVER_PATTERNS.some((pat) => p.title.includes(pat)));
  results.noAuditLeftovers = auditLeftovers.length === 0 ? "PASS" : "FAIL";
  say(`audit-fixture leftovers (${AUDIT_LEFTOVER_PATTERNS.join(", ")}): ${auditLeftovers.length} -> ${results.noAuditLeftovers}`);

  // ---------- Phase 2: UI selector contents ----------
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1500);
  const sel = await getSelectorState(page);
  say(`selector option count: ${sel.options.length}`);
  for (const o of sel.options) say(`  option: value=${o.value} text=${JSON.stringify(o.text)}`);
  await shot(page, "remediation-qa7-07-01-selector-options.png");

  const backendTitles = backendProjects.map((p) => p.title).sort();
  const uiTitles = sel.options
    .map((o) => o.text.replace(/\s*\([^()]*\)\s*$/, "").trim())
    .sort();
  say(`backend titles: ${JSON.stringify(backendTitles)}`);
  say(`ui titles:      ${JSON.stringify(uiTitles)}`);
  const setsEqual = JSON.stringify(backendTitles) === JSON.stringify(uiTitles);
  results.selectorMatchesBackend = setsEqual ? "PASS" : "FAIL";
  say(`selector matches backend project set: ${results.selectorMatchesBackend}`);

  const nonDemoUi = sel.options.filter((o) => !o.text.includes("Domain Tower"));
  const unexpected = nonDemoUi.filter(
    (o) => !o.text.startsWith("QA-REM") && !AUDIT_LEFTOVER_PATTERNS.some((p) => o.text.includes(p))
  );
  results.onlyDemoAndQaRemFixtures = unexpected.length === 0 ? "PASS" : "FAIL";
  say(`non-demo selector options: ${JSON.stringify(nonDemoUi.map((o) => o.text))}`);
  say(`unexpected non-QA-REM options: ${JSON.stringify(unexpected.map((o) => o.text))} -> ${results.onlyDemoAndQaRemFixtures}`);

  // ---------- Phase 3: cleanup MY fixture project ----------
  say("CLEANUP: deleting only my fixture project (QA7-owned)");
  const pkgInfo = await withRetry("myPkgs", () => client.query("tradePackages:listByProject", { projectId: myProject.id }));
  say(`my fixture packages at cleanup time: ${pkgInfo.map((p) => `${p.csiDivision} ${p.tradeName}`).join(" | ")}`);
  await withRetry("deleteMyFixture", () => client.mutation("projects:deleteProject", { projectId: myProject.id }));
  say(`deleted: ${myProject.title}`);
  await delay(2000);

  const after = await listProjects();
  say(`projects after cleanup: ${after.map((p) => p.title).join(" | ")}`);
  const myGone = !after.some((p) => p._id === myProject.id);
  results.myFixtureDeleted = myGone ? "PASS" : "FAIL";
  results.demoStillPresent = after.some((p) => p.isDemoProject) ? "PASS" : "FAIL";

  const selAfter = await getSelectorState(page);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1500);
  const selAfterReload = await getSelectorState(page);
  say(`selector after cleanup (pre-reload): ${JSON.stringify(selAfter.options.map((o) => o.text))}`);
  say(`selector after cleanup (post-reload): ${JSON.stringify(selAfterReload.options.map((o) => o.text))}`);
  await shot(page, "remediation-qa7-07-02-selector-after-cleanup.png");
  say(`selected after cleanup reload: ${JSON.stringify(selAfterReload.selectedText)}`);
  results.myFixtureGoneFromUi = selAfterReload.options.every((o) => !o.text.includes(myProject.title)) ? "PASS" : "FAIL";

  const diagSummary = summarizeDiagnostics(diag);
  say(`diagnostics: ${JSON.stringify(diagSummary)}`);

  const overall = ["noAuditLeftovers", "selectorMatchesBackend", "onlyDemoAndQaRemFixtures", "myFixtureDeleted", "demoStillPresent", "myFixtureGoneFromUi"].every(
    (k) => results[k] === "PASS"
  )
    ? "PASS"
    : "FAIL";
  say(`ITEM 7 RESULT: ${overall}`);
  say(`CHECKS: ${JSON.stringify(results)}`);
  console.log(
    "JSON_RESULT " +
      JSON.stringify({
        item: 7,
        result: overall,
        checks: results,
        backendBefore: backendProjects.map((p) => ({ title: p.title, demo: Boolean(p.isDemoProject), created: new Date(p._creationTime).toISOString() })),
        foreignNonDemo: foreign.map((p) => ({ title: p.title, created: new Date(p._creationTime).toISOString() })),
        selectorBefore: sel.options.map((o) => o.text),
        selectorAfter: selAfterReload.options.map((o) => o.text),
        diagnostics: diagSummary,
      })
  );
  writeLog("remediation-qa7-07-selector-cleanup-log.txt", log);
  process.exitCode = overall === "PASS" ? 0 : 1;
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  const diagSummary = summarizeDiagnostics(diag);
  say(`diagnostics at failure: ${JSON.stringify(diagSummary)}`);
  console.log("JSON_RESULT " + JSON.stringify({ item: 7, result: "FAIL", error: String(err), checks: results, diagnostics: diagSummary }));
  writeLog("remediation-qa7-07-selector-cleanup-log.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
}