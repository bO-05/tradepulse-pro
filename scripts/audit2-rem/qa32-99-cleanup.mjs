/**
 * QA32-99 cleanup: remove every AUDIT-QA32-* fixture (voiding executed records first)
 * and verify no collateral damage to any other project (demo / GC-AUDIT / AUDIT-5-* /
 * prior AUDIT-QA*).
 */
import fs from "node:fs";
import path from "node:path";
import { client, writeEvidence, writeLog, sleep } from "./qa32-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function listAll() {
  return (await c.query("projects:listProjects", {})) || [];
}

async function main() {
  const before = await listAll();
  const othersBefore = before.filter((p) => !p.title.startsWith("AUDIT-QA32-")).map((p) => p.title).sort();
  const qa32Before = before.filter((p) => p.title.startsWith("AUDIT-QA32-")).map((p) => p.title).sort();

  for (const p of before.filter((x) => x.title.startsWith("AUDIT-QA32-"))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA32 teardown of executed fixture record before deletion." });
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
  const qa32After = after.filter((p) => p.title.startsWith("AUDIT-QA32-")).map((p) => p.title).sort();
  const othersAfter = after.filter((p) => !p.title.startsWith("AUDIT-QA32-")).map((p) => p.title).sort();
  const collateral = {
    qa32Remaining: qa32After,
    othersBefore,
    othersAfter,
    othersUntouched: JSON.stringify(othersBefore) === JSON.stringify(othersAfter),
  };
  say(`qa32 before=${qa32Before.length} after=${qa32After.length}; other projects untouched=${collateral.othersUntouched}`);
  writeEvidence("cleanup", { qa32Before, qa32After, ...collateral });
  writeLog("cleanup", log);
  console.log(`cleanup: qa32Remaining=${qa32After.length} othersUntouched=${collateral.othersUntouched}`);

  const evidenceDir = path.resolve("evidence");
  const qa32Files = fs.readdirSync(evidenceDir).filter((f) => f.startsWith("fix4-qa32-"));
  say(`qa32 evidence files retained: ${qa32Files.length} ${JSON.stringify(qa32Files)}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("cleanup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});