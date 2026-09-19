/**
 * QA35-99 cleanup: purge every AUDIT-QA35-* fixture (voiding executed agreements first),
 * then prove zero QA35 leftovers and that the pre-existing projects (demo / other QA
 * prefixes) were never touched or deleted.
 */
import { client, writeEvidence, writeLog } from "./qa35-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const before = (await c.query("projects:listProjects", {})) || [];
  const baseline = before.filter((p) => !p.title.startsWith("AUDIT-QA35-")).map((p) => ({ id: p._id, title: p.title }));
  const qa35Before = before.filter((p) => p.title.startsWith("AUDIT-QA35-"));
  say(`before: total=${before.length} qa35=${qa35Before.length} baseline=${baseline.length}`);

  for (const p of qa35Before) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try {
        await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA35 cleanup void of executed fixture record." });
        say(`voided ${a.agreementNumber}`);
      } catch (err) {
        say(`void ${a.agreementNumber} failed: ${err?.data ?? err?.message}`);
      }
    }
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      say(`deleted ${p.title}`);
    } catch (err) {
      say(`delete ${p.title} failed: ${err?.data ?? err?.message}`);
    }
  }

  const after = (await c.query("projects:listProjects", {})) || [];
  const leftovers = after.filter((p) => p.title.startsWith("AUDIT-QA35-"));
  const baselineAfter = after.filter((p) => !p.title.startsWith("AUDIT-QA35-")).map((p) => ({ id: p._id, title: p.title }));
  const baselineIntact =
    baselineAfter.length === baseline.length &&
    baseline.every((b) => baselineAfter.some((a) => a.id === b.id && a.title === b.title));
  const foreignCreditRows = [];
  for (const p of after) {
    const bids = (await c.query("bids:listAllProjectBids", { projectId: p._id })) || [];
    for (const b of bids) for (const v of b.valueEngineeringAlternates || []) if (/^Cross-Trade Clash Credit/.test(String(v.description || ""))) foreignCreditRows.push({ project: p.title, description: String(v.description).slice(0, 120) });
  }
  say(`after: total=${after.length} qa35Leftovers=${leftovers.length} baselineIntact=${baselineIntact} foreignCreditRows=${foreignCreditRows.length}`);

  writeEvidence("cleanup", {
    before: { total: before.length, qa35: qa35Before.map((p) => p.title), baseline },
    after: { total: after.length, qa35Leftovers: leftovers.map((p) => p.title), baselineAfter, baselineIntact, foreignCreditRows },
    pass: leftovers.length === 0 && baselineIntact && foreignCreditRows.length === 0,
  });
  writeLog("cleanup", log);
  console.log(`cleanup: leftovers=${leftovers.length} baselineIntact=${baselineIntact} foreignCredits=${foreignCreditRows.length}`);
  if (leftovers.length || !baselineIntact) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  writeLog("cleanup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});