/**
 * QA29-05 supplemental A28-01 phrase matrix (AUDIT-QA29-* only, deleted in-script):
 *  RECHECK-CTRL: inclusion "Low-voltage control wiring ..." (no BAS/building automation)
 *                -> BAS void must be ASSIGNED (isolated 'control wiring' branch)
 *  RECHECK-BASE: inclusion "QA29 baseline inclusion" (substring 'bas' inside 'baseline')
 *                -> BAS void must stay OPEN (word-boundary holds beyond 'Base building')
 */
import { client, fixtureTitle, writeEvidence, writeLog, plusDays, sleep } from "./qa29-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1200)}`);
};
const dl = plusDays(21);

async function hardDelete(title) {
  for (const p of ((await c.query("projects:listProjects", {})) || []).filter((x) => x.title === title)) {
    const agrs = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      try { await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA29 phrase-matrix teardown." }); } catch {}
    }
    try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch (err) { say(`delete failed: ${err?.data ?? err?.message}`); }
  }
}

async function build(title, inclusion) {
  const id = await c.mutation("projects:createProject", {
    title, location: "Austin, TX", projectType: "Class-A Commercial Mixed-Use",
    estBudget: 1500000, targetCompletionWeeks: 52, specDocumentText: `${title} phrase matrix.`,
    isDemoProject: false, generalContractorName: "QA29 Phrase GC",
  });
  const mkPkg = (csi, name, budget) =>
    c.mutation("tradePackages:createTradePackage", {
      projectId: id, csiDivision: csi, tradeName: name, budgetEstimate: budget,
      scopeSummary: `${name} scope.`, mandatoryInclusions: [inclusion], bidDeadline: dl,
    });
  const p26 = await mkPkg("26 00 00", "QA29 Phrase Electrical", 900000);
  const p23 = await mkPkg("23 00 00", "QA29 Phrase HVAC", 600000);
  const mkCtr = (pkgId, name, email, lic) =>
    c.mutation("contractors:createContractor", {
      tradePackageId: pkgId, companyName: name, contactEmail: email, phone: "+1 (206) 555-0199",
      licenseNumber: lic, licenseStatus: "Active / Verified (QA29)", sourceUrl: "https://qa29.example.invalid/license", rfqStatus: "invited",
    });
  const c26 = await mkCtr(p26, "AUDIT-QA29 Phrase Electric", "qa29.phrase.e@qa29.invalid", "TX-QA29-PE");
  const c23 = await mkCtr(p23, "AUDIT-QA29 Phrase Mechanical", "qa29.phrase.m@qa29.invalid", "TX-QA29-PM");
  await c.mutation("bids:submitDirectBid", {
    tradePackageId: p26, contractorId: c26, subcontractorName: "AUDIT-QA29 Phrase Electric",
    baseBidAmount: 800000, coiComplianceStatus: "compliant", coiPenalty: 0,
  });
  await c.mutation("bids:submitDirectBid", {
    tradePackageId: p23, contractorId: c23, subcontractorName: "AUDIT-QA29 Phrase Mechanical",
    baseBidAmount: 470000, coiComplianceStatus: "compliant", coiPenalty: 0,
  });
  return id;
}

async function main() {
  const T_CTRL = fixtureTitle("RECHECK-CTRL");
  const T_BASE = fixtureTitle("RECHECK-BASE");
  await hardDelete(T_CTRL);
  await hardDelete(T_BASE);
  await sleep(300);

  const idCtrl = await build(T_CTRL, "Low-voltage control wiring and interlock runs by Electrical");
  const idBase = await build(T_BASE, "QA29 baseline inclusion");
  await sleep(500);

  const dCtrl = await c.query("coordination:detectCrossTradeClashes", { projectId: idCtrl });
  const vCtrl = dCtrl.scopeVoids.find((x) => x.id === "void-bas-wiring-01");
  record(
    "A29-A28-01d",
    "A28-01: isolated 'control wiring' phrase (no BAS/building automation) still marks the BAS void assigned",
    vCtrl?.status === "assigned" && vCtrl?.assignedToTradeName === "Division 26 Electrical",
    { inclusion: "Low-voltage control wiring and interlock runs by Electrical", card: vCtrl ? { status: vCtrl.status, assignedToTradeName: vCtrl.assignedToTradeName } : null }
  );

  const dBase = await c.query("coordination:detectCrossTradeClashes", { projectId: idBase });
  const vBase = dBase.scopeVoids.find((x) => x.id === "void-bas-wiring-01");
  record(
    "A29-A28-01e",
    "A28-01: substring 'bas' inside 'baseline' does NOT mark the BAS void assigned (word boundary holds)",
    vBase?.status === "open" && vBase?.assignedToTradeName === undefined,
    { inclusion: "QA29 baseline inclusion", card: vBase ? { status: vBase.status, assignedToTradeName: vBase.assignedToTradeName ?? null } : null }
  );

  await hardDelete(T_CTRL);
  await hardDelete(T_BASE);
  await sleep(500);
  const remaining = ((await c.query("projects:listProjects", {})) || []).filter((x) => (x.title || "").startsWith("AUDIT-QA29-")).map((x) => x.title);
  record("A29-A28-01f", "supplemental fixtures deleted (no AUDIT-QA29-* projects remain)", remaining.length === 0, { remaining });

  writeEvidence("bascontrol", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("bascontrol", log);
  console.log(`bascontrol: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("bascontrol-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});