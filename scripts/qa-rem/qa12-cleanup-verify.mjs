// QA-12 cleanup + final verification:
//  1. mobile 375x812 re-check on the now-populated custom fixture (overflow + Delete button present)
//  2. delete the QA-12 fixture (targeted; QA-11 concurrent fixtures left to their owner)
//  3. cascade proof + final demo snapshot vs baseline + remaining projects
// Usage: node scripts/qa-rem/qa12-cleanup-verify.mjs
import {
  launchBrowser,
  shot,
  waitForAppReady,
  delay,
  BASE_URL,
  writeLog,
  getSelectorState,
  selectProjectByTitle,
} from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const backend = new ConvexHttpClient(BACKEND);
const fixture = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-fixture.json"), "utf8"));
const baseline = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-baseline.json"), "utf8"));

const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 700) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "…" : s;
};

async function snapshotProject(projectId) {
  const project = await backend.query("projects:getProject", { projectId });
  const packages = await backend.query("tradePackages:listByProject", { projectId });
  const bids = await backend.query("bids:listAllProjectBids", { projectId });
  const agreements = await backend.query("agreements:listAgreements", { projectId });
  const logs = await backend.query("auditLogs:listRecentLogs", { projectId, limit: 1000 });
  const contractors = await backend.query("contractors:listByProject", { projectId });
  return {
    id: projectId,
    title: project?.title,
    estBudget: project?.estBudget,
    targetCompletionWeeks: project?.targetCompletionWeeks,
    isDemoProject: project?.isDemoProject,
    packageCount: packages.length,
    bidCount: bids.length,
    agreementCount: agreements.length,
    auditLogCount: logs.length,
    contractorCount: contractors.length,
    packageDivisions: packages.map((p) => p.csiDivision).sort(),
  };
}
function demoEquivalent(a, b) {
  const keys = ["title", "estBudget", "targetCompletionWeeks", "isDemoProject", "packageCount", "bidCount", "agreementCount", "auditLogCount", "contractorCount"];
  for (const k of keys) if (a[k] !== b[k]) return { mismatch: k, a: a[k], b: b[k] };
  return true;
}

async function mobileOverflow(page) {
  return page.evaluate(() => {
    const docW = document.documentElement.scrollWidth;
    const bodyW = document.body.scrollWidth;
    return {
      innerWidth: window.innerWidth,
      docScrollWidth: docW,
      bodyScrollWidth: bodyW,
      overflowPx: Math.max(docW, bodyW) - window.innerWidth,
      overflow: Math.max(docW, bodyW) > window.innerWidth,
      hasDeleteBtn: [...document.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "Delete"),
      hasNewProjectBtn: [...document.querySelectorAll("button")].some((b) => (b.textContent || "").trim().includes("New Project")),
    };
  });
}

async function run() {
  ev("=== QA-12 CLEANUP + FINAL VERIFICATION ===");
  ev(`UTC: ${new Date().toISOString()}`);
  ev(`Fixture: ${fixture.tag} (${fixture.projectId})`);
  ev("");

  // ---- 1. mobile re-check on populated custom fixture ----
  const { browser } = await launchBrowser();
  let mobile = null;
  try {
    const mctx = await browser.createBrowserContext();
    const mpage = await mctx.newPage();
    mpage.setDefaultTimeout(30000);
    await mpage.setViewport({ width: 375, height: 812 });
    await mpage.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(mpage);
    await delay(2200);
    const mSel0 = await getSelectorState(mpage);
    const demoOverflow = await mobileOverflow(mpage);
    ev(`mobile demo: overflow=${J(demoOverflow)}`);
    await selectProjectByTitle(mpage, fixture.tag);
    await delay(2600);
    await mpage.evaluate(() => window.scrollTo(0, 0));
    const customOverflow = await mobileOverflow(mpage);
    ev(`mobile custom(populated): overflow=${J(customOverflow)}`);
    await shot(mpage, "remediation-qa12-19-mobile-custom-populated.png");
    await mctx.close();
    mobile = { demo: demoOverflow, customPopulated: customOverflow, landing: mSel0?.selectedText };
  } finally {
    await browser.close();
  }

  // ---- 2. delete QA-12 fixture ----
  const delRes = await backend.mutation("projects:deleteProject", { projectId: fixture.projectId });
  ev(`deleteProject(QA12 fixture) -> ${J(delRes)}`);
  const pkgsAfter = await backend.query("tradePackages:listByProject", { projectId: fixture.projectId });
  const bidsAfter = await backend.query("bids:listAllProjectBids", { projectId: fixture.projectId });
  const agsAfter = await backend.query("agreements:listAgreements", { projectId: fixture.projectId });
  const logsAfter = await backend.query("auditLogs:listRecentLogs", { projectId: fixture.projectId, limit: 1000 });
  const consAfter = await backend.query("contractors:listByProject", { projectId: fixture.projectId });
  const projects = await backend.query("projects:listProjects", {});
  const mineGone = !projects.some((p) => p._id === fixture.projectId);
  ev(`cascade: packages=${pkgsAfter.length} bids=${bidsAfter.length} agreements=${agsAfter.length} logs=${logsAfter.length} contractors=${consAfter.length} gone=${mineGone}`);
  ev(`remaining projects: ${J(projects.map((p) => ({ title: p.title, demo: Boolean(p.isDemoProject), created: p._creationTime })), 900)}`);

  // ---- 3. demo final vs baseline ----
  const demoId = baseline.demoSnapshot.id;
  const demoAfter = await snapshotProject(demoId);
  const demoMatch = demoEquivalent(demoAfter, baseline.demoSnapshot);
  ev(`demo final snapshot: ${J(demoAfter, 700)}`);
  ev(`demo unchanged vs baseline: ${J(demoMatch)}`);

  const out = {
    at: new Date().toISOString(),
    mobile,
    cleanup: {
      deleted: delRes,
      cascade: {
        packages: pkgsAfter.length,
        bids: bidsAfter.length,
        agreements: agsAfter.length,
        logs: logsAfter.length,
        contractors: consAfter.length,
        gone: mineGone,
      },
      remainingProjects: projects.map((p) => ({ id: p._id, title: p.title, isDemoProject: Boolean(p.isDemoProject), creationTime: p._creationTime })),
      nonDemoRemaining: projects.filter((p) => !p.isDemoProject).map((p) => p.title),
    },
    demoAfter,
    demoUnchanged: demoMatch,
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-cleanup-verify.json"), JSON.stringify(out, null, 2), "utf8");
  writeLog("remediation-qa12-cleanup-verify.txt", LOG);
  console.log("Wrote evidence.");
}

run().catch((e) => {
  writeLog("remediation-qa12-cleanup-verify.txt", LOG.concat([`FATAL: ${e?.stack || e}`]));
  process.exit(1);
});