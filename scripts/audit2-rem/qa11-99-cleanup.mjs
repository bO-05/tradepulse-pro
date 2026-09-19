import { client, writeEvidence, writeLog, sleep } from "./qa11-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const before = await c.query("projects:listProjects", {});
  const mine = before.filter((p) => p.title.startsWith("AUDIT-QA11-"));
  const result = { attempted: mine.map((p) => p.title), deleted: [], failed: [], leftover: [], executedLocked: [] };

  for (const p of mine) {
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      result.deleted.push(p.title);
      say(`deleted ${p.title}`);
    } catch (err) {
      const msg = String(err?.data ?? err?.message ?? err).split("\n")[0];
      result.failed.push({ title: p.title, error: msg });
      if (/executed subcontract/i.test(msg)) result.executedLocked.push(p.title);
      say(`FAILED to delete ${p.title}: ${msg}`);
    }
  }
  await sleep(1000);
  const after = await c.query("projects:listProjects", {});
  result.leftover = after.filter((p) => p.title.startsWith("AUDIT-QA11-")).map((p) => ({ id: p._id, title: p.title }));
  say(`leftover: ${JSON.stringify(result.leftover)}`);
  writeEvidence("cleanup", result);
  writeLog("cleanup", log);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});