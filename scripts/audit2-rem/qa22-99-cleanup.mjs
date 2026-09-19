/**
 * QA22-99 cleanup: delete ONLY AUDIT-QA22-* projects (voiding executed
 * agreements first). Confirms foreign fixtures/demo remain, then scans for
 * leftovers. Never touches demo, GC-AUDIT, AUDIT-5-*, or other AUDIT-QA rounds.
 */
import { client, writeEvidence, writeLog, sleep } from "./qa22-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = { deleted: [], failed: [], before: [], after: [] };

const before = (await c.query("projects:listProjects", {})) || [];
out.before = before.map((p) => p.title);
out.foreignBefore = before.filter((p) => !p.title.startsWith("AUDIT-QA22-")).map((p) => p.title);

for (const p of before.filter((x) => x.title.startsWith("AUDIT-QA22-"))) {
  const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
  for (const a of agrs.filter((x) => x.status === "executed")) {
    try {
      await c.mutation("agreements:voidExecutedAgreement", {
        agreementId: a._id,
        reason: "QA22 teardown: void executed record before deleting the fixture project.",
      });
      say(`voided ${a.agreementNumber}`);
    } catch (err) {
      say(`void ${a.agreementNumber} failed: ${err?.data ?? err?.message}`);
    }
  }
  try {
    await c.mutation("projects:deleteProject", { projectId: p._id });
    out.deleted.push(p.title);
    say(`deleted ${p.title}`);
  } catch (err) {
    out.failed.push({ title: p.title, error: String(err?.data ?? err?.message) });
    say(`DELETE FAILED ${p.title}: ${err?.data ?? err?.message}`);
  }
  await sleep(250);
}

const after = (await c.query("projects:listProjects", {})) || [];
out.after = after.map((p) => p.title);
out.leftovers = after.filter((p) => p.title.startsWith("AUDIT-QA22-")).map((p) => p.title);
out.foreignAfter = after.filter((p) => !p.title.startsWith("AUDIT-QA22-")).map((p) => p.title);
out.foreignUnchanged = JSON.stringify(out.foreignBefore.sort()) === JSON.stringify(out.foreignAfter.sort());
say(`deleted=${out.deleted.length} leftovers=${out.leftovers.length} foreignUnchanged=${out.foreignUnchanged}`);
writeEvidence("cleanup", out);
writeLog("cleanup", log);
if (out.leftovers.length || out.failed.length) process.exitCode = 2;