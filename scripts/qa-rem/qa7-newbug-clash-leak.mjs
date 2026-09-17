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

const fixtures = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa7-fixtures.json"), "utf8"));
const project = fixtures.project;
say(`QA7 NEW-BUG PROBE (scope-clash fixtures leak into a project with no Div 26/23 packages) at ${new Date().toISOString()}`);
say(`fixture project: ${project.title} [${project.id}]`);

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

const { browser } = await launchBrowser();
const context =
  typeof browser.createBrowserContext === "function"
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
const page = await context.newPage();
const diag = attachDiagnostics(page);

try {
  const pkgs = await withRetry("listPkgs", () =>
    client.query("tradePackages:listByProject", { projectId: project.id })
  );
  say(`backend packages on fixture project: ${pkgs.length} -> ${pkgs.map((p) => `${p.csiDivision} ${p.tradeName}`).join(" | ")}`);
  const divs2623 = pkgs.filter((p) => p.csiDivision.startsWith("26") || p.csiDivision.startsWith("23"));
  say(`Division 26/23 packages present: ${divs2623.length}`);

  const clash = await withRetry("detectCrossTradeClashes", () =>
    client.query("coordination:detectCrossTradeClashes", { projectId: project.id })
  );
  say(
    `backend detectCrossTradeClashes: elecPackageId=${clash.elecPackageId ?? "undefined"} hvacPackageId=${clash.hvacPackageId ?? "undefined"}`
  );
  say(`  doubleBuys (${clash.doubleBuys.length}): ${clash.doubleBuys.map((d) => `${d.title} [${d.status}] $${d.redundantAmount} ref=${d.primaryTradeName}/${d.secondaryTradeName}`).join(" || ")}`);
  say(`  scopeVoids (${clash.scopeVoids.length}): ${clash.scopeVoids.map((v) => `${v.title} [${v.status}] $${v.estimatedVoidCost}`).join(" || ")}`);
  say(`  summary: ${JSON.stringify(clash.summary)}`);

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1000);
  await page.select('select[aria-label="Select Commercial Construction Project"]', project.id);
  await delay(1200);
  const sel = await getSelectorState(page);
  say(`UI selected project: ${JSON.stringify(sel?.selectedText)}`);

  const tabClick = await page.evaluate(() => {
    const header = document.querySelector("header");
    const btn = [...header.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Scope Clash"));
    if (!btn) return false;
    btn.click();
    return true;
  });
  say(`click Scope Clash tab -> ${tabClick}`);
  await delay(2000);
  const text = await page.evaluate(() => document.body.innerText);
  const lines = text.split("\n").filter((l) => l.trim());
  const idx = lines.findIndex((l) => l.includes("Cross-Trade Scope Clash"));
  const excerpt = idx >= 0 ? lines.slice(idx, idx + 20) : lines.slice(0, 20);
  say(`UI clash panel excerpt:\n${excerpt.map((l) => "  | " + l).join("\n")}`);
  const kpiLine = lines.find((l) => l.includes("Buyout:"));
  say(`UI KPI line: ${JSON.stringify(kpiLine)}`);
  say(
    `UI shows VFD clash: ${text.includes("Variable Frequency Drives (VFDs) for AHUs & Pumps")}; shows disconnect clash: ${text.includes("Rooftop Mechanical Equipment Disconnect Switches")}; shows demo trade name: ${text.includes("Electrical & Lighting Systems")}`
  );
  await shot(page, "remediation-qa7-newbug-clash-01-ui-empty-project.png");

  const diagSummary = summarizeDiagnostics(diag);
  say(`diagnostics: ${JSON.stringify(diagSummary)}`);
  writeLog("remediation-qa7-newbug-clash-log.txt", log);
  console.log(
    "JSON_RESULT " +
      JSON.stringify({
        newBug: "scope-clash-fixture-leak",
        projectPackages: pkgs.map((p) => `${p.csiDivision} ${p.tradeName}`),
        div2623Count: divs2623.length,
        backendClashes: {
          elecPackageId: clash.elecPackageId ?? null,
          hvacPackageId: clash.hvacPackageId ?? null,
          doubleBuys: clash.doubleBuys.map((d) => ({ id: d.id, title: d.title, status: d.status, ref: d.primaryTradeName })),
          scopeVoids: clash.scopeVoids.map((v) => ({ id: v.id, title: v.title, status: v.status })),
          summary: clash.summary,
        },
        uiShowsClashes: text.includes("Variable Frequency Drives (VFDs) for AHUs & Pumps"),
        uiShowsDemoTradeName: text.includes("Electrical & Lighting Systems"),
        screenshots: ["remediation-qa7-newbug-clash-01-ui-empty-project.png", "remediation-qa7-06-tab-scope-clash.png"],
        diagnostics: diagSummary,
      })
  );
} catch (err) {
  say(`ERROR: ${err && err.stack ? err.stack : err}`);
  writeLog("remediation-qa7-newbug-clash-log.txt", log);
  process.exitCode = 1;
} finally {
  await browser.close();
}