/** QA19-99: delete only AUDIT-QA19-* fixtures created by this round. */
import { client, writeEvidence, writeLog, sleep, listProjects, PREFIX } from "./qa19-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const TITLES = ["AUDIT-QA19-LIVE", "AUDIT-QA19-DEADLINE", "AUDIT-QA19-SIM"];

async function main() {
  const projectsBefore = await listProjects(c);
  say(`projects before: ${projectsBefore.length}`);
  const untouched = projectsBefore.filter((p) => !String(p.title).startsWith(PREFIX)).map((p) => p.title);
  say(`untouched projects: ${untouched.join(" | ")}`);

  const results = [];
  for (const title of TITLES) {
    const p = projectsBefore.find((x) => x.title === title);
    if (!p) {
      results.push({ title, deleted: false, reason: "not found" });
      continue;
    }
    const agreements = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agreements) {
      if (a.status === "executed") {
        try {
          await c.mutation("agreements:voidExecutedAgreement", {
            agreementId: a._id,
            reason: "QA19 teardown: void recorded execution before deleting the AUDIT-QA19 fixture.",
          });
        } catch (e) {
          say(`void failed for ${a._id}: ${e?.data ?? e?.message}`);
        }
      }
    }
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      results.push({ title, deleted: true, agreementsVoided: agreements.filter((a) => a.status === "executed").length });
      say(`deleted ${title} (${p._id})`);
    } catch (e) {
      results.push({ title, deleted: false, error: String(e?.data ?? e?.message).slice(0, 200) });
      say(`ERROR deleting ${title}: ${e?.data ?? e?.message}`);
    }
    await sleep(600);
  }

  // second pass for any stragglers
  const after = await listProjects(c);
  for (const p of after.filter((x) => String(x.title).startsWith(PREFIX))) {
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      say(`second-pass deleted ${p.title}`);
    } catch (e) {
      say(`second-pass ERROR ${p.title}: ${e?.data ?? e?.message}`);
    }
  }

  const projectsAfter = await listProjects(c);
  const remaining = projectsAfter.filter((p) => String(p.title).startsWith(PREFIX)).map((p) => p.title);
  const untouchedAfter = projectsAfter.filter((p) => !String(p.title).startsWith(PREFIX)).map((p) => p.title);
  const unrelatedBefore = new Set(untouched.filter((t) => !t.startsWith(PREFIX)));
  const unrelatedAfter = new Set(untouchedAfter);
  const lost = [...unrelatedBefore].filter((t) => !unrelatedAfter.has(t));
  const added = [...unrelatedAfter].filter((t) => !unrelatedBefore.has(t));
  say(`projects after: ${projectsAfter.length}; remaining QA19: ${remaining.join(",") || "none"}`);
  say(`unrelated lost: ${lost.join(",") || "none"}; unrelated added (other agents): ${added.join(",") || "none"}`);

  writeEvidence("cleanup", {
    results,
    projectsBefore: projectsBefore.length,
    projectsAfter: projectsAfter.length,
    remainingQa19: remaining,
    unrelatedLost: lost,
    unrelatedAdded: added,
    untouchedAfter,
  });
  writeLog("cleanup", log);
}

main().catch((e) => {
  console.error(e);
  writeLog("cleanup-crash", [String((e && e.stack) || e)]);
  process.exit(1);
});