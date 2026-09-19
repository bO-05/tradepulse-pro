import { client, writeEvidence, writeLog, sleep } from "./qa14-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const before = (await c.query("projects:listProjects", {})) || [];
  const mine = before.filter((p) => p.title.startsWith("AUDIT-QA14-"));
  const result = { attempted: mine.map((p) => p.title), deleted: [], failed: [], leftover: [], orphanPackages: [] };

  for (const p of mine) {
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      result.deleted.push(p.title);
      say(`deleted ${p.title}`);
    } catch (err) {
      const msg = String(err?.data ?? err?.message ?? err).split("\n")[0];
      result.failed.push({ title: p.title, error: msg });
      say(`FAILED to delete ${p.title}: ${msg}`);
    }
  }
  await sleep(1500);
  const after = (await c.query("projects:listProjects", {})) || [];
  result.leftover = after.filter((p) => p.title.startsWith("AUDIT-QA14-")).map((p) => ({ id: p._id, title: p.title }));
  say(`leftover projects: ${JSON.stringify(result.leftover)}`);

  const fx = result.deleted.length ? null : null;
  const globalLogs = (await c.query("auditLogs:listRecentLogs", { limit: 300 })) || [];
  const qa14Logs = globalLogs.filter((l) => /AUDIT-QA14/.test(l.title) || /AUDIT-QA14/.test(l.description || ""));
  result.qa14LogRowsRemainingInRecent300 = qa14Logs.map((l) => l.title);

  // Confirm all QA14 projects are gone wherever they are referenced.
  const allProjects = (await c.query("projects:listProjects", {})) || [];
  for (const p of allProjects) {
    if (p.title.startsWith("AUDIT-QA14-")) continue;
    const pkgs = (await c.query("tradePackages:listByProject", { projectId: p._id })) || [];
    for (const pkg of pkgs) {
      if (pkg.tradeName.includes("AUDIT-QA14")) {
        result.orphanPackages.push({ project: p.title, package: pkg.tradeName });
      }
    }
  }
  say(`orphan packages: ${JSON.stringify(result.orphanPackages)}`);

  writeEvidence("cleanup", result);
  writeLog("cleanup", log);
  const clean = result.failed.length === 0 && result.leftover.length === 0 && result.orphanPackages.length === 0;
  console.log(`CLEAN=${clean}`);
  if (!clean) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});