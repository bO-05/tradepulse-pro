/** QA21-99: delete ONLY AUDIT-QA21-* fixtures and prove protected projects survive. */
import { client, listProjects, purgeQa21, writeEvidence, writeLog, PREFIX } from "./qa21-lib.mjs";

const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const c = client();
  const before = await listProjects(c);
  const protectedBefore = before
    .filter((p) => !String(p.title).startsWith(PREFIX))
    .map((p) => ({ id: p._id, title: p.title }));

  const purged = await purgeQa21(c, say);

  const after = await listProjects(c);
  const leftovers = after.filter((p) => String(p.title).startsWith(PREFIX));
  const protectedAfter = after.map((p) => ({ id: p._id, title: p.title }));
  const protectedSurvivors = protectedBefore.filter((p) => protectedAfter.some((q) => q.id === p.id));
  const missing = protectedBefore.filter((p) => !protectedAfter.some((q) => q.id === p.id));

  const out = {
    generatedAt: new Date().toISOString(),
    purgedCount: purged,
    qa21Leftovers: leftovers.map((p) => ({ id: p._id, title: p.title })),
    protectedProjectsBefore: protectedBefore,
    protectedProjectsAfter: protectedAfter,
    protectedSurvivors: protectedSurvivors.length,
    protectedMissing: missing,
  };
  say(`purged=${purged} leftovers=${leftovers.length} protected=${protectedAfter.length} missing=${missing.length}`);
  writeEvidence("99-cleanup", out);
  writeLog("99-cleanup", log);
  if (leftovers.length > 0 || missing.length > 0) {
    console.error("CLEANUP INCOMPLETE");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("99-cleanup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});