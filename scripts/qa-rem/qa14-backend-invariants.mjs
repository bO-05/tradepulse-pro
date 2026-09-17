// QA-14 backend invariants (independent round-6 probes).
// 1. createProject persists across a fresh client
// 2. CSI "99 99 99" rejected with readable ConvexError.data
// 3. $1 and $999,999,999 bids rejected (readable) + nothing persisted
// 4. guest RFI accepted + conversation persisted within ~120s
// 5. clash guard empty on a 0-package project
// 6. deduct-credit resolution persists across detect calls (fresh client) + bid leveling applied
// 7. re-ingested bid revisionNumber increments (true parse ingest path; fallback direct re-submit)
// 8. deleteProject cascade clean; demo baseline unchanged
// Usage: node scripts/qa-rem/qa14-backend-invariants.mjs
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const BASELINE_FILE = path.join(EVIDENCE_DIR, "remediation-qa14-baseline.json");
const TAG = `QA-REM-QA14-BE-${Date.now()}`;
const STARTED = new Date().toISOString();

const LOG = [];
const OUT = { tag: TAG, backend: BACKEND, startedAt: STARTED, steps: [], items: {} };
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const record = (name, obj) => {
  OUT.steps.push({ name, at: new Date().toISOString(), ...obj });
};

const freshClient = () => new ConvexHttpClient(BACKEND);
const client = freshClient();

function errShape(err) {
  return {
    name: err?.name,
    message: typeof err?.message === "string" ? err.message.slice(0, 400) : String(err?.message),
    data: typeof err?.data === "string" ? err.data.slice(0, 400) : err?.data ?? null,
    dataType: typeof err?.data,
  };
}
function readable(err, expectSubstring) {
  const text = (typeof err?.data === "string" && err.data) || err?.message || "";
  const masked = text.includes("[CONVEX] Server Error") || text.trim().length === 0;
  const like = expectSubstring ? text.toLowerCase().includes(expectSubstring.toLowerCase()) : true;
  return { readable: !masked, matchesExpected: like, text };
}
async function attempt(fn) {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ok: true, value, ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, err: errShape(err), ms: Date.now() - t0 };
  }
}

async function snapshotProject(projectId) {
  const project = await client.query("projects:getProject", { projectId });
  const packages = await client.query("tradePackages:listByProject", { projectId });
  const bids = await client.query("bids:listAllProjectBids", { projectId });
  const agreements = await client.query("agreements:listAgreements", { projectId });
  const logs = await client.query("auditLogs:listRecentLogs", { projectId, limit: 1000 });
  const contractors = await client.query("contractors:listByProject", { projectId });
  const files = await client.query("files:listFilesByProject", { projectId });
  return {
    id: projectId,
    title: project?.title,
    location: project?.location,
    estBudget: project?.estBudget,
    targetCompletionWeeks: project?.targetCompletionWeeks,
    isDemoProject: project?.isDemoProject,
    packageCount: packages.length,
    packages: packages
      .map((p) => ({ id: p._id, csiDivision: p.csiDivision, tradeName: p.tradeName, budgetEstimate: p.budgetEstimate, status: p.status }))
      .sort((a, b) => String(a.csiDivision).localeCompare(String(b.csiDivision))),
    bidCount: bids.length,
    bidIds: bids.map((b) => b._id).sort(),
    bidRevs: bids.map((b) => `${b._id}:rev${b.revisionNumber ?? 1}`).sort(),
    agreementCount: agreements.length,
    agreementIds: agreements.map((a) => a._id).sort(),
    auditLogCount: logs.length,
    auditLogIds: logs.map((l) => l._id).sort(),
    contractorCount: contractors.length,
    contractorIds: contractors.map((c) => c._id).sort(),
    fileCount: files.length,
    fileSizes: files.map((f) => `${f.fileName}:${f.fileSize}`).sort(),
  };
}
function demoEquivalent(a, b) {
  if (!a || !b) return { mismatch: "missing" };
  const keys = [
    "title", "location", "estBudget", "targetCompletionWeeks", "isDemoProject",
    "packageCount", "bidCount", "agreementCount", "auditLogCount", "contractorCount", "fileCount",
  ];
  for (const k of keys) if (a[k] !== b[k]) return { mismatch: k, a: a[k], b: b[k] };
  return true;
}

async function main() {
  ev("=== QA-14 BACKEND INVARIANTS ===");
  ev(`Backend : ${BACKEND}`);
  ev(`Started : ${STARTED}`);
  ev(`Tag     : ${TAG}`);
  ev("");

  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
  const demoId = baseline.demoSnapshot.id;
  const demoBefore = await snapshotProject(demoId);
  const demoMatchBefore = demoEquivalent(demoBefore, baseline.demoSnapshot);
  ev(`[0] demo baseline match (pre-test): ${JSON.stringify(demoMatchBefore)}`);
  record("demo_before", { ok: demoMatchBefore === true, snapshot: demoBefore });
  OUT.items.demo_baseline_before = demoMatchBefore === true;
  ev("");

  // ---- 1. createProject + fresh client ----
  const created = await attempt(() =>
    client.mutation("projects:createProject", {
      title: TAG,
      location: "QA-14 Adversarial Loop, Austin TX",
      projectType: "commercial",
      estBudget: 3100000,
      targetCompletionWeeks: 46,
      specDocumentText: "QA-14 backend invariant fixture. Division 26 + 23 cross-trade scope.",
      isDemoProject: false,
    })
  );
  if (!created.ok) {
    ev(`[1] FAIL createProject: ${JSON.stringify(created.err)}`);
    throw new Error("fixture creation failed");
  }
  const projectId = created.value;
  const listedImmediate = (await client.query("projects:listProjects", {})).some((p) => p._id === projectId);
  const fresh = freshClient();
  const listedFresh = (await fresh.query("projects:listProjects", {})).some((p) => p._id === projectId);
  const getFresh = await fresh.query("projects:getProject", { projectId });
  ev(`[1] createProject -> ${projectId}; listedImmediate=${listedImmediate}; freshClient=${listedFresh}; getFresh.title="${getFresh?.title}"`);
  record("create_project", { ok: listedImmediate && listedFresh, projectId, listedImmediate, listedFresh });
  OUT.items.create_persists_fresh_client = listedImmediate && listedFresh;
  ev("");

  // ---- 2. CSI 99 99 99 rejected ----
  const badCsi = await attempt(() =>
    client.mutation("tradePackages:createTradePackage", {
      projectId,
      csiDivision: "99 99 99",
      tradeName: "QA-14 Impossible Division",
      budgetEstimate: 500000,
      scopeSummary: "must never persist",
      mandatoryInclusions: [],
      bidDeadline: "2026-12-31",
    })
  );
  const badCsiRead = badCsi.ok ? null : readable(badCsi.err, "00");
  const pkgsAfterBadCsi = await client.query("tradePackages:listByProject", { projectId });
  ev(`[2] CSI 99 99 99 rejected=${!badCsi.ok} readable=${badCsiRead?.readable} guidance=${badCsiRead?.matchesExpected} text="${badCsiRead?.text}"`);
  ev(`[2] packages after bad CSI: ${pkgsAfterBadCsi.length} (expect 0)`);
  record("csi_rejection", { rejected: !badCsi.ok, err: badCsi.err ?? null, read: badCsiRead, packageCountAfter: pkgsAfterBadCsi.length });
  OUT.items.csi_reject = !badCsi.ok && Boolean(badCsiRead?.readable) && pkgsAfterBadCsi.length === 0;
  ev("");

  // ---- 3. clash guard empty on 0-package project ----
  const clashEmpty = await attempt(() => client.query("coordination:detectCrossTradeClashes", { projectId }));
  const ce = clashEmpty.ok ? clashEmpty.value : null;
  const ceShapeKeys = ce ? Object.keys(ce.summary || {}).sort().join(",") : null;
  const ceCount = ce ? (ce.doubleBuys?.length ?? 0) + (ce.scopeVoids?.length ?? 0) : null;
  ev(`[3] clash guard (0 packages): ok=${clashEmpty.ok} count=${ceCount} active=${ce?.summary?.activeClashesCount} summaryKeys=[${ceShapeKeys}]`);
  record("clash_guard_empty", { ok: clashEmpty.ok, count: ceCount, summary: ce?.summary ?? null, summaryKeys: ceShapeKeys });
  OUT.items.clash_guard_empty = clashEmpty.ok && ceCount === 0 && ce?.summary?.activeClashesCount === 0;
  ev("");

  // ---- 4. legit packages (26 + 23) ----
  const elecPkg = await attempt(() =>
    client.mutation("tradePackages:createTradePackage", {
      projectId, csiDivision: "26 00 00", tradeName: "QA-14 Electrical Systems", budgetEstimate: 1200000,
      scopeSummary: "QA-14 Div 26 scope", mandatoryInclusions: ["Switchgear", "Grounding"], bidDeadline: "2026-12-31",
    })
  );
  const hvacPkg = await attempt(() =>
    client.mutation("tradePackages:createTradePackage", {
      projectId, csiDivision: "23 00 00", tradeName: "QA-14 HVAC Systems", budgetEstimate: 800000,
      scopeSummary: "QA-14 Div 23 scope", mandatoryInclusions: ["RTUs"], bidDeadline: "2026-12-31",
    })
  );
  if (!elecPkg.ok || !hvacPkg.ok) throw new Error(`package creation failed: ${JSON.stringify({ elecPkg, hvacPkg })}`);
  const elecPkgId = elecPkg.value;
  const hvacPkgId = hvacPkg.value;
  const clashPopulated = await client.query("coordination:detectCrossTradeClashes", { projectId });
  ev(`[4] packages created (26=${elecPkgId}, 23=${hvacPkgId}); clashes: doubleBuys=${clashPopulated.doubleBuys.length} voids=${clashPopulated.scopeVoids.length} active=${clashPopulated.summary.activeClashesCount}`);
  record("clash_populated", { doubleBuys: clashPopulated.doubleBuys.length, scopeVoids: clashPopulated.scopeVoids.length, summary: clashPopulated.summary });
  OUT.items.clash_populated = clashPopulated.doubleBuys.length === 2 && clashPopulated.scopeVoids.length === 2;
  ev("");

  // ---- 5. contractors ----
  const c1 = await client.mutation("contractors:createContractor", {
    tradePackageId: elecPkgId, companyName: "QA-14 Verifier Electric LLC", contactEmail: "qa14.electric@tradepulse-pro.test",
    phone: "+1 (512) 555-0141", licenseNumber: "TX-TECL-QA14", licenseStatus: "Active / Verified", sourceUrl: "https://tradepulse-pro.test/qa14", rfqStatus: "invited",
  });
  const c2 = await client.mutation("contractors:createContractor", {
    tradePackageId: elecPkgId, companyName: "QA-14 Absurd Bid Co", contactEmail: "qa14.absurd@tradepulse-pro.test",
    phone: "+1 (512) 555-0142", licenseNumber: "TX-TECL-QA14B", licenseStatus: "Active / Verified", sourceUrl: "https://tradepulse-pro.test/qa14b", rfqStatus: "invited",
  });
  ev(`[5] contractors: c1=${c1} c2=${c2}`);
  ev("");

  // ---- 6. direct bid rev1 + guest RFI dispatch (start async work) ----
  const direct1 = await attempt(() =>
    client.mutation("bids:submitDirectBid", {
      tradePackageId: elecPkgId, contractorId: c1, subcontractorName: "QA-14 Verifier Electric LLC", baseBidAmount: 1150000,
    })
  );
  ev(`[6] submitDirectBid rev1: ok=${direct1.ok} bidId=${direct1.value?.bidId ?? JSON.stringify(direct1.err)} rev=${direct1.value?.revisionNumber ?? "n/a"}`);
  record("direct_bid_1", direct1.ok ? { ok: true, ...direct1.value } : direct1);

  const rfiSubmittedAt = Date.now();
  const rfi = await attempt(() =>
    client.mutation("simulation:submitCustomRfi", {
      tradePackageId: hvacPkgId,
      subject: "QA-14 guest inquiry: 24V BAS interlock wiring responsibility",
      question:
        "For the QA-14 fixture HVAC package, does Division 26 Electrical furnish and install the 24V BAS control and interlock wiring between VAV terminal boxes and DDC panels, or is that inside the Mechanical scope?",
    })
  );
  ev(`[6] guest RFI accepted=${rfi.ok} msg="${rfi.ok ? rfi.value?.message : JSON.stringify(rfi.err)}"`);
  record("guest_rfi_submit", rfi.ok ? { ok: true, ...rfi.value } : rfi);
  ev("");

  // ---- 7. TRUE re-ingest via parse path (LLM) ----
  const parseT0 = Date.now();
  const parsed = await attempt(() =>
    client.action("files:extractBidFromQuoteFile", {
      projectId,
      tradePackageId: elecPkgId,
      contractorId: c1,
      contractorName: "QA-14 Verifier Electric LLC",
      quoteText: [
        "QA-14 VERIFIER ELECTRIC LLC",
        "Commercial Electrical Proposal - Division 26 (AIA A401 basis)",
        "Project: QA-14 Adversarial Loop, Austin TX",
        "Base Bid: $1,150,000.00",
        "Includes: switchgear, feeders, branch power, lighting controls, seismic bracing.",
        "Exclusions: temporary power, low-voltage BAS wiring.",
        "Long lead equipment: 14 weeks for switchgear.",
      ].join("\n"),
    })
  );
  const parseMs = Date.now() - parseT0;
  ev(`[7] parse-ingest action ok=${parsed.ok} in ${parseMs}ms -> ${parsed.ok ? JSON.stringify(parsed.value) : JSON.stringify(parsed.err)}`);
  let bidAfterParse = (await client.query("bids:listByPackage", { tradePackageId: elecPkgId })).find((b) => b.contractorId === c1);
  ev(`[7] c1 bid after parse: rev=${bidAfterParse?.revisionNumber} base=${bidAfterParse?.baseBidAmount} leveled=${bidAfterParse?.leveledTotalCost} lastRevisedAt=${bidAfterParse?.lastRevisedAt}`);
  let revMethod = "parse_path";
  if (!parsed.ok || (bidAfterParse?.revisionNumber ?? 1) < 2) {
    ev("[7] parse path did not yield rev2; falling back to direct re-submit (secondary method)");
    const direct2 = await attempt(() =>
      client.mutation("bids:submitDirectBid", {
        tradePackageId: elecPkgId, contractorId: c1, subcontractorName: "QA-14 Verifier Electric LLC", baseBidAmount: 1180000,
      })
    );
    revMethod = "direct_resubmit_fallback";
    bidAfterParse = (await client.query("bids:listByPackage", { tradePackageId: elecPkgId })).find((b) => b.contractorId === c1);
    ev(`[7] fallback submitDirectBid ok=${direct2.ok}; c1 rev=${bidAfterParse?.revisionNumber} base=${bidAfterParse?.baseBidAmount}`);
  }
  record("revision_increment", {
    parseOk: parsed.ok, parseMs, method: revMethod,
    revisionNumber: bidAfterParse?.revisionNumber ?? null,
    baseBidAmount: bidAfterParse?.baseBidAmount ?? null,
    lastRevisedAt: bidAfterParse?.lastRevisedAt ?? null,
  });
  OUT.items.revision_increment = (bidAfterParse?.revisionNumber ?? 0) >= 2 && typeof bidAfterParse?.lastRevisedAt === "number";
  ev("");

  // ---- 8. absurd bids ----
  const bidLow = await attempt(() =>
    client.mutation("bids:submitDirectBid", { tradePackageId: elecPkgId, contractorId: c2, subcontractorName: "QA-14 Absurd Bid Co", baseBidAmount: 1 })
  );
  const lowRead = bidLow.ok ? null : readable(bidLow.err, "1,000");
  const bidHigh = await attempt(() =>
    client.mutation("bids:submitDirectBid", { tradePackageId: elecPkgId, contractorId: c2, subcontractorName: "QA-14 Absurd Bid Co", baseBidAmount: 999999999 })
  );
  const highRead = bidHigh.ok ? null : readable(bidHigh.err, "budget");
  const c2Bids = (await client.query("bids:listByPackage", { tradePackageId: elecPkgId })).filter((b) => b.contractorId === c2);
  ev(`[8] $1 rejected=${!bidLow.ok} readable=${lowRead?.readable} text="${lowRead?.text}"`);
  ev(`[8] $999,999,999 rejected=${!bidHigh.ok} readable=${highRead?.readable} text="${highRead?.text}"`);
  ev(`[8] c2 bids persisted: ${c2Bids.length} (expect 0)`);
  record("absurd_bids", {
    low: { rejected: !bidLow.ok, err: bidLow.err ?? null, read: lowRead },
    high: { rejected: !bidHigh.ok, err: bidHigh.err ?? null, read: highRead },
    c2BidCount: c2Bids.length,
  });
  OUT.items.absurd_bids = !bidLow.ok && Boolean(lowRead?.readable) && !bidHigh.ok && Boolean(highRead?.readable) && c2Bids.length === 0;
  ev("");

  // ---- 9. guest RFI conversation persistence (deadline from submit time) ----
  let conversation = null;
  while (Date.now() - rfiSubmittedAt < 120000) {
    const convos = await client.query("rfq:listConversations", { tradePackageId: hvacPkgId });
    if (convos.length > 0) {
      conversation = convos[0];
      break;
    }
    await delay(4000);
  }
  const rfiWaitS = ((Date.now() - rfiSubmittedAt) / 1000).toFixed(1);
  if (conversation) {
    ev(`[9] guest conversation persisted after ${rfiWaitS}s: status=${conversation.status} subject="${conversation.inboundSubject}" replyChars=${(conversation.autonomousReply || "").length} confidence=${conversation.confidenceScore}`);
  } else {
    ev(`[9] FAIL no conversation within ${rfiWaitS}s`);
  }
  record("guest_rfi_persistence", {
    accepted: rfi.ok, conversationPersisted: Boolean(conversation), waitedS: Number(rfiWaitS),
    conversation: conversation
      ? { status: conversation.status, inboundSubject: conversation.inboundSubject, inboundQuestionChars: (conversation.inboundQuestion || "").length, autonomousReplyChars: (conversation.autonomousReply || "").length, confidenceScore: conversation.confidenceScore }
      : null,
  });
  OUT.items.guest_rfi_persists = rfi.ok && Boolean(conversation);
  ev("");

  // ---- 10. deduct-credit resolution persists across detect calls ----
  const beforeDeduct = await client.query("coordination:detectCrossTradeClashes", { projectId });
  const bidPre = (await client.query("bids:listByPackage", { tradePackageId: elecPkgId })).find((b) => b.contractorId === c1);
  const deduct = await attempt(() =>
    client.mutation("coordination:deductDoubleBuyCredit", {
      projectId, clashId: "clash-vfd-01", tradePackageId: elecPkgId, deductAmount: 38500, description: "VFD double-buy (QA-14)",
    })
  );
  const afterSameClient = await client.query("coordination:detectCrossTradeClashes", { projectId });
  const afterFreshClient = await freshClient().query("coordination:detectCrossTradeClashes", { projectId });
  const bidPost = (await client.query("bids:listByPackage", { tradePackageId: elecPkgId })).find((b) => b.contractorId === c1);
  const vfdSame = afterSameClient.doubleBuys.find((d) => d.id === "clash-vfd-01");
  const vfdFresh = afterFreshClient.doubleBuys.find((d) => d.id === "clash-vfd-01");
  ev(`[10] deduct ok=${deduct.ok} newLeveledCost=${deduct.value?.newLeveledCost ?? JSON.stringify(deduct.err)} (bid pre=${bidPre?.leveledTotalCost} post=${bidPost?.leveledTotalCost})`);
  ev(`[10] same-client re-detect: vfd=${vfdSame?.status} active=${afterSameClient.summary.activeClashesCount} dblExposure=${afterSameClient.summary.totalDoubleBuyExposure} (was ${beforeDeduct.summary.activeClashesCount}/${beforeDeduct.summary.totalDoubleBuyExposure})`);
  ev(`[10] fresh-client re-detect: vfd=${vfdFresh?.status} active=${afterFreshClient.summary.activeClashesCount}`);
  record("deduct_resolution", {
    deductOk: deduct.ok, deductResult: deduct.value ?? deduct.err,
    bidPre: bidPre?.leveledTotalCost ?? null, bidPost: bidPost?.leveledTotalCost ?? null,
    sameClient: { vfdStatus: vfdSame?.status, active: afterSameClient.summary.activeClashesCount, doubleExposure: afterSameClient.summary.totalDoubleBuyExposure },
    freshClient: { vfdStatus: vfdFresh?.status, active: afterFreshClient.summary.activeClashesCount },
  });
  OUT.items.deduct_persists =
    deduct.ok &&
    vfdSame?.status === "deducted" &&
    vfdFresh?.status === "deducted" &&
    afterSameClient.summary.activeClashesCount === 3 &&
    afterFreshClient.summary.activeClashesCount === 3 &&
    typeof bidPre?.leveledTotalCost === "number" &&
    typeof bidPost?.leveledTotalCost === "number" &&
    Math.abs((bidPre.leveledTotalCost - bidPost.leveledTotalCost) - 38500) < 0.5;
  ev("");

  // ---- 10b. assign void persists ----
  const assign = await attempt(() =>
    client.mutation("coordination:assignScopeVoidToTrade", {
      projectId, voidId: "void-bas-wiring-01", tradePackageId: elecPkgId, additionalCost: 28000, description: "BAS wiring void (QA-14)",
    })
  );
  const afterAssign = await freshClient().query("coordination:detectCrossTradeClashes", { projectId });
  const basVoid = afterAssign.scopeVoids.find((v) => v.id === "void-bas-wiring-01");
  ev(`[10b] assign ok=${assign.ok} fresh re-detect: void=${basVoid?.status} assignedTo=${basVoid?.assignedToDivision} active=${afterAssign.summary.activeClashesCount} (expect 2)`);
  record("assign_void", { assignOk: assign.ok, result: assign.value ?? assign.err, voidStatus: basVoid?.status, assignedToDivision: basVoid?.assignedToDivision, active: afterAssign.summary.activeClashesCount });
  OUT.items.assign_persists = assign.ok && basVoid?.status === "assigned" && afterAssign.summary.activeClashesCount === 2;
  ev("");

  // ---- 11. delete cascade ----
  const del = await attempt(() => client.mutation("projects:deleteProject", { projectId }));
  const pkgsAfterDel = await client.query("tradePackages:listByProject", { projectId });
  const bidsAfterDel = await client.query("bids:listByPackage", { tradePackageId: elecPkgId });
  const convosAfterDel = await client.query("rfq:listConversations", { tradePackageId: hvacPkgId });
  const contractorsAfterDel = await client.query("contractors:listByPackage", { tradePackageId: hvacPkgId });
  const filesAfterDel = await client.query("files:listFilesByProject", { projectId });
  const projectsAfter = await client.query("projects:listProjects", {});
  const stillListed = projectsAfter.some((p) => p._id === projectId);
  const leftoverNonDemo = projectsAfter.filter((p) => !p.isDemoProject);
  ev(`[11] delete ok=${del.ok}; after: packages=${pkgsAfterDel.length} bids=${bidsAfterDel.length} convos=${convosAfterDel.length} contractors=${contractorsAfterDel.length} files=${filesAfterDel.length} stillListed=${stillListed} nonDemo=${leftoverNonDemo.length}`);
  record("delete_cascade", {
    deleteOk: del.ok, result: del.value ?? del.err,
    packagesAfter: pkgsAfterDel.length, bidsAfter: bidsAfterDel.length, conversationsAfter: convosAfterDel.length,
    contractorsAfter: contractorsAfterDel.length, filesAfter: filesAfterDel.length, stillListed, remainingTitles: projectsAfter.map((p) => p.title),
  });
  OUT.items.delete_cascade =
    del.ok && pkgsAfterDel.length === 0 && bidsAfterDel.length === 0 && convosAfterDel.length === 0 &&
    contractorsAfterDel.length === 0 && filesAfterDel.length === 0 && !stillListed && leftoverNonDemo.length === 0;
  ev("");

  // ---- 12. demo unchanged ----
  const demoAfter = await snapshotProject(demoId);
  const demoMatchAfter = demoEquivalent(demoAfter, baseline.demoSnapshot);
  const clashDemo = await client.query("coordination:detectCrossTradeClashes", { projectId: demoId });
  ev(`[12] demo unchanged vs QA-14 baseline: ${JSON.stringify(demoMatchAfter)}; demo clashes=${clashDemo.doubleBuys.length}+${clashDemo.scopeVoids.length} active=${clashDemo.summary.activeClashesCount}`);
  record("demo_after", { ok: demoMatchAfter === true, mismatch: demoMatchAfter, snapshot: demoAfter, clashActive: clashDemo.summary.activeClashesCount });
  OUT.items.demo_unchanged = demoMatchAfter === true && clashDemo.summary.activeClashesCount === 4;
  ev("");

  const itemVals = Object.entries(OUT.items);
  const failedItems = itemVals.filter(([, v]) => !v).map(([k]) => k);
  OUT.finishedAt = new Date().toISOString();
  OUT.overall = failedItems.length === 0 ? "PASS" : "FAIL";
  OUT.failedItems = failedItems;
  ev(`ITEMS: ${itemVals.map(([k, v]) => `${k}=${v ? "PASS" : "FAIL"}`).join(" | ")}`);
  ev(`OVERALL: ${OUT.overall}${failedItems.length ? ` (failed: ${failedItems.join(", ")})` : ""}`);

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa14-backend-invariants.txt"), LOG.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa14-backend-invariants.json"), JSON.stringify(OUT, null, 2), "utf8");
  console.log("Wrote evidence files.");
  process.exitCode = failedItems.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa14-backend-invariants.txt"), LOG.join("\n") + `\nFATAL: ${e?.stack || e?.message}\n`, "utf8");
  process.exit(1);
});