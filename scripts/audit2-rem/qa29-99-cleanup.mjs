/**
 * QA29-99 cleanup: removes EVERY AUDIT-QA29-* project (voiding executed agreements first)
 * and proves no other fixture family (demo/GC-AUDIT/AUDIT-5/AUDIT-QA<n> non-29) was touched.
 */
import { client, writeEvidence, writeLog, sleep } from "./qa29-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

function countPrefixes(projects) {
  const counts = { qa29: 0, otherAuditQa: 0, audit5: 0, gcAudit: 0, demo: 0, other: 0 };
  for (const p of projects) {
    const t = p.title || "";
    if (t.startsWith("AUDIT-QA29-")) counts.qa29++;
    else if (/^AUDIT-QA\d+-/.test(t)) counts.otherAuditQa++;
    else if (/^AUDIT-5-/.test(t)) counts.audit5++;
    else if (/^GC-AUDIT/.test(t)) counts.gcAudit++;
    else if (p.isDemoProject) counts.demo++;
    else counts.other++;
  }
  return counts;
}

async function main() {
  const beforeProjects = (await c.query("projects:listProjects", {})) || [];
  const before = countPrefixes(beforeProjects);
  say(`before: ${JSON.stringify(before)}`);

  for (const p of beforeProjects.filter((x) => (x.title || "").startsWith("AUDIT-QA29-"))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA29 fixture teardown of executed record before deletion.",
        });
      } catch (err) {
        say(`void ${a.agreementNumber} failed: ${err?.data ?? err?.message}`);
      }
    }
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      say(`deleted ${p.title}`);
    } catch (err) {
      say(`delete ${p.title} failed: ${err?.data ?? err?.message}`);
    }
    await sleep(250);
  }

  const afterProjects = (await c.query("projects:listProjects", {})) || [];
  const after = countPrefixes(afterProjects);
  say(`after: ${JSON.stringify(after)}`);

  const out = {
    before,
    after,
    qa29Remaining: afterProjects.filter((x) => (x.title || "").startsWith("AUDIT-QA29-")).map((x) => x.title),
    untouchedOtherFamilies:
      after.otherAuditQa === before.otherAuditQa &&
      after.audit5 === before.audit5 &&
      after.gcAudit === before.gcAudit &&
      after.demo === before.demo,
    pass: after.qa29 === 0 && afterProjects.every((x) => !(x.title || "").startsWith("AUDIT-QA29-")) &&
      after.otherAuditQa === before.otherAuditQa && after.audit5 === before.audit5 &&
      after.gcAudit === before.gcAudit && after.demo === before.demo,
  };
  writeEvidence("cleanup", out);
  writeLog("cleanup", log);
  console.log(`cleanup: qa29Remaining=${out.qa29Remaining.length} pass=${out.pass}`);
  if (!out.pass) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("cleanup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});