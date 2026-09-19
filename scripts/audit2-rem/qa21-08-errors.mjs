/**
 * QA21-08 A19-03/A20-04: direct backend error readability.
 *  - bids:awardContract with no agreement for that bid -> ConvexError, readable payload
 *  - bids:submitDirectBid on an executed-agreement awarded bid -> ConvexError, readable payload
 * Re-arms the LIFE agreement first (the A20-03 UI pass voided it).
 */
import { client, readEvidence, writeEvidence, writeLog, projectSnapshot } from "./qa21-lib.mjs";

const F = readEvidence("01-fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 900)}`);
};

function errShape(err) {
  const data = err && typeof err === "object" && "data" in err ? err.data : null;
  return {
    name: err?.name ?? null,
    message: err?.message ?? String(err),
    data: typeof data === "string" ? data : data == null ? null : JSON.stringify(data),
    dataType: typeof data,
  };
}

async function main() {
  const c = client();

  // Re-arm: generate (reactivates the superseded agreement) + execute.
  const reactivated = await c.mutation("agreements:generateAgreement", {
    bidId: F.life.bids.alpha,
    tradePackageId: F.life.packageId,
  });
  const agreementId = reactivated?._id ?? F.life.agreementId;
  await c.mutation("agreements:executeAgreement", { agreementId });
  say(`LIFE agreement re-armed + executed: ${agreementId}`);

  const before = await projectSnapshot(c, F.life.id);
  const betaBidBefore = before.bids.find((b) => b._id === F.life.bids.beta);
  const alphaBidBefore = before.bids.find((b) => b._id === F.life.bids.alpha);

  // ---------- A19-03: awardContract with no agreement ----------
  let awardErr = null;
  try {
    await c.mutation("bids:awardContract", {
      bidId: F.life.bids.beta,
      tradePackageId: F.life.packageId,
    });
  } catch (err) {
    awardErr = errShape(err);
  }
  const afterAward = await projectSnapshot(c, F.life.id);
  const betaBidAfter = afterAward.bids.find((b) => b._id === F.life.bids.beta);
  const alphaStillAwarded = afterAward.bids.find((b) => b._id === F.life.bids.alpha)?.isAwarded === true;
  say(`awardContract error: ${JSON.stringify(awardErr)}`);
  record(
    "A19-03.award-without-agreement-readable",
    "awardContract without agreement returns a readable ConvexError and mutates nothing",
    Boolean(awardErr) &&
      /Generate the agreement before changing an award/i.test(awardErr.data || "") &&
      !/\[Request ID\].*Server Error/i.test(awardErr.data || "") &&
      betaBidAfter?.isAwarded === betaBidBefore?.isAwarded &&
      alphaStillAwarded,
    {
      error: awardErr,
      betaAwardedBefore: betaBidBefore?.isAwarded,
      betaAwardedAfter: betaBidAfter?.isAwarded,
      alphaStillAwarded,
      rawMessageIsReadable: !/Server Error/i.test(awardErr?.message || ""),
    }
  );

  // ---------- A20-04: submitDirectBid on executed-agreement awarded bid ----------
  let submitErr = null;
  try {
    await c.mutation("bids:submitDirectBid", {
      tradePackageId: F.life.packageId,
      contractorId: F.life.contractors.alpha,
      subcontractorName: "AUDIT-QA21 LIFE Alpha Electric",
      baseBidAmount: 1_100_000,
      identifiedExclusions: [],
      valueEngineeringAlternates: [],
      longLeadEquipmentWeeks: 6,
      leadTimePenalty: 0,
      coiComplianceStatus: "compliant",
      coiPenalty: 0,
    });
  } catch (err) {
    submitErr = errShape(err);
  }
  const afterSubmit = await projectSnapshot(c, F.life.id);
  const alphaBidAfter = afterSubmit.bids.find((b) => b._id === F.life.bids.alpha);
  const agrAfter = afterSubmit.agreements.find((a) => a._id === agreementId);
  say(`submitDirectBid error: ${JSON.stringify(submitErr)}`);
  record(
    "A20-04.executed-bid-submit-readable",
    "submitDirectBid on an executed-agreement bid returns a readable ConvexError and mutates nothing",
    Boolean(submitErr) &&
      /Executed agreements are immutable\. Create an amendment before changing this bid\./i.test(submitErr.data || "") &&
      !/\[Request ID\].*Server Error/i.test(submitErr.data || "") &&
      alphaBidAfter?.leveledTotalCost === alphaBidBefore?.leveledTotalCost &&
      (alphaBidAfter?.revisionNumber ?? 1) === (alphaBidBefore?.revisionNumber ?? 1) &&
      agrAfter?.status === "executed",
    {
      error: submitErr,
      leveledBefore: alphaBidBefore?.leveledTotalCost,
      leveledAfter: alphaBidAfter?.leveledTotalCost,
      revisionBefore: alphaBidBefore?.revisionNumber ?? 1,
      revisionAfter: alphaBidAfter?.revisionNumber ?? 1,
      agreementStatus: agrAfter?.status,
      rawMessageIsReadable: !/Server Error/i.test(submitErr?.message || ""),
    }
  );

  // Control: a plain Error message should still be the old non-data shape (not part of the fix).
  const out = {
    results,
    errors: { awardContract: awardErr, submitDirectBid: submitErr },
    summary: { pass: results.filter((r) => r.pass).length, total: results.length },
  };
  writeEvidence("08-errors", out);
  writeLog("08-errors", log);
  console.log(`errors: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("08-errors-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});