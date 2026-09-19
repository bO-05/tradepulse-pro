/**
 * QA37-99 cleanup: delete only AUDIT-QA37-* projects (voiding executed agreements first).
 * Never touches demo / GC-AUDIT / AUDIT-5-* / AUDIT-QA36-* or any other prefix.
 */
import { client, writeEvidence, writeLog, sleep } from "./qa37-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  const mine = projects.filter((p) => p.title.startsWith("AUDIT-QA37-"));
  const others = projects.filter((p) => !p.title.startsWith("AUDIT-QA37-"));
  const deleted = [];
  const failed = [];
  for (const p of mine) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA37 final teardown of executed record." });
        say(`voided ${a.agreementNumber} in ${p.title}`);
      } catch (err) {
        say(`void ${a.agreementNumber} failed: ${err?.data ?? err?.message}`);
      }
    }
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      deleted.push(p.title);
      say(`deleted ${p.title}`);
    } catch (err) {
      failed.push({ title: p.title, err: String(err?.data ?? err?.message) });
      say(`delete ${p.title} failed: ${err?.data ?? err?.message}`);
    }
    await sleep(250);
  }
  await sleep(800);
  const after = (await c.query("projects:listProjects", {})) || [];
  const leftover = after.filter((p) => p.title.startsWith("AUDIT-QA37-"));
  const othersUntouched = others.map((p) => ({ title: p.title, stillPresent: after.some((x) => x._id === p._id) }));
  const result = {
    deleted,
    failed,
    leftover: leftover.map((p) => ({ id: p._id, title: p.title })),
    othersUntouched,
    clean: leftover.length === 0 && failed.length === 0,
  };
  say(`cleanup: deleted=${deleted.length} failed=${failed.length} leftover=${leftover.length} othersStillPresent=${othersUntouched.filter((o) => o.stillPresent).length}/${others.length}`);
  writeEvidence("cleanup", result);
  writeLog("cleanup", log);
}
main().catch((e) => {
  console.error(e);
  writeLog("cleanup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});