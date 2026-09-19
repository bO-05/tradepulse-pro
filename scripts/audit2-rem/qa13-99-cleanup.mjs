import { client, listProjects, deleteProjectHard, call, writeEvidence, writeLog } from "./qa13-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${detail}`);
};

async function main() {
  const fixtures = JSON.parse(
    (await import("node:fs")).readFileSync("evidence/fix4-qa13-fixtures.json", "utf8")
  );
  const before = await listProjects(c);
  const beforeNonQa13 = before.filter((p) => !p.title.startsWith("AUDIT-QA13-")).map((p) => `${p._id}:${p.title}`).sort();

  // guarded contractor delete: elec1 still holds an awarded bid (no executed agreement)
  const guard = await call("HUNT guard: delete elec contractor with bid", () =>
    c.mutation("contractors:deleteContractor", { contractorId: fixtures.mainElecContractorId })
  );
  const guardText = `${guard.data ?? ""} ${guard.message ?? ""}`;
  const guardOk = !guard.ok && /proposal\(s\) on file|executed subcontract/i.test(guardText);
  record("HUNT-delete-contractor-guard", guardOk, `observed=${JSON.stringify(String(guard.data ?? guard.message).split("\n")[0])}`);
  const elecCtrStill = (await c.query("contractors:listByPackage", { tradePackageId: fixtures.mainElecPackageId })).some(
    (x) => x._id === fixtures.mainElecContractorId
  );
  record("HUNT-guard-contractor-still-present", elecCtrStill, `present=${elecCtrStill}`);

  // cleanup all AUDIT-QA13-* fixtures
  const mine = (await listProjects(c)).filter((p) => p.title.startsWith("AUDIT-QA13-"));
  const deletions = [];
  for (const p of mine) {
    const res = await deleteProjectHard(c, p._id);
    deletions.push({ title: p.title, id: p._id, ...res });
    say(`deleted ${p.title}: ${JSON.stringify(res)}`);
  }
  const after = await listProjects(c);
  const leftovers = after.filter((p) => p.title.startsWith("AUDIT-QA13-"));
  const afterNonQa13 = after.filter((p) => !p.title.startsWith("AUDIT-QA13-")).map((p) => `${p._id}:${p.title}`).sort();
  const untouched = JSON.stringify(beforeNonQa13) === JSON.stringify(afterNonQa13);
  record("CLEANUP-no-audit-qa13-left", mine.length > 0 && leftovers.length === 0, `deleted=${deletions.length}; leftovers=${leftovers.length}`);
  record("CLEANUP-other-projects-untouched", untouched, `before=${beforeNonQa13.length} after=${afterNonQa13.length}; untouched=${untouched}`);
  say(`final projects: ${JSON.stringify(after.map((p) => p.title))}`);

  writeEvidence("cleanup", { deletions, leftovers: leftovers.map((p) => p.title), beforeNonQa13, afterNonQa13, untouched, guardOk });
  writeLog("cleanup", log);
}

main().catch((e) => { console.error(e); process.exit(1); });