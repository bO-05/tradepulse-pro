/**
 * QA21-05 HUNT A21-01b: can the fabricated benchmark double-buy be applied as a
 * real credit on a one-sided project? STAGED has 1 Div 26 bid and ZERO Div 23 bids.
 * Fixture-only probe; the project is deleted during QA21 cleanup.
 */
import { client, readEvidence, writeEvidence, writeLog } from "./qa21-lib.mjs";

const S = readEvidence("02-scan-backend");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 900)}`);
};

async function main() {
  const c = client();
  const projectId = S.staged.id;
  const elecPkg = (await c.query("tradePackages:listByProject", { projectId })).find((p) => p.csiDivision.startsWith("26"));
  const hvacPkg = (await c.query("tradePackages:listByProject", { projectId })).find((p) => p.csiDivision.startsWith("23"));
  const elecBidsBefore = await c.query("bids:listByPackage", { tradePackageId: elecPkg._id });
  const hvacBidsBefore = await c.query("bids:listByPackage", { tradePackageId: hvacPkg._id });
  const target = elecBidsBefore[0];

  const applied = await c.mutation("coordination:deductDoubleBuyCredit", {
    projectId,
    clashId: "clash-vfd-01",
    tradePackageId: elecPkg._id,
    deductAmount: 38500,
    description: "Variable Frequency Drives (VFDs) for AHUs & Pumps",
    bidId: target._id,
  });
  const bidsAfter = await c.query("bids:listByPackage", { tradePackageId: elecPkg._id });
  const detectAfter = await c.query("coordination:detectCrossTradeClashes", { projectId });
  const after = bidsAfter.find((b) => b._id === target._id);

  record(
    "A21-01b.fabricated-credit-writes",
    "HUNT: benchmark double-buy credit can be written to a real bid with zero HVAC proposals",
    hvacBidsBefore.length === 0 &&
      after.leveledTotalCost === target.leveledTotalCost - 38500 &&
      (detectAfter?.doubleBuys || []).some((d) => d.id === "clash-vfd-01" && d.status === "deducted"),
    {
      hvacBidsBefore: hvacBidsBefore.length,
      elecBidsBefore: elecBidsBefore.map((b) => ({ id: b._id, leveledTotalCost: b.leveledTotalCost })),
      applied,
      elecBidsAfter: bidsAfter.map((b) => ({ id: b._id, leveledTotalCost: b.leveledTotalCost, revisionNumber: b.revisionNumber })),
      detectAfterVfd: (detectAfter?.doubleBuys || []).find((d) => d.id === "clash-vfd-01") || null,
      note: "The $38,500 credit is derived from the static benchmark clash set; the project has no Division 23 proposal evidencing any double-buy.",
    }
  );

  writeEvidence("05-deduct-probe", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("05-deduct-probe", log);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("05-deduct-probe-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});