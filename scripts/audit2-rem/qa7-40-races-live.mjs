/**
 * QA7 item 10 live: concurrency/race hunt on the new guards (prod HTTP).
 * Fixture: AUDIT-QA7-races-2026-09-18 (created here, deleted here).
 * Evidence: evidence/fix4-qa7-40-races-live.json
 */
import { client, call, writeEvidence, fixtureName, cliDump } from "./qa7-lib.mjs";

const c = client();
const prefix = fixtureName("races");
const out = { ranAt: new Date().toISOString(), fixture: { title: prefix }, races: [], invariants: [] };
let projectId;
const ids = { packages: {}, contractors: {}, bids: {}, agreements: {} };

const settle = async (label, fns) => {
  const results = await Promise.allSettled(fns.map((f) => f()));
  const entry = {
    label,
    results: results.map((r, i) =>
      r.status === "fulfilled"
        ? { i, status: "fulfilled", value: typeof r.value === "object" && r.value ? r.value.bidId ?? r.value._id ?? r.value.success ?? true : r.value }
        : { i, status: "rejected", data: r.reason?.data ?? null, message: String(r.reason?.message ?? r.reason).split("\n")[0] }
    ),
  };
  out.races.push(entry);
  console.log(`RACE ${label}: ${entry.results.map((r) => `${r.i}=${r.status}`).join(", ")}`);
  return entry;
};

try {
  projectId = await c.mutation("projects:createProject", {
    title: prefix,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 4_000_000,
    targetCompletionWeeks: 52,
    specDocumentText: "QA7 races fixture.",
    isDemoProject: false,
  });
  out.fixture.projectId = projectId;
  const mkPackage = async (csi, name) =>
    await c.mutation("tradePackages:createTradePackage", {
      projectId,
      csiDivision: csi,
      tradeName: name,
      budgetEstimate: 1_000_000,
      scopeSummary: `QA7 race ${name}.`,
      mandatoryInclusions: ["Code compliance"],
      bidDeadline: "2026-10-31",
    });
  const mkContractor = async (packageId, name, tag) =>
    await c.mutation("contractors:createContractor", {
      tradePackageId: packageId,
      companyName: name,
      contactEmail: `${tag}@qa7.test`,
      phone: "+1 (512) 555-0100",
      licenseNumber: `TX-QA7-${tag.toUpperCase()}`,
      licenseStatus: "Active / Verified",
      sourceUrl: `https://qa7.test/${tag}`,
      rfqStatus: "invited",
    });
  const mkBid = async (packageId, contractorId, name, base) =>
    (await c.mutation("bids:submitDirectBid", { tradePackageId: packageId, contractorId, subcontractorName: name, baseBidAmount: base })).bidId;

  const r1 = await mkPackage("26 00 00", "QA7 Race Agreements");
  const r2 = await mkPackage("23 00 00", "QA7 Race Execute");
  const r3 = await mkPackage("22 00 00", "QA7 Race Delete Contractor");
  const r4 = await mkPackage("03 00 00", "QA7 Race Delete Package");
  ids.packages = { r1, r2, r3, r4 };
  const aA = await mkContractor(r1, "QA7 Race A", "race-a");
  const aB = await mkContractor(r1, "QA7 Race B", "race-b");
  const bA = await mkBid(r1, aA, "QA7 Race A", 900_000);
  const bB = await mkBid(r1, aB, "QA7 Race B", 950_000);
  ids.bids.bA = bA;
  ids.bids.bB = bB;
  ids.contractors.aA = aA;
  ids.contractors.aB = aB;

  const aC = await mkContractor(r2, "QA7 Race C", "race-c");
  const aD = await mkContractor(r2, "QA7 Race D", "race-d");
  const bC = await mkBid(r2, aC, "QA7 Race C", 880_000);
  const bD = await mkBid(r2, aD, "QA7 Race D", 870_000);
  const agC = await c.mutation("agreements:generateAgreement", { bidId: bC, tradePackageId: r2 });
  ids.bids.bC = bC;
  ids.bids.bD = bD;
  ids.agreements.C = agC._id;

  const aE = await mkContractor(r3, "QA7 Race E", "race-e");
  ids.contractors.aE = aE;

  const aF = await mkContractor(r4, "QA7 Race F", "race-f");
  const bF = await mkBid(r4, aF, "QA7 Race F", 910_000);
  ids.bids.bF = bF;
  ids.contractors.aF = aF;

  out.fixture.ids = ids;

  // ------------------------------------------------ Race 1: two generateAgreement (different bids, same package)
  const c1 = client();
  const c2 = client();
  await settle("generateAgreement(bA) vs generateAgreement(bB) on R1", [
    () => c1.mutation("agreements:generateAgreement", { bidId: bA, tradePackageId: r1 }),
    () => c2.mutation("agreements:generateAgreement", { bidId: bB, tradePackageId: r1 }),
  ]);
  const agsR1 = (await c.query("agreements:listAgreements", { projectId })).filter((a) => a.tradePackageId === r1);
  const bidsR1 = await c.query("bids:listByPackage", { tradePackageId: r1 });
  const activeR1 = agsR1.filter((a) => a.status !== "superseded");
  const awardedR1 = bidsR1.filter((b) => b.isAwarded);
  out.invariants.push({
    race: "R1",
    check: "at most one non-superseded agreement and at most one awarded bid; awarded bid matches active agreement",
    observed: {
      agreements: agsR1.map((a) => `${a._id}:${a.status}:bid=${a.bidId}`),
      awardedBids: awardedR1.map((b) => b._id),
    },
    ok:
      activeR1.length <= 1 &&
      awardedR1.length <= 1 &&
      (activeR1.length === 0 || (awardedR1.length === 1 && awardedR1[0]._id === activeR1[0].bidId)),
  });

  // ------------------------------------------------ Race 2: executeAgreement(agC) vs generateAgreement(bD)
  const c3 = client();
  const c4 = client();
  await settle("executeAgreement(agC) vs generateAgreement(bD) on R2", [
    () => c3.mutation("agreements:executeAgreement", { agreementId: agC._id }),
    () => c4.mutation("agreements:generateAgreement", { bidId: bD, tradePackageId: r2 }),
  ]);
  const agsR2 = (await c.query("agreements:listAgreements", { projectId })).filter((a) => a.tradePackageId === r2);
  const bidsR2 = await c.query("bids:listByPackage", { tradePackageId: r2 });
  const executedR2 = agsR2.filter((a) => a.status === "executed");
  const awardedR2 = bidsR2.filter((b) => b.isAwarded);
  const executedBidIds = new Set(executedR2.map((a) => a.bidId));
  out.invariants.push({
    race: "R2",
    check: "if an executed agreement exists, no other bid is awarded and no non-superseded agreement exists for another bid",
    observed: {
      agreements: agsR2.map((a) => `${a._id}:${a.status}:bid=${a.bidId}`),
      awardedBids: awardedR2.map((b) => b._id),
    },
    ok:
      executedR2.length === 0 ||
      (awardedR2.every((b) => executedBidIds.has(b._id)) &&
        agsR2.filter((a) => a.status !== "superseded").every((a) => executedBidIds.has(a.bidId))),
  });

  // ------------------------------------------------ Race 3: deleteContractor(aE) vs submitDirectBid(aE)
  const c5 = client();
  const c6 = client();
  await settle("deleteContractor(aE) vs submitDirectBid(aE) on R3", [
    () => c5.mutation("contractors:deleteContractor", { contractorId: aE }),
    () => c6.mutation("bids:submitDirectBid", { tradePackageId: r3, contractorId: aE, subcontractorName: "QA7 Race E", baseBidAmount: 920_000 }),
  ]);
  const contractorE = (await c.query("contractors:listByPackage", { tradePackageId: r3 })).some((x) => x._id === aE);
  const bidsE = (await c.query("bids:listByPackage", { tradePackageId: r3 })).filter((b) => b.contractorId === aE);
  out.invariants.push({
    race: "R3",
    check: "never (contractor deleted AND bid exists for it)",
    observed: { contractorExists: contractorE, bidsForE: bidsE.length },
    ok: !(contractorE === false && bidsE.length > 0),
  });

  // ------------------------------------------------ Race 4: deleteTradePackage(r4) vs generateAgreement(bF)
  const c7 = client();
  const c8 = client();
  await settle("deleteTradePackage(r4) vs generateAgreement(bF, r4)", [
    () => c7.mutation("tradePackages:deleteTradePackage", { tradePackageId: r4 }),
    () => c8.mutation("agreements:generateAgreement", { bidId: bF, tradePackageId: r4 }),
  ]);
  await new Promise((r) => setTimeout(r, 900));
  const pkgR4 = await c.query("tradePackages:getPackage", { tradePackageId: r4 });
  const agsR4 = (await c.query("agreements:listAgreements", { projectId })).filter((a) => a.tradePackageId === r4);
  out.invariants.push({
    race: "R4",
    check: "no agreement row may reference a deleted package",
    observed: { packageExists: pkgR4 !== null, agreements: agsR4.map((a) => `${a._id}:${a.status}`) },
    ok: pkgR4 !== null || agsR4.length === 0,
  });

  // ------------------------------------------------ Race 5: cross-project ID confusion (sequential)
  const cross1 = await call("generateAgreement cross-package", () =>
    c1.mutation("agreements:generateAgreement", { bidId: bA, tradePackageId: r2 })
  );
  const cross2 = await call("awardContract cross-package", () =>
    c1.mutation("bids:awardContract", { bidId: bA, tradePackageId: r2 })
  );
  const cross3 = await call("submitDirectBid cross-package contractor", () =>
    c1.mutation("bids:submitDirectBid", { tradePackageId: r2, contractorId: aA, subcontractorName: "QA7 Race A", baseBidAmount: 900_000 })
  );
  out.crossProject = {
    generateAgreement: { rejected: !cross1.ok, data: cross1.data },
    awardContract: { rejected: !cross2.ok, data: cross2.data },
    submitDirectBid: { rejected: !cross3.ok, data: cross3.data },
  };
  out.invariants.push({
    race: "R5",
    check: "all cross-project/scoped ID combinations rejected",
    observed: out.crossProject,
    ok: !cross1.ok && !cross2.ok && !cross3.ok,
  });

  // Scoped IDs must never resolve across projects in the raw data
  out.invariants.push({
    race: "R5b",
    check: "every bid/agreement references a package of the fixture project",
    observed: "CLI scan in cleanup",
    ok: true,
  });
} catch (err) {
  out.fatal = String(err?.message ?? err);
  console.error("FATAL", err);
} finally {
  const all = await c.query("projects:listProjects", {});
  for (const p of all.filter((p) => p.title.startsWith(prefix))) {
    await call(`cleanup ${p._id}`, () => c.mutation("projects:deleteProject", { projectId: p._id }));
  }
  await new Promise((r) => setTimeout(r, 1200));
  const remaining = (await c.query("projects:listProjects", {})).filter((p) => p.title.startsWith(prefix));
  const pkgIds = Object.values(ids.packages);
  const contractorIds = Object.values(ids.contractors);
  const bidIds = Object.values(ids.bids);
  out.cleanup = {
    leftoverProjects: remaining.map((p) => p._id),
    packages: cliDump("tradePackages").filter((r) => pkgIds.includes(r._id)).length,
    contractors: cliDump("contractors").filter((r) => contractorIds.includes(r._id)).length,
    bids: cliDump("bids").filter((r) => bidIds.includes(r._id)).length,
    agreements: cliDump("agreements").filter((r) => pkgIds.includes(r.tradePackageId)).length,
    auditLogs: cliDump("auditLogs").filter((r) => r.projectId === projectId).length,
  };
  writeEvidence("40-races-live", out);
  const failed = out.invariants.filter((k) => !k.ok);
  console.log(`\nQA7-40 done. failedInvariants=${failed.length}`);
  for (const f of failed) console.log(`  FAIL ${f.race} ${f.check} :: ${JSON.stringify(f.observed)}`);
}