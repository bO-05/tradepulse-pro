/**
 * QA28-99 cleanup: remove every AUDIT-QA28-* fixture (voiding executed records first)
 * and verify no collateral damage to any other project (demo / GC-AUDIT / AUDIT-5-* /
 * prior AUDIT-QA*).
 */
import { client, writeEvidence, writeLog, sleep } from "./qa28-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function listAll() {
  return (await c.query("projects:listProjects", {})) || [];
}

async function main() {
  const before = await listAll();
  const othersBefore = before.filter((p) => !p.title.startsWith("AUDIT-QA28-")).map((p) => p.title).sort();
  const qa28Before = before.filter((p) => p.title.startsWith("AUDIT-QA28-")).map((p) => p.title).sort();

  for (const p of before.filter((x) => x.title.startsWith("AUDIT-QA28-"))) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA28 teardown of executed fixture record before deletion." });
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
  const qa28After = after.filter((p) => p.title.startsWith("AUDIT-QA28-")).map((p) => p.title).sort();
  const othersAfter = after.filter((p) => !p.title.startsWith("AUDIT-QA28-")).map((p) => p.title).sort();
  const collateral = {
    qa28Remaining: qa28After,
    othersBefore,
    othersAfter,
    othersUntouched: JSON.stringify(othersBefore) === JSON.stringify(othersAfter),
  };
  say(`qa28 before=${qa28Before.length} after=${qa28After.length}; other projects untouched=${collateral.othersUntouched}`);
  writeEvidence("cleanup", { qa28Before, qa28After, ...collateral });
  writeLog("cleanup", log);
  console.log(`cleanup: qa28Remaining=${qa28After.length} othersUntouched=${collateral.othersUntouched}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("cleanup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});