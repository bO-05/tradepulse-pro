/**
 * QA20-99 cleanup: remove every AUDIT-QA20-* fixture project (voids executed
 * agreements first). Never touches demo, GC-AUDIT, AUDIT-5-*, or any other AUDIT-QA*.
 */
import { client, writeEvidence, writeLog, sleep } from "./qa20-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  const targets = projects.filter((p) => p.title.startsWith("AUDIT-QA20-"));
  say(`QA20 fixtures to remove: ${targets.length}`);
  for (const p of targets) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA20 sweep complete; removing fixture before handoff.",
        });
        say(`voided ${a.agreementNumber}`);
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
  const after = (await c.query("projects:listProjects", {})) || [];
  const leftover = after.filter((p) => p.title.startsWith("AUDIT-QA20-"));
  const untouched = after.map((p) => p.title);
  say(`leftover QA20: ${leftover.length}; remaining projects: ${JSON.stringify(untouched)}`);
  writeEvidence("cleanup", { removed: targets.map((p) => p.title), leftover: leftover.map((p) => p.title), remaining: untouched });
  writeLog("cleanup", log);
  console.log(leftover.length === 0 ? "cleanup OK" : "cleanup INCOMPLETE");
}

main().catch((e) => {
  console.error(e);
  writeLog("cleanup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});