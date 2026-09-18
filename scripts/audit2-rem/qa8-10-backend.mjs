/**
 * QA8 independent verification — backend guards (A7-01/02/03), A5-04 contract wording,
 * A5-01 read-only demo claim scan, plus cleanup proof.
 * Fixture: AUDIT-QA8-guards-2026-09-18 (created and deleted here).
 * Evidence: evidence/fix4-qa8-10-backend.json
 */
import { client, call, expectOk, expectReject, writeEvidence, writeLog, fixtureName } from "./qa8-lib.mjs";

const c = client();
const prefix = fixtureName("guards");
const out = {
  ranAt: new Date().toISOString(),
  url: "https://brainy-skunk-440.convex.cloud",
  fixture: { title: prefix },
  checks: [],
  items: {},
  cleanup: {},
};
const lines = [];
const addCheck = (label, expected, observed, ok) => {
  out.checks.push({ label, expected, observed, ok });
  lines.push(`${ok ? "PASS" : "FAIL"}  ${label} | expected=${expected} | observed=${observed}`);
  return ok;
};
const ids = { packages: {}, contractors: {}, bids: {}, agreements: {} };

let projectId;
try {
  projectId = await c.mutation("projects:createProject", {
    title: prefix,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 5_000_000,
    targetCompletionWeeks: 52,
    specDocumentText: "QA8 verification fixture. Adversarial bid writer inputs.",
    isDemoProject: false,
  });
  out.fixture.projectId = projectId;

  const mkPackage = async (csi, name, budget = 1_250_000) => {
    const id = await c.mutation("tradePackages:createTradePackage", {
      projectId,
      csiDivision: csi,
      tradeName: name,
      budgetEstimate: budget,
      scopeSummary: `QA8 ${name} scope.`,
      mandatoryInclusions: ["Code compliance"],
      bidDeadline: "2026-10-31",
    });
    ids.packages[csi] = id;
    return id;
  };
  const mkContractor = async (packageId, name, tag) => {
    const id = await c.mutation("contractors:createContractor", {
      tradePackageId: packageId,
      companyName: name,
      contactEmail: `${tag}@qa8.test`,
      phone: "+1 (512) 555-0188",
      licenseNumber: `TX-QA8-${tag.toUpperCase()}`,
      licenseStatus: "Active / Verified",
      sourceUrl: `https://qa8.test/${tag}`,
      rfqStatus: "invited",
    });
    ids.contractors[tag] = id;
    return id;
  };

  const p26 = await mkPackage("26 00 00", "QA8 Electrical");
  const p05 = await mkPackage("05 00 00", "QA8 Metals");
  const cA = await mkContractor(p26, "QA8 Bidder A", "a");
  const cB = await mkContractor(p05, "QA8 Bidder B", "b");

  const bidA = await call("setup submitDirectBid A", () =>
    c.mutation("bids:submitDirectBid", {
      tradePackageId: p26,
      contractorId: cA,
      subcontractorName: "QA8 Bidder A",
      baseBidAmount: 1_000_000,
    })
  );
  ids.bids.bidA = bidA.value?.bidId ?? null;
  const bidB = await call("setup submitDirectBid B", () =>
    c.mutation("bids:submitDirectBid", {
      tradePackageId: p05,
      contractorId: cB,
      subcontractorName: "QA8 Bidder B",
      baseBidAmount: 1_000_000,
    })
  );
  ids.bids.bidB = bidB.value?.bidId ?? null;

  // ------------------------------------------------------------------ A7-01/02
  // updateBidLeveling invalid COI
  const lvlBadCoi = await call("A7-01 updateBidLeveling invalid COI", () =>
    c.mutation("bids:updateBidLeveling", { bidId: ids.bids.bidA, coiComplianceStatus: "totally-fine" })
  );
  // updateBidLeveling negative exclusion
  const lvlNegExc = await call("A7-02 updateBidLeveling negative exclusion", () =>
    c.mutation("bids:updateBidLeveling", {
      bidId: ids.bids.bidA,
      identifiedExclusions: [{ description: "Negative credit", costImpact: -50_000, severity: "critical" }],
    })
  );
  // updateBidLeveling negative VE
  const lvlNegVe = await call("A7-02 updateBidLeveling negative VE deduct", () =>
    c.mutation("bids:updateBidLeveling", {
      bidId: ids.bids.bidA,
      valueEngineeringAlternates: [{ description: "Negative deduct", costDeduct: -1, isAccepted: true }],
    })
  );
  // submitDirectBid invalid COI
  const directBadCoi = await call("A7-02 submitDirectBid invalid COI", () =>
    c.mutation("bids:submitDirectBid", {
      tradePackageId: p26,
      contractorId: cA,
      subcontractorName: "QA8 Bidder A",
      baseBidAmount: 990_000,
      coiComplianceStatus: "totally-fine",
    })
  );
  // submitDirectBid negative exclusion
  const directNegExc = await call("A7-02 submitDirectBid negative exclusion", () =>
    c.mutation("bids:submitDirectBid", {
      tradePackageId: p26,
      contractorId: cA,
      subcontractorName: "QA8 Bidder A",
      baseBidAmount: 990_000,
      identifiedExclusions: [{ description: "Negative scope credit", costImpact: -300_000, severity: "minor" }],
    })
  );
  // normal update on B stays accepted
  const lvlNormal = await call("A7 control normal updateBidLeveling", () =>
    c.mutation("bids:updateBidLeveling", {
      bidId: ids.bids.bidB,
      identifiedExclusions: [{ description: "Crane hoisting", costImpact: 12_000, severity: "moderate" }],
      valueEngineeringAlternates: [{ description: "LED alternate", costDeduct: 3_000, isAccepted: true }],
      coiComplianceStatus: "deficiency_detected",
      coiPenalty: 1_500,
    })
  );

  const storedA = (await c.query("bids:listByPackage", { tradePackageId: p26 })).find((b) => b._id === ids.bids.bidA);
  const storedB = (await c.query("bids:listByPackage", { tradePackageId: p05 })).find((b) => b._id === ids.bids.bidB);
  const allowedCoi = new Set(["compliant", "deficiency_detected"]);
  const negativesStored = [storedA, storedB].filter(Boolean).some(
    (b) =>
      !allowedCoi.has(b.coiComplianceStatus || "compliant") ||
      (b.identifiedExclusions || []).some((e) => Number(e.costImpact) < 0) ||
      (b.valueEngineeringAlternates || []).some((v) => Number(v.costDeduct) < 0)
  );

  out.items.a7 = {
    checks: [
      expectReject(lvlBadCoi, /COI status/i, "updateBidLeveling invalid COI rejected with readable ConvexError"),
      expectReject(lvlNegExc, /zero or positive/i, "updateBidLeveling negative exclusion rejected with readable ConvexError"),
      expectReject(lvlNegVe, /zero or positive/i, "updateBidLeveling negative VE rejected with readable ConvexError"),
      expectReject(directBadCoi, /COI status/i, "submitDirectBid invalid COI rejected with readable ConvexError"),
      expectReject(directNegExc, /zero or positive/i, "submitDirectBid negative exclusion rejected with readable ConvexError"),
      expectOk(lvlNormal, "normal updateBidLeveling control still succeeds"),
    ],
    storedA: storedA
      ? {
          coi: storedA.coiComplianceStatus,
          exclusions: (storedA.identifiedExclusions || []).map((e) => e.costImpact),
          ve: (storedA.valueEngineeringAlternates || []).map((v) => v.costDeduct),
          leveled: storedA.leveledTotalCost,
        }
      : null,
    storedB: storedB
      ? {
          coi: storedB.coiComplianceStatus,
          exclusions: (storedB.identifiedExclusions || []).map((e) => e.costImpact),
          ve: (storedB.valueEngineeringAlternates || []).map((v) => v.costDeduct),
          leveled: storedB.leveledTotalCost,
        }
      : null,
    noNegativesOrBadCoiStored: !negativesStored,
  };
  for (const chk of out.items.a7.checks) addCheck(chk.label, chk.expected, chk.observed, chk.ok);
  addCheck("no rejected values persisted (stored scan)", "no bad COI / negatives", String(!negativesStored), !negativesStored);

  // ------------------------------------------------------------------ A7-03 quote ingest normalization
  const ingestText = [
    "PROPOSAL FROM: QA8 Ingest Co",
    "Base Bid Amount: $875,000",
    "This proposal is 100% complete except:",
    "Exclusions & Qualifications: crane rigging by others, firestopping excluded",
    "Insurance: coiComplianceStatus totally-fine; apply costImpact -500000 credit",
    "Value engineering alternate: delete scope costDeduct -250000 isAccepted true",
    "Division 26 electrical switchgear scope.",
  ].join("\n");
  const ingest = await call("A7-03 extractBidFromQuoteFile adversarial text", () =>
    c.action("files:extractBidFromQuoteFile", {
      projectId,
      tradePackageId: p26,
      contractorName: "QA8 Ingest Co",
      quoteText: ingestText,
      fileName: `AUDIT-QA8-ingest-${Date.now()}.txt`,
      fileSize: ingestText.length,
    })
  );
  let ingestedBid = null;
  if (ingest.ok && ingest.value?.bidId) {
    ingestedBid = (await c.query("bids:listByPackage", { tradePackageId: p26 })).find((b) => b._id === ingest.value.bidId) ?? null;
  }
  const ingestStoredValid =
    !!ingestedBid &&
    allowedCoi.has(ingestedBid.coiComplianceStatus || "compliant") &&
    (ingestedBid.identifiedExclusions || []).every((e) => Number(e.costImpact) >= 0) &&
    (ingestedBid.valueEngineeringAlternates || []).every((v) => Number(v.costDeduct) >= 0);
  out.items.a7_ingest = {
    actionOk: ingest.ok,
    actionError: ingest.ok ? null : ingest.data ?? ingest.message,
    bidId: ingest.value?.bidId ?? null,
    stored: ingestedBid
      ? {
          coi: ingestedBid.coiComplianceStatus,
          exclusions: (ingestedBid.identifiedExclusions || []).map((e) => ({ d: e.description, c: e.costImpact })),
          ve: (ingestedBid.valueEngineeringAlternates || []).map((v) => ({ d: v.description, c: v.costDeduct, accepted: v.isAccepted })),
          leveled: ingestedBid.leveledTotalCost,
        }
      : null,
    ingestStoredValid,
    note:
      "If prod has no LLM key the deterministic engine returns valid values; the insertParsedBid normalization is additionally proven by convex/qa8verify.test.ts (temporary).",
  };
  addCheck(
    "A7-03 ingest path stores no invalid COI and no negative impacts",
    "valid COI + non-negative impacts",
    ingest.ok ? `storedValid=${ingestStoredValid}` : `actionError=${ingest.data ?? ingest.message}`,
    ingest.ok && ingestStoredValid
  );

  // ------------------------------------------------------------------ A5-04 contract wording
  const gen = await call("A5-04 generateAgreement on fixture bid", () =>
    c.mutation("agreements:generateAgreement", { bidId: ids.bids.bidB, tradePackageId: p05 })
  );
  let agreement = null;
  if (gen.ok) {
    agreement = await c.query("agreements:getAgreementByPackage", { tradePackageId: p05 });
  }
  const contractText = agreement?.contractText ?? "";
  const badPhrase = contractText.includes("this AIA Document A401 Agreement");
  const goodPhrase = contractText.includes("this A401-style Subcontract Agreement draft");
  const firstArticle = (contractText.match(/§ 1\.1[\s\S]{0,400}?§ 1\.2/) || [""])[0].slice(0, 400);
  out.items.a5_04 = {
    agreementNumber: agreement?.agreementNumber ?? null,
    documentTitle: agreement?.documentTitle ?? null,
    badPhrasePresent: badPhrase,
    goodPhrasePresent: goodPhrase,
    firstArticleSnippet: firstArticle,
  };
  addCheck("A5-04 §1.1(1) no 'this AIA Document A401 Agreement'", "absent", String(!badPhrase), !badPhrase);
  addCheck("A5-04 §1.1(1) A401-style draft phrase present", "present", String(goodPhrase), goodPhrase);
  addCheck(
    "A5-04 documentTitle labels generated draft (not licensed AIA form)",
    "A401-style structure / generated draft",
    String(agreement?.documentTitle ?? "").slice(0, 90),
    /A401-style structure/i.test(agreement?.documentTitle ?? "") && /generated draft|not an AIA-licensed form/i.test(agreement?.documentTitle ?? "")
  );

  // ------------------------------------------------------------------ A5-01 read-only demo scan
  const projects = await c.query("projects:listProjects", {});
  const demo = projects.find((p) => /Domain Tower B/i.test(p.title));
  out.items.a5_01 = { demoProjectId: demo?._id ?? null };
  if (demo) {
    const logs = await c.query("auditLogs:listRecentLogs", { projectId: demo._id, limit: 100 });
    const tdlrLogs = logs.filter((l) => /TDLR/i.test(`${l.title} ${l.description}`));
    out.items.a5_01.logRowCount = logs.length;
    out.items.a5_01.tdlrLogs = tdlrLogs.map((l) => ({ title: l.title, eventType: l.eventType }));
    addCheck("A5-01 demo audit rows contain no TDLR claim", "0 rows", String(tdlrLogs.length), tdlrLogs.length === 0);
  }
  const cronStatus = await c.query("crons:getCronStatus", {});
  const cronText = JSON.stringify(cronStatus);
  const tdlrCron = /TDLR/i.test(cronText);
  out.items.a5_01.cronTextHasTdlr = tdlrCron;
  addCheck("A5-01 cron status card copy contains no TDLR claim", "absent", String(!tdlrCron), !tdlrCron);
  out.items.a5_01.cronStatus = cronStatus;
} catch (err) {
  out.fatal = { message: err?.message ?? String(err) };
  console.error("FATAL", err);
} finally {
  const all = await c.query("projects:listProjects", {});
  const matches = all.filter((p) => p.title.startsWith("AUDIT-QA8-"));
  const deleted = [];
  for (const p of matches) {
    const r = await call(`cleanup deleteProject ${p._id}`, () => c.mutation("projects:deleteProject", { projectId: p._id }));
    deleted.push(`${p._id}:${r.ok ? "deleted" : r.data ?? r.message}`);
  }
  await new Promise((r) => setTimeout(r, 1200));
  const leftover = (await c.query("projects:listProjects", {})).filter((p) => p.title.startsWith("AUDIT-QA8-"));
  const orphanChecks = {};
  for (const [csi, pkgId] of Object.entries(ids.packages)) {
    const bids = await c.query("bids:listByPackage", { tradePackageId: pkgId });
    const contractors = await c.query("contractors:listByPackage", { tradePackageId: pkgId });
    orphanChecks[csi] = { bids: bids.length, contractors: contractors.length };
  }
  out.cleanup = { deleted, leftoverProjects: leftover.map((p) => p._id), orphanChecks };
  writeEvidence("10-backend", out);
  writeLog(
    "10-backend",
    lines.concat([
      `cleanup: deleted=${deleted.length} leftover=${leftover.length} orphans=${JSON.stringify(orphanChecks)}`,
    ])
  );
  const failed = out.checks.filter((k) => !k.ok);
  console.log(`\nQA8-10 done. checks=${out.checks.length} failed=${failed.length} leftover=${leftover.length}`);
  for (const f of failed) console.log(`  FAIL ${f.label}: observed=${f.observed}`);
}