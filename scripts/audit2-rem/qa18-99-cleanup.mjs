import { client, PREFIX, writeEvidence, writeLog, sleep, findProjectByTitle } from "./qa18-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const TITLES = ["AUDIT-QA18-VOL", "AUDIT-QA18-UNI", "AUDIT-QA18-FILE", "AUDIT-QA18-LIVE"];

async function main() {
  const projectsBefore = (await c.query("projects:listProjects", {})) || [];
  say(`projects before: ${projectsBefore.length}`);
  const forbidden = projectsBefore.filter((p) => !String(p.title).startsWith(PREFIX) && !/The Domain|AUDIT-QA16|AUDIT-QA15|AUDIT-QA13|AUDIT-5|AUDIT-4|GC-AUDIT|QA-REM|AUDIT-QA1/.test(p.title));
  say(`other projects present (untouched): ${forbidden.map((p) => p.title).join(" | ").slice(0, 400)}`);

  const results = [];
  for (const t of TITLES) {
    const p = await findProjectByTitle(c, t);
    if (!p) { results.push({ title: t, deleted: false, reason: "not found" }); continue; }
    try {
      const files = (await c.query("files:listFilesByProject", { projectId: p._id })) || [];
      await c.mutation("projects:deleteProject", { projectId: p._id });
      results.push({ title: t, deleted: true, filesCascaded: files.length });
      say(`deleted ${t} (${p._id}), files cascaded=${files.length}`);
    } catch (e) {
      results.push({ title: t, deleted: false, error: String(e.message).slice(0, 200) });
      say(`ERROR deleting ${t}: ${e.message}`);
    }
    await sleep(500);
  }

  const projectsAfter = (await c.query("projects:listProjects", {})) || [];
  const remainingQa18 = projectsAfter.filter((p) => String(p.title).startsWith(PREFIX));
  say(`projects after: ${projectsAfter.length}; remaining AUDIT-QA18: ${remainingQa18.length}`);
  for (const r of remainingQa18) {
    try {
      await c.mutation("projects:deleteProject", { projectId: r._id });
      say(`second-pass deleted ${r.title}`);
    } catch (e) {
      say(`second-pass ERROR ${r.title}: ${e.message}`);
    }
  }

  // check stray file rows referencing deleted fixtures
  const projIds = new Set(projectsAfter.map((p) => p._id));
  const allFiles = await Promise.all(
    [...projIds].slice(0, 50).map((pid) => c.query("files:listFilesByProject", { projectId: pid }).catch(() => []))
  );
  const strayFiles = allFiles.flat().filter((f) => !projIds.has(f.projectId));
  say(`stray file rows: ${strayFiles.length}`);

  writeEvidence("cleanup", { results, projectsBefore: projectsBefore.length, projectsAfter: projectsAfter.length, remainingQa18: remainingQa18.map((p) => p.title), strayFiles: strayFiles.length });
  writeLog("cleanup", log);
}

main().catch((e) => { console.error(e); writeLog("cleanup-crash", [String(e.stack || e)]); process.exit(1); });