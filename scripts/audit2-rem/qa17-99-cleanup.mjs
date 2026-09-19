/**
 * QA17-99 cleanup: remove AUDIT-QA17-* fixtures only. Never touches demo,
 * GC-AUDIT, AUDIT-5-*, or AUDIT-QA* projects.
 */
import { client, listProjects, hardDeleteProject, writeEvidence, writeLog } from "./qa17-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const OWNED = ["AUDIT-QA17-DEADLINE", "AUDIT-QA17-NAME"];

async function main() {
  const before = (await listProjects(c)).map((p) => p.title);
  const removed = [];
  for (const title of OWNED) {
    const res = await hardDeleteProject(c, title);
    removed.push({ title, ...res });
    say(`${title}: ${JSON.stringify(res)}`);
  }
  const after = await listProjects(c);
  const afterTitles = after.map((p) => p.title);
  const leftovers = afterTitles.filter((t) => (t || "").startsWith("AUDIT-QA17-"));
  const untouched = {
    demo: afterTitles.filter((t) => /Domain Tower/i.test(t)),
    gcAudit: afterTitles.filter((t) => (t || "").startsWith("GC-AUDIT")),
    audit5: afterTitles.filter((t) => (t || "").startsWith("AUDIT-5-")),
    auditQA: afterTitles.filter((t) => (t || "").startsWith("AUDIT-QA") && !(t || "").startsWith("AUDIT-QA17-")),
  };
  say(`leftover QA17: ${JSON.stringify(leftovers)}`);
  say(`untouched: ${JSON.stringify(untouched)}`);
  writeEvidence("cleanup", { beforeCount: before.length, removed, afterCount: after.length, leftovers, untouched, pass: leftovers.length === 0 && removed.every((r) => r.deleted || r.note === "not present") });
  writeLog("cleanup", log);
}

main().catch((e) => {
  console.error(e);
  writeLog("cleanup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});