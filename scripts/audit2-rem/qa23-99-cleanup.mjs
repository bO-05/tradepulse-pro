/**
 * QA23-99 cleanup: purge ONLY AUDIT-QA23-* fixtures and prove nothing foreign changed.
 */
import { client, listProjects, writeEvidence, writeLog, purgeQa23, PREFIX } from "./qa23-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const before = await listProjects(c);
  const foreignBefore = before.filter((p) => !String(p.title).startsWith(PREFIX)).map((p) => `${p._id}:${p.title}`).sort();
  const qaBefore = before.filter((p) => String(p.title).startsWith(PREFIX)).map((p) => `${p._id}:${p.title}`).sort();

  const deleted = await purgeQa23(c, say);

  const after = await listProjects(c);
  const foreignAfter = after.filter((p) => !String(p.title).startsWith(PREFIX)).map((p) => `${p._id}:${p.title}`).sort();
  const leftovers = after.filter((p) => String(p.title).startsWith(PREFIX)).map((p) => `${p._id}:${p.title}`);

  const out = {
    deleted,
    qaBefore,
    leftovers,
    foreignUnchanged: JSON.stringify(foreignBefore) === JSON.stringify(foreignAfter),
    foreignCount: foreignAfter.length,
    sampleForeign: foreignAfter.slice(0, 12),
  };
  say(`deleted=${deleted} leftovers=${leftovers.length} foreignUnchanged=${out.foreignUnchanged}`);
  writeEvidence("99-cleanup", out);
  writeLog("99-cleanup", log);
  if (leftovers.length > 0 || !out.foreignUnchanged) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("99-cleanup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});