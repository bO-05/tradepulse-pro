/**
 * QA34-99 cleanup: remove every AUDIT-QA34-* fixture (voiding executed records first)
 * and verify zero collateral damage to any other project (demo / GC-AUDIT / AUDIT-5-* /
 * prior AUDIT-QA*).
 */
import fs from "node:fs";
import path from "node:path";
import { client, writeEvidence, writeLog, sleep } from "./qa34-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function listAll() {
  return (await c.query("projects:listProjects", {})) || [];
}

async function main() {
  const before = await listAll();
  const qa34Before = before.filter((p) => p.title.startsWith("AUDIT-QA34-")).map((p) => p.title).sort();
  const othersBefore = before.filter((p) => !p.title.startsWith("AUDIT-QA34-")).map((p) => ({ title: p.title, id: p._id }));

  for (const p of before.filter((x) => x.title.startsWith("AUDIT-QA34-"))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA34 teardown of executed fixture record before deletion." });
        say(`voided ${a.agreementNumber} on ${p.title}`);
      } catch (err) {
        say(`void failed on ${p.title}: ${err?.data ?? err?.message}`);
      }
    }
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      say(`deleted ${p.title}`);
    } catch (err) {
      say(`delete failed ${p.title}: ${err?.data ?? err?.message}`);
    }
    await sleep(300);
  }

  const after = await listAll();
  const qa34After = after.filter((p) => p.title.startsWith("AUDIT-QA34-")).map((p) => p.title).sort();
  const othersAfter = after.filter((p) => !p.title.startsWith("AUDIT-QA34-")).map((p) => ({ title: p.title, id: p._id }));
  const untouched = JSON.stringify(othersBefore) === JSON.stringify(othersAfter);
  say(`qa34 before=${qa34Before.length} after=${qa34After.length}; other projects untouched=${untouched}`);
  writeEvidence("cleanup", { qa34Before, qa34After, othersBefore, othersAfter, othersUntouched: untouched });
  writeLog("cleanup", log);

  const evidenceDir = path.resolve("evidence");
  const qa34Files = fs.readdirSync(evidenceDir).filter((f) => f.startsWith("fix4-qa34-"));
  say(`qa34 evidence files retained: ${qa34Files.length} ${JSON.stringify(qa34Files)}`);
  console.log(`cleanup: qa34Remaining=${qa34After.length} othersUntouched=${untouched}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("cleanup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});