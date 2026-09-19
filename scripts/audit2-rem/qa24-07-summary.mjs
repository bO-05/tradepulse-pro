/**
 * QA24-07 summary: aggregate every QA24 evidence file into one verdict.
 */
import { readEvidence, writeEvidence, writeLog } from "./qa24-lib.mjs";

const names = ["recon", "fixtures", "backend", "ui-register", "ui-modals", "ui-overflow", "ui-intent", "cleanup"];
const files = {};
for (const n of names) {
  try {
    files[n] = readEvidence(n);
  } catch {
    files[n] = null;
  }
}

const checks = Object.entries(files)
  .filter(([, v]) => v && Array.isArray(v.results))
  .flatMap(([file, v]) => v.results.map((r) => ({ file, id: r.id, name: r.name, pass: r.pass })));

const failed = checks.filter((c) => !c.pass);
const findings = [
  {
    id: "A24-01",
    severity: "Medium",
    title: "Cross-trade intent-logged credit becomes a phantom 'deducted' record and permanently blocks the real 1-click credit",
    evidence: [
      "evidence/fix4-qa24-backend.json A24-02.2/3/4/5/6",
      "evidence/fix4-qa24-ui-intent.json A24-06.1/2",
      "evidence/fix4-qa24-intent-coordination.png",
      "evidence/fix4-qa24-intent-leveling.png",
    ],
    reachability: "Direct API only: the UI hides clash cards while either trade is unpriced (detect returns empty), so the intent path cannot be started by a click; it is reachable through the public Convex mutation surface.",
  },
  {
    id: "A24-02",
    severity: "Medium",
    title: "Superseded register rows show 'Pending Execution' and offer a dead 'Record Execution Status' action",
    evidence: [
      "evidence/fix4-qa24-ui-register.json A24-03.2/3",
      "evidence/fix4-qa24-register-superseded-rows.png",
      "evidence/fix4-qa24-register-superseded-inline-error.png",
    ],
  },
  {
    id: "A24-03",
    severity: "Medium",
    title: "375px contracts-register page overflow once the 'Superseded (N)' filter chip exists (newest filter surface)",
    evidence: [
      "evidence/fix4-qa24-ui-overflow.json A24-05.1/2",
      "evidence/fix4-qa24-ui-register.json A24-03.6/9",
      "evidence/fix4-qa24-toolbar-375-register-superseded-chip.png",
      "evidence/fix4-qa24-toolbar-375-repeat-no-chip.png",
    ],
  },
];
const notes = [
  "L1 (decision): no reversal mutation exists for clashResolutions although the refusal message tells the operator to 'reverse the existing credit'; an alias clashId silently rewrites the applied amount (backend A24-02.9/.10).",
  "L2 (decision): assignScopeVoidToTrade has no duplicate-resolution guard; the same voidId with a new description stacks another line item (backend A24-02.6).",
  "L3 (low): superseded print/download emits the old contract text with no SUPERSEDED/VOID watermark (ui-register A24-03.5).",
  "L4 (low): executedAt survives on re-awarded (generated) and superseded agreement records; not rendered anywhere in the UI (backend A24-02.12/.13/.15).",
  "L5 (observation): the void-confirm UI always records one canned audit reason; the operator is never asked for one even though the backend requires an explicit reason.",
  "L6 (observation): the Contracts Register has no CSV export, and the leveling CSV carries no agreement status, so a superseded-draft CSV path does not exist; print/download was the tested export surface.",
];

writeEvidence("summary", {
  capturedAt: new Date().toISOString(),
  totals: { checks: checks.length, pass: checks.filter((c) => c.pass).length, fail: failed.length },
  failedChecks: failed,
  findings,
  notes,
  cleanup: files.cleanup ? { deleted: files.cleanup.deleted, leftovers: files.cleanup.leftovers, foreignUnchanged: files.cleanup.foreignUnchanged } : null,
});
writeLog("summary", findings.map((f) => `${f.severity} ${f.id} ${f.title}`).concat(notes));
console.log(JSON.stringify({ totals: { checks: checks.length, pass: checks.filter((c) => c.pass).length, fail: failed.length }, findings: findings.map((f) => f.id), failed: failed.map((f) => `${f.file}/${f.id}`) }, null, 2));