import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);

const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

const stamp = Date.now();
const reusable = process.env.QA9_FIXTURE_ID
  ? { _id: process.env.QA9_FIXTURE_ID, title: process.env.QA9_FIXTURE_TITLE || "reused" }
  : null;

say(`QA9 BACKEND CLASH/KPI PROBE at ${new Date().toISOString()}`);
say(`backend: ${url}`);

const projectsBefore = await client.query("projects:listProjects", {});
say(`projects before: ${projectsBefore.length}`);
for (const p of projectsBefore) say(`  - ${p.title} | demo=${p.isDemoProject} | id=${p._id}`);

const demo = projectsBefore.find((p) => p.isDemoProject);
if (!demo) {
  say("FATAL: no demo project found");
  process.exit(2);
}
const demoTitle = demo.title;
say(`demo project: "${demoTitle}" (${demo._id})`);

const fixtureId = reusable
  ? reusable._id
  : await client.mutation("projects:createProject", {
      title: `QA-REM-QA9-CLASH-${stamp}`,
      location: "Austin, TX",
      projectType: "QA9 Clash/KPI Fixture",
      estBudget: 2500000,
      targetCompletionWeeks: 36,
      specDocumentText: "QA-9 fresh fixture project intentionally created with zero trade packages.",
      isDemoProject: false,
      generalContractorName: "QA9 Verification GC, LLC",
    });
const fixtureRec = reusable || { _id: fixtureId, title: `QA-REM-QA9-CLASH-${stamp}` };
say(`${reusable ? "reused" : "created"} fixture: "${fixtureRec.title}" (${fixtureId})`);

const fixturePkgs = await client.query("tradePackages:listByProject", { projectId: fixtureId });
const demoPkgs = await client.query("tradePackages:listByProject", { projectId: demo._id });
say(`fixture package count: ${fixturePkgs.length}`);
say(`demo package count: ${demoPkgs.length} -> ${demoPkgs.map((p) => `${p.csiDivision} ${p.tradeName}`).join(" | ")}`);

const fx = await client.query("coordination:detectCrossTradeClashes", { projectId: fixtureId });
const dm = await client.query("coordination:detectCrossTradeClashes", { projectId: demo._id });

const norm = (r) => ({
  redundant: r.summary ? r.summary.totalDoubleBuyExposure : r.totalRedundantAmount,
  void: r.summary ? r.summary.totalScopeVoidExposure : r.totalVoidExposure,
  active:
    r.summary && typeof r.summary.activeClashesCount === "number"
      ? r.summary.activeClashesCount
      : r.doubleBuys.filter((d) => d.status === "detected").length +
        r.scopeVoids.filter((v) => v.status === "open").length,
  shape: r.summary ? "summary" : "top-level",
  provider: r.provider ?? null,
  model: r.model ?? null,
});

const fxN = norm(fx);
const dmN = norm(dm);

say("\n--- fixture (0 packages) detectCrossTradeClashes ---");
say(
  `doubleBuys=${fx.doubleBuys.length} scopeVoids=${fx.scopeVoids.length} redundant=$${fxN.redundant} void=$${fxN.void} activeBadgeCount=${fxN.active} shape=${fxN.shape} provider=${fxN.provider} model=${fxN.model}`
);
say(`raw fixture payload: ${JSON.stringify(fx)}`);
for (const d of fx.doubleBuys) say(`  doubleBuy: ${d.id} | ${d.title} | $${d.redundantAmount}`);
for (const v of fx.scopeVoids) say(`  scopeVoid: ${v.id} | ${v.title} | $${v.estimatedVoidCost}`);

say("\n--- demo detectCrossTradeClashes ---");
say(
  `doubleBuys=${dm.doubleBuys.length} scopeVoids=${dm.scopeVoids.length} redundant=$${dmN.redundant} void=$${dmN.void} activeBadgeCount=${dmN.active} shape=${dmN.shape}`
);
for (const d of dm.doubleBuys)
  say(`  doubleBuy: ${d.id} | ${d.title} | $${d.redundantAmount} | status=${d.status}`);
for (const v of dm.scopeVoids)
  say(`  scopeVoid: ${v.id} | ${v.title} | $${v.estimatedVoidCost} | status=${v.status}`);

const checks = {
  fixtureZeroCards: fx.doubleBuys.length === 0 && fx.scopeVoids.length === 0 ? "PASS" : "FAIL",
  fixtureZeroTotals: fxN.redundant === 0 && fxN.void === 0 ? "PASS" : "FAIL",
  fixtureBadgeZero: fxN.active === 0 ? "PASS" : "FAIL",
  demoHasTwoDoubleBuys: dm.doubleBuys.length === 2 ? "PASS" : "FAIL",
  demoHasTwoVoids: dm.scopeVoids.length === 2 ? "PASS" : "FAIL",
  demoRedundant50500: dmN.redundant === 50500 ? "PASS" : "FAIL",
  demoVoid46500: dmN.void === 46500 ? "PASS" : "FAIL",
  demoBadge4: dmN.active === 4 ? "PASS" : "FAIL",
  demoClashIdsMatchSeed: dm.doubleBuys.some((d) => d.id === "clash-vfd-01") && dm.doubleBuys.some((d) => d.id === "clash-disconnect-02") ? "PASS" : "FAIL",
};
say(`\nCHECKS: ${JSON.stringify(checks, null, 2)}`);
const overall = Object.values(checks).every((v) => v === "PASS") ? "PASS" : "FAIL";
say(`BACKEND PROBE RESULT: ${overall}`);

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.writeFileSync(
  path.join(EVIDENCE_DIR, "remediation-qa9-fixtures.json"),
  JSON.stringify(
    {
      runAt: new Date().toISOString(),
      backend: url,
      fixture: { title: fixtureRec.title, id: fixtureId, packages: fixturePkgs.length },
      demo: { title: demoTitle, id: demo._id, packages: demoPkgs.length },
      fixtureClashes: {
        doubleBuys: fx.doubleBuys.length,
        scopeVoids: fx.scopeVoids.length,
        redundantTotal: fxN.redundant,
        voidTotal: fxN.void,
        shape: fxN.shape,
        provider: fxN.provider,
        model: fxN.model,
      },
      demoClashes: {
        doubleBuys: dm.doubleBuys.length,
        scopeVoids: dm.scopeVoids.length,
        redundantTotal: dmN.redundant,
        voidTotal: dmN.void,
        shape: dmN.shape,
        ids: dm.doubleBuys.map((d) => d.id),
        voidIds: dm.scopeVoids.map((v) => v.id),
      },
      checks,
      overall,
    },
    null,
    2
  ),
  "utf8"
);

fs.writeFileSync(
  path.join(EVIDENCE_DIR, "remediation-qa9-01-backend-clash-kpi.txt"),
  log.join("\n") + "\n",
  "utf8"
);

process.exitCode = overall === "PASS" ? 0 : 1;