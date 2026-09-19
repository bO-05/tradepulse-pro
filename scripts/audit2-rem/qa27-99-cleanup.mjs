/**
 * QA27-99 cleanup: void any executed QA27 agreements, delete all AUDIT-QA27-*
 * projects, prove foreign projects are untouched.
 */
import { client, writeEvidence, writeLog, sleep } from "./qa27-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function allProjects() {
  return (await c.query("projects:listProjects", {})) || [];
}

async function main() {
  const before = await allProjects();
  const foreignBefore = before.filter((p) => !p.title.startsWith("AUDIT-QA27-")).map((p) => `${p.title}|${p._id}`);
  const mine = before.filter((p) => p.title.startsWith("AUDIT-QA27-"));
  const deleted = [];
  const leftovers = [];

  for (const p of mine) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA27 cleanup: voiding executed agreement before fixture deletion.",
        });
      } catch (err) {
        say(`void ${a.agreementNumber} failed: ${err?.data ?? err?.message}`);
      }
    }
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      deleted.push(p.title);
      say(`deleted ${p.title}`);
    } catch (err) {
      say(`delete ${p.title} failed: ${err?.data ?? err?.message}`);
      leftovers.push(p.title);
    }
    await sleep(300);
  }

  const after = await allProjects();
  const foreignAfter = after.filter((p) => !p.title.startsWith("AUDIT-QA27-")).map((p) => `${p.title}|${p._id}`);
  const stillMine = after.filter((p) => p.title.startsWith("AUDIT-QA27-")).map((p) => p.title);
  const foreignUnchanged = JSON.stringify(foreignBefore) === JSON.stringify(foreignAfter);

  const report = {
    capturedAt: new Date().toISOString(),
    deleted,
    leftovers,
    stillMine,
    foreignUnchanged,
    foreignCount: foreignAfter.length,
  };
  say(`deleted=${JSON.stringify(deleted)} stillMine=${JSON.stringify(stillMine)} foreignUnchanged=${foreignUnchanged}`);
  writeEvidence("cleanup", report);
  writeLog("cleanup", log);
  console.log("cleanup done");
}

main().catch((e) => {
  console.error(e);
  writeLog("cleanup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});