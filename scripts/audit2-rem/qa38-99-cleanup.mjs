/**
 * QA38-99 cleanup: delete ONLY AUDIT-QA38-* projects (voiding executed agreements first).
 * Never touches demo / GC-AUDIT / AUDIT-5-* / other AUDIT-QA*.
 * Cross-checks the remaining project list against the QA37 cleanup baseline (the pre-existing set).
 */
import { client, writeEvidence, writeLog, sleep, EVIDENCE_DIR } from "./qa38-lib.mjs";
import fs from "node:fs";
import path from "node:path";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

function baselineTitles() {
  try {
    const prev = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "fix4-qa37-cleanup.json"), "utf8"));
    return (prev.othersUntouched || []).filter((x) => x.stillPresent).map((x) => x.title);
  } catch {
    return null;
  }
}

async function main() {
  const baseline = baselineTitles();
  const before = (await c.query("projects:listProjects", {})) || [];
  const mine = before.filter((p) => p.title.startsWith("AUDIT-QA38-"));
  const deleted = [];
  const failed = [];
  for (const p of mine) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA38 final teardown of executed record." });
        say(`voided ${a.agreementNumber} in ${p.title}`);
      } catch (err) {
        say(`void ${a.agreementNumber} failed: ${err?.data ?? err?.message}`);
      }
    }
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      deleted.push(p.title);
      say(`deleted ${p.title}`);
    } catch (err) {
      failed.push({ title: p.title, err: String(err?.data ?? err?.message) });
      say(`delete ${p.title} failed: ${err?.data ?? err?.message}`);
    }
    await sleep(300);
  }
  await sleep(1000);
  const after = (await c.query("projects:listProjects", {})) || [];
  const leftover = after.filter((p) => p.title.startsWith("AUDIT-QA38-"));
  const afterTitles = after.map((p) => p.title);
  const missingBaseline = baseline ? baseline.filter((t) => !afterTitles.includes(t)) : null;
  const newSinceBaseline = baseline ? afterTitles.filter((t) => !baseline.includes(t) && !t.startsWith("AUDIT-QA38-")) : null;
  const result = {
    deleted,
    failed,
    deletedCount: deleted.length,
    leftover: leftover.map((p) => ({ id: p._id, title: p.title })),
    remainingCount: after.length,
    remaining: after.map((p) => ({ title: p.title, isDemoProject: !!p.isDemoProject })),
    baselineCount: baseline ? baseline.length : null,
    missingBaseline,
    newSinceBaseline,
    clean: leftover.length === 0 && failed.length === 0 && (missingBaseline ? missingBaseline.length === 0 && newSinceBaseline.length === 0 : true),
  };
  say(`cleanup: deleted=${deleted.length} failed=${failed.length} leftover=${leftover.length} remaining=${after.length}`);
  if (baseline) say(`baseline=${baseline.length} missingBaseline=${missingBaseline.length} newNonQa38=${newSinceBaseline.length}`);
  writeEvidence("cleanup", result);
  writeLog("cleanup", log);
  if (!result.clean) process.exitCode = 2;
}
main().catch((e) => {
  console.error(e);
  writeLog("cleanup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});