/**
 * QA33-99: purge every AUDIT-QA33-* fixture project (voiding executed agreements first)
 * and prove no other project was touched: the non-QA33 project list must be identical
 * before and after, and zero AUDIT-QA33-* projects may remain.
 */
import { client, writeEvidence, writeLog } from "./qa33-lib.mjs";
import { purgeQa33 } from "./qa33-01-fixtures.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const titles = (projects) => (projects || []).map((p) => p.title).sort();
const nonQa33 = (projects) => titles((projects || []).filter((p) => !p.title.startsWith("AUDIT-QA33-")));

async function main() {
  const before = await c.query("projects:listProjects", {});
  const beforeOthers = nonQa33(before);
  say(`before: ${titles(before).length} projects, ${beforeOthers.length} non-QA33`);

  await purgeQa33(c);

  const after = await c.query("projects:listProjects", {});
  const afterOthers = nonQa33(after);
  const leftover = titles(after).filter((t) => t.startsWith("AUDIT-QA33-"));
  const othersUnchanged = JSON.stringify(beforeOthers) === JSON.stringify(afterOthers);

  const evidence = {
    beforeCount: titles(before).length,
    afterCount: titles(after).length,
    qa33Leftover: leftover,
    othersUnchanged,
    nonQa33Count: afterOthers.length,
    nonQa33Sample: afterOthers.slice(0, 20),
    pass: leftover.length === 0 && othersUnchanged,
  };
  say(`after: ${titles(after).length} projects, QA33 leftover=${leftover.length}, others unchanged=${othersUnchanged}`);
  writeEvidence("cleanup", evidence);
  writeLog("cleanup", log);
  console.log(evidence.pass ? "cleanup: PASS" : "cleanup: FAIL");
  if (!evidence.pass) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("cleanup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});