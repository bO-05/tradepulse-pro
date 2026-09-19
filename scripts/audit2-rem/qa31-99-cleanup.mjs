/**
 * QA31-99 cleanup: removes every AUDIT-QA31-* fixture project (voiding executed
 * agreements first). Never touches demo / GC-AUDIT / AUDIT-5-* / AUDIT-QA*.
 */
import { client, writeEvidence, writeLog, sleep } from "./qa31-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  const targets = projects.filter((p) => p.title.startsWith("AUDIT-QA31-"));
  const purged = [];
  const failed = [];
  for (const p of targets) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA31 fixture teardown of executed record before cleanup.",
        });
      } catch (err) {
        say(`void ${a.agreementNumber} failed: ${err?.data ?? err?.message}`);
      }
    }
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      purged.push({ id: p._id, title: p.title });
      say(`purged ${p.title}`);
    } catch (err) {
      failed.push({ id: p._id, title: p.title, error: String(err?.data ?? err?.message) });
      say(`purge ${p.title} failed: ${err?.data ?? err?.message}`);
    }
    await sleep(250);
  }

  const remaining = ((await c.query("projects:listProjects", {})) || [])
    .filter((p) => p.title.startsWith("AUDIT-QA31-"))
    .map((p) => ({ id: p._id, title: p.title }));
  const out = { purged, failed, remaining, clean: remaining.length === 0 && failed.length === 0 };
  writeEvidence("cleanup", out);
  writeLog("cleanup", log);
  console.log(`cleanup: purged=${purged.length} failed=${failed.length} remaining=${remaining.length}`);
  if (!out.clean) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  writeLog("cleanup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});