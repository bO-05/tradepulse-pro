import { client, listQa10Projects, isQa10Title, writeEvidence, writeLog } from "./qa10-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const all = await c.query("projects:listProjects", {});
  const qa10 = (all || []).filter((p) => isQa10Title(p.title));
  const others = (all || []).filter((p) => !isQa10Title(p.title));
  say(`before cleanup: ${qa10.length} QA10 projects; ${others.length} non-QA10 projects left untouched`);
  say(`others: ${others.map((p) => `${p.title.slice(0, 44)}${p.isDemoProject ? " [demo]" : ""}`).join(" | ")}`);

  const outcomes = [];
  for (const p of qa10) {
    try {
      const res = await c.mutation("projects:deleteProject", { projectId: p._id });
      outcomes.push({ title: p.title, id: p._id, ok: true, res });
      say(`deleted ${p.title} (${p._id})`);
    } catch (e) {
      outcomes.push({ title: p.title, id: p._id, ok: false, error: (e?.data ?? e?.message ?? String(e)).toString().slice(0, 160) });
      say(`FAILED to delete ${p.title}: ${(e?.data ?? e?.message ?? "").toString().slice(0, 120)}`);
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  const after = await listQa10Projects(c);
  const leftovers = after.map((p) => ({ title: p.title, id: p._id }));
  say(`after cleanup: ${leftovers.length} QA10 projects remain`);
  if (leftovers.length) say(`LEFTOVERS: ${JSON.stringify(leftovers)}`);

  // orphan sweep by index across remaining tables referencing deleted ids
  const projectIds = new Set((await c.query("projects:listProjects", {})).map((p) => p._id));
  const oldIds = new Set(qa10.map((p) => p._id));
  const filename = `fix4-qa10-final-state`;
  writeEvidence("cleanup", { generatedAt: new Date().toISOString(), deleted: outcomes, leftovers, nonQa10Count: others.length, log });
  writeLog("cleanup", log);
  console.log(`\nCLEANUP: deleted=${outcomes.filter((o) => o.ok).length}/${qa10.length} leftovers=${leftovers.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });