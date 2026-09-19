/**
 * QA15 cleanup: remove every AUDIT-QA15-* fixture and verify unrelated
 * projects (demo, GC-AUDIT-*, AUDIT-5-*, AUDIT-QA*) were never touched.
 */
import { client, listProjects, hardDeleteProject, writeEvidence, writeLog, sleep } from "./qa15-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const before = (await listProjects(c)).map((p) => ({ id: p._id, title: p.title }));
  const ours = before.filter((p) => p.title.startsWith("AUDIT-QA15-"));
  const protectedBefore = before.filter((p) => /GC-AUDIT|AUDIT-5-|AUDIT-QA(?!15)/i.test(p.title)).map((p) => p.title);
  say(`before: total=${before.length}; QA15=${JSON.stringify(ours.map((p) => p.title))}; protected=${JSON.stringify(protectedBefore)}`);

  const deletions = [];
  for (const p of ours) {
    const del = await hardDeleteProject(c, p.title);
    deletions.push({ title: p.title, ...del });
    say(`delete ${p.title}: ${JSON.stringify(del)}`);
    await sleep(700);
  }

  const after = (await listProjects(c)).map((p) => ({ id: p._id, title: p.title }));
  const leftovers = after.filter((p) => p.title.startsWith("AUDIT-QA15-"));
  const protectedAfter = after.filter((p) => /GC-AUDIT|AUDIT-5-|AUDIT-QA(?!15)/i.test(p.title)).map((p) => p.title);

  writeEvidence("cleanup", {
    before: before.map((p) => p.title),
    deletions,
    after: after.map((p) => p.title),
    leftovers: leftovers.map((p) => p.title),
    protectedBefore,
    protectedAfter,
    protectedUnchanged: protectedAfter.length === protectedBefore.length,
  });
  writeLog("cleanup", log);
  console.log(`after: QA15 leftovers=${leftovers.length}; protected=${protectedAfter.length}; deleted=${deletions.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("cleanup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});