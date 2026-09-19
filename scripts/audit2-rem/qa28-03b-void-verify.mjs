/**
 * QA28-03b: corrected void-row verification for the S3 step (parent script had an
 * over-specific regex; this re-reads the persisted row and asserts the actual text).
 */
import { client, readEvidence, writeEvidence, writeLog } from "./qa28-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const logs = (await c.query("auditLogs:listRecentLogs", { projectId: F.award.id, limit: 400 })) || [];
  const voidRows = logs.filter((l) => /Executed Subcontract Voided/.test(l.title));
  const row = voidRows[0];
  const reason = "QA28 audit truth: void executed agreement for lifecycle verification.";
  const laterAward = logs.filter((l) => /Awarded/.test(l.title) && l.timestamp > (row?.timestamp ?? Infinity));
  const result = {
    id: "A28-03b.1",
    pass: Boolean(
      voidRows.length === 1 &&
      row.description ===
        `Executed subcontract ${"A401-2026-2600-6582"} (AUDIT-QA28 AWARD Electric A) was voided: ${reason} The package is reopened for leveling and external amendment.` &&
      row.actor === "GC Procurement / Legal" &&
      laterAward.every((l) => /Re-Awarded/.test(l.title))
    ),
    detail: {
      voidRows: voidRows.map((l) => ({ title: l.title, description: l.description, actor: l.actor })),
      laterAwardTitles: laterAward.map((l) => l.title),
    },
  };
  say(JSON.stringify(result));
  writeEvidence("void-verify", { results: [result] });
  writeLog("void-verify", log);
}

main().catch((e) => {
  console.error(e);
  writeLog("void-verify-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});