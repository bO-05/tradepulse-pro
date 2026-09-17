// QA-11 cleanup: delete ONLY the two QA-11 fixtures, prove cascade + demo integrity.
// Usage: node scripts/qa-rem/qa11-cleanup.mjs
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const client = new ConvexHttpClient(BACKEND);
const log = [];
const say = (s) => { console.log(s); log.push(s); };

const fixtures = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-fixtures.json"), "utf8"));

async function withRetry(label, fn, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      say(`  backend ${label} attempt ${i + 1} failed: ${String(err).slice(0, 140)}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

async function packageCounts(projectId) {
  const pkgs = await withRetry("listByProject", () => client.query("tradePackages:listByProject", { projectId }));
  const per = [];
  for (const p of pkgs) {
    const [bids, contractors, convos] = await Promise.all([
      withRetry("bids", () => client.query("bids:listByPackage", { tradePackageId: p._id })),
      withRetry("contractors", () => client.query("contractors:listByPackage", { tradePackageId: p._id })),
      withRetry("conversations", () => client.query("rfq:listConversations", { tradePackageId: p._id })),
    ]);
    per.push({ packageId: p._id, tradeName: p.tradeName, bids: bids.length, contractors: contractors.length, conversations: convos.length });
  }
  return per;
}

async function snapshotProject(projectId) {
  const project = (await withRetry("listProjects", () => client.query("projects:listProjects", {}))).find((p) => p._id === projectId);
  if (!project) return null;
  const pkgs = await packageCounts(projectId);
  const bids = await withRetry("listAllProjectBids", () => client.query("bids:listAllProjectBids", { projectId }));
  const agreements = await withRetry("listAgreements", () => client.query("agreements:listAgreements", { projectId }));
  return {
    id: project._id,
    title: project.title,
    isDemoProject: project.isDemoProject,
    estBudget: project.estBudget,
    location: project.location,
    packageCount: pkgs.length,
    packages: pkgs,
    bidCount: bids.length,
    agreementCount: agreements.length,
  };
}

say(`QA-11 CLEANUP ${new Date().toISOString()}`);
const before = await withRetry("listProjects", () => client.query("projects:listProjects", {}));
say(`projects BEFORE: ${before.length} [${before.map((p) => `${p.title}${p.isDemoProject ? " (DEMO)" : ""}`).join(" | ")}]`);

const demo = before.find((p) => p.isDemoProject);
const demoBefore = await snapshotProject(demo._id);
say(`demo BEFORE: title="${demoBefore.title}" demo=${demoBefore.isDemoProject} pkgs=${demoBefore.packageCount} bids=${demoBefore.bidCount} agreements=${demoBefore.agreementCount}`);
say(`demo BEFORE packages: ${demoBefore.packages.map((p) => `${p.tradeName}[bids=${p.bids},contractors=${p.contractors},convos=${p.conversations}]`).join(" | ")}`);

const mine = [fixtures.ui, fixtures.empty];
const fixtureBefore = {};
for (const f of mine) {
  const snap = await snapshotProject(f.projectId);
  fixtureBefore[f.projectId] = snap;
  say(`fixture BEFORE "${snap.title}": pkgs=${snap.packageCount} bids=${snap.bidCount} agreements=${snap.agreementCount} convos=${snap.packages.reduce((a, p) => a + p.conversations, 0)} contractors=${snap.packages.reduce((a, p) => a + p.contractors, 0)}`);
}

let deleted = 0;
for (const f of mine) {
  try {
    await client.mutation("projects:deleteProject", { projectId: f.projectId });
    deleted += 1;
    say(`deleted: ${f.tag}`);
  } catch (err) {
    say(`FAILED to delete ${f.tag}: ${err?.data ? JSON.stringify(err.data) : err?.message}`);
  }
}

const after = await withRetry("listProjects", () => client.query("projects:listProjects", {}));
say(`projects AFTER: ${after.length} [${after.map((p) => `${p.title}${p.isDemoProject ? " (DEMO)" : ""}`).join(" | ")}]`);

const cascade = {};
for (const f of mine) {
  const pkgIds = fixtureBefore[f.projectId].packages.map((p) => p.packageId);
  const post = {};
  for (const pid of pkgIds) {
    const [bids, contractors, convos] = await Promise.all([
      withRetry("bids", () => client.query("bids:listByPackage", { tradePackageId: pid }).catch(() => [])),
      withRetry("contractors", () => client.query("contractors:listByPackage", { tradePackageId: pid }).catch(() => [])),
      withRetry("conversations", () => client.query("rfq:listConversations", { tradePackageId: pid }).catch(() => [])),
    ]);
    post[pid] = { bids: bids.length, contractors: contractors.length, conversations: convos.length };
  }
  const stillListed = after.some((p) => p._id === f.projectId);
  cascade[f.tag] = { projectStillListed: stillListed, packageIdCounts: post };
  say(`cascade ${f.tag}: stillListed=${stillListed} packageIdCounts=${JSON.stringify(post)}`);
  if (Object.values(post).every((v) => v.bids === 0 && v.contractors === 0 && v.conversations === 0)) {
    say(`  cascade clean: 0 bids/0 contractors/0 conversations on former package ids`);
  }
}

const demoAfter = await snapshotProject(demo._id);
say(`demo AFTER: title="${demoAfter.title}" demo=${demoAfter.isDemoProject} pkgs=${demoAfter.packageCount} bids=${demoAfter.bidCount} agreements=${demoAfter.agreementCount}`);
const integrity = {
  titleUnchanged: demoAfter.title === demoBefore.title,
  isDemoProjectUnchanged: demoAfter.isDemoProject === demoBefore.isDemoProject,
  estBudgetUnchanged: demoAfter.estBudget === demoBefore.estBudget,
  packageCountUnchanged: demoAfter.packageCount === demoBefore.packageCount,
  packageCountPositive: demoAfter.packageCount > 0,
  bidCountUnchanged: demoAfter.bidCount === demoBefore.bidCount,
  agreementCountUnchanged: demoAfter.agreementCount === demoBefore.agreementCount,
};
say(`demo integrity: ${JSON.stringify(integrity)}`);

const remainingNonDemo = after.filter((p) => !p.isDemoProject);
const out = {
  at: new Date().toISOString(),
  deleted,
  demoBefore, demoAfter, integrity,
  cascade,
  fixtureBefore,
  projectsBefore: before.map((p) => ({ id: p._id, title: p.title, isDemoProject: p.isDemoProject })),
  projectsAfter: after.map((p) => ({ id: p._id, title: p.title, isDemoProject: p.isDemoProject })),
  remainingNonDemo: remainingNonDemo.map((p) => ({ id: p._id, title: p.title })),
  backendDemoOnly: after.length === 1 && after[0].isDemoProject,
};
fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-cleanup.json"), JSON.stringify(out, null, 2), "utf8");
fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa11-cleanup.txt"), log.join("\n") + "\n", "utf8");
console.log("wrote remediation-qa11-cleanup.json/.txt");
console.log(`deleted ${deleted}/2; backendDemoOnly=${out.backendDemoOnly}; remainingNonDemo=${remainingNonDemo.length}`);
process.exitCode = deleted === 2 && integrity.packageCountPositive && Object.values(integrity).every(Boolean) ? 0 : 1;