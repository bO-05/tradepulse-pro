import { client, writeEvidence, writeLog, sleep } from "./qa16-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  const mine = projects.filter((p) => String(p.title).startsWith("AUDIT-QA16-"));
  say(`QA16 projects found: ${mine.map((p) => p.title).join(", ") || "(none)"}`);

  const deleted = [];
  for (const p of mine) {
    const agreements = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agreements) {
      if (a.status === "executed") {
        try {
          await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: `AUDIT-QA16 cleanup void of ${a.agreementNumber}` });
          say(`voided executed ${a.agreementNumber} in ${p.title}`);
        } catch (e) {
          say(`WARN void failed ${a.agreementNumber}: ${String(e?.data ?? e?.message ?? e)}`);
        }
      }
    }
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      deleted.push(p.title);
      say(`deleted ${p.title}`);
    } catch (e) {
      say(`WARN delete failed ${p.title}: ${String(e?.data ?? e?.message ?? e)}`);
    }
    await sleep(400);
  }

  const after = ((await c.query("projects:listProjects", {})) || []).map((p) => p.title);
  const leftovers = after.filter((t) => t.startsWith("AUDIT-QA16-"));
  const out = { deleted, leftovers, allProjects: after };
  writeEvidence("cleanup", out);
  writeLog("cleanup", log);
  console.log(JSON.stringify(out, null, 1));
}

main().catch((e) => { console.error(e); writeLog("cleanup-crash", [String(e?.stack || e)]); process.exit(1); });