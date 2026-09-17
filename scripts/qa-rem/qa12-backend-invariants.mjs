// QA-12 (round 5, final convergence) backend invariants.
// Charter:
//  1. create QA-REM fixture -> persists across fresh client.
//  2. CSI "99 99 99" rejected with ConvexError.data; nothing persisted.
//  3. $1 and $999,999,999 bids rejected; nothing persisted.
//  4. guest RFI accepted + conversation persisted within ~120s.
//  5. detectCrossTradeClashes: empty for 0-package fixture; non-empty for demo.
//  6. delete fixture cascades cleanly; demo baseline unchanged.
// Usage: node scripts/qa-rem/qa12-backend-invariants.mjs
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const TAG = `QA-REM-QA12-BE-${Date.now()}`;
const BASELINE_FILE = path.join(EVIDENCE_DIR, "remediation-qa12-baseline.json");

const LOG = [];
const JSON_OUT = { tag: TAG, backend: BACKEND, startedAt: new Date().toISOString(), steps: [] };
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
function record(name, obj) {
  JSON_OUT.steps.push({ name, ...obj, at: new Date().toISOString() });
}

const freshClient = () => new ConvexHttpClient(BACKEND);
const client = freshClient();

function errShape(err) {
  return { name: err?.name, message: err?.message, data: err?.data, dataType: typeof err?.data };
}
function isReadable(errShapeObj, expectLike) {
  const data = errShapeObj?.data;
  const message = errShapeObj?.message ?? "";
  const text = typeof data === "string" ? data : "";
  const okData = text.length > 0 && !text.includes("[CONVEX]");
  const okMessage = !message.includes("[CONVEX] Server Error") && message.length > 0;
  const like = expectLike
    ? text.toLowerCase().includes(expectLike.toLowerCase()) || message.toLowerCase().includes(expectLike.toLowerCase())
    : true;
  return { readable: okData || okMessage, okData, okMessage, matchesExpected: like, text: text || message };
}
async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, err: errShape(err) };
  }
}

async function snapshotProject(projectId) {
  const project = await client.query("projects:getProject", { projectId });
  const packages = await client.query("tradePackages:listByProject", { projectId });
  const bids = await client.query("bids:listAllProjectBids", { projectId });
  const agreements = await client.query("agreements:listAgreements", { projectId });
  const logs = await client.query("auditLogs:listRecentLogs", { projectId, limit: 1000 });
  const contractors = await client.query("contractors:listByProject", { projectId });
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
    agreementCount: agreements.length,
    agreementIds: agreements.map((a) => a._id).sort(),
    auditLogCount: logs.length,
    auditLogIds: logs.map((l) => l._id).sort(),
    contractorCount: contractors.length,
    contractorIds: contractors.map((c) => c._id).sort(),
  };
}

function demoEquivalent(a, b) {
  if (!a || !b) return false;
  const keys = ["title", "location", "estBudget", "targetCompletionWeeks", "isDemoProject", "packageCount", "bidCount", "agreementCount", "auditLogCount", "contractorCount"];
  for (const k of keys) if (a[k] !== b[k]) return { mismatch: k, a: a[k], b: b[k] };
  return true;
}

async function main() {
  ev("=== QA-12 BACKEND INVARIANTS ===");
  ev(`Backend: ${BACKEND}`);
  ev(`UTC    : ${new Date().toISOString()}`);
  ev(`Tag    : ${TAG}`);
  ev("");

  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
  const demoId = baseline.demoSnapshot.id;
  const demoBefore = await snapshotProject(demoId);
  record("demo_before", demoBefore);
  ev(`demo before: packages=${demoBefore.packageCount} bids=${demoBefore.bidCount} agreements=${demoBefore.agreementCount} logs=${demoBefore.auditLogCount} contractors=${demoBefore.contractorCount}`);
  const baselineMatchBefore = demoEquivalent(demoBefore, baseline.demoSnapshot);
  ev(`demo matches QA-12 baseline (pre-test): ${JSON.stringify(baselineMatchBefore)}`);
  ev("");

  // ---- 1. create project + fresh client visibility ----
  const created = await attempt(() =>
    client.mutation("projects:createProject", {
      title: TAG,
      location: "Austin, TX",
      projectType: "commercial",
      estBudget: 2400000,
      targetCompletionWeeks: 52,
      specDocumentText: "QA-12 backend invariant fixture. Division 26 electrical scope.",
      isDemoProject: false,
    })
  );
  if (!created.ok) {
    ev(`STEP1 FAIL: createProject errored: ${JSON.stringify(created.err)}`);
    record("create_project", created);
    throw new Error("cannot continue without fixture");
  }
  const projectId = created.value;
  record("create_project", { ok: true, projectId });
  ev(`STEP1 createProject -> ${projectId}`);
  const listedNow = await client.query("projects:listProjects", {});
  const foundImmediate = listedNow.some((p) => p._id === projectId);
  const fresh = freshClient();
  const listedFresh = await fresh.query("projects:listProjects", {});
  const foundFresh = listedFresh.some((p) => p._id === projectId);
  ev(`STEP1 listed immediately=${foundImmediate}; fresh client=${foundFresh}`);
  record("project_visibility", { foundImmediate, foundFresh, projectCountNow: listedNow.length });
  ev("");

  // ---- 2. CSI 99 99 99 rejected ----
  const badCsi = await attempt(() =>
    client.mutation("tradePackages:createTradePackage", {
      projectId,
      csiDivision: "99 99 99",
      tradeName: "Impossible Division",
      budgetEstimate: 500000,
      scopeSummary: "Should never persist.",
      mandatoryInclusions: [],
      bidDeadline: "2026-12-31",
    })
  );
  const badCsiRead = badCsi.ok ? null : isReadable(badCsi.err, "00");
  ev(`STEP2 CSI 99 99 99 rejected=${!badCsi.ok} readable=${badCsiRead?.readable} matchesRangeGuidance=${badCsiRead?.matchesExpected} text="${badCsiRead?.text}"`);
  const pkgsAfterBadCsi = await client.query("tradePackages:listByProject", { projectId });
  ev(`STEP2 packages after bad CSI: ${pkgsAfterBadCsi.length} (expect 0)`);
  record("bad_csi", { rejected: !badCsi.ok, err: badCsi.err ?? null, readable: badCsiRead, packageCountAfter: pkgsAfterBadCsi.length });
  ev("");

  // ---- 2b. clash query on 0-package fixture ----
  const clashEmpty = await attempt(() => client.query("coordination:detectCrossTradeClashes", { projectId }));
  const clashEmptyCount = clashEmpty.ok
    ? (clashEmpty.value?.doubleBuys?.length ?? 0) + (clashEmpty.value?.scopeVoids?.length ?? 0)
    : null;
  const clashEmptySummary = clashEmpty.ok ? clashEmpty.value?.summary ?? null : null;
  ev(`STEP2b fixture clashes: ok=${clashEmpty.ok} count=${clashEmptyCount} summary=${JSON.stringify(clashEmptySummary)}`);
  record("clash_fixture_empty", { ok: clashEmpty.ok, count: clashEmptyCount, summary: clashEmptySummary });
  ev("");

  // ---- 3. legit package + contractor + absurd bids ----
  const pkg1 = await attempt(() =>
    client.mutation("tradePackages:createTradePackage", {
      projectId,
      csiDivision: "26 00 00",
      tradeName: "Electrical & Lighting Systems (QA-12)",
      budgetEstimate: 1200000,
      scopeSummary: "QA-12 fixture electrical scope for bid plausibility checks.",
      mandatoryInclusions: ["Switchgear", "Seismic bracing"],
      bidDeadline: "2026-12-31",
    })
  );
  if (!pkg1.ok) {
    ev(`STEP3 FAIL creating legit package: ${JSON.stringify(pkg1.err)}`);
    record("legit_package", pkg1);
    throw new Error("cannot continue without legit package");
  }
  const packageId = pkg1.value;
  ev(`STEP3 legit package 26 00 00 -> ${packageId}`);
  const contractorId = await client.mutation("contractors:createContractor", {
    tradePackageId: packageId,
    companyName: "QA-12 Verifier Electric",
    contactEmail: "qa12.verifier@example.com",
    phone: "+1 (512) 555-0199",
    licenseNumber: "TX-TECL-QA12",
    licenseStatus: "Active / Verified (TX Licensing)",
    sourceUrl: "https://example.com/qa12",
    rfqStatus: "invited",
  });
  ev(`STEP3 contractor -> ${contractorId}`);

  const bidLow = await attempt(() =>
    client.mutation("bids:submitDirectBid", {
      tradePackageId: packageId,
      contractorId,
      subcontractorName: "QA-12 Verifier Electric",
      baseBidAmount: 1,
    })
  );
  const bidLowRead = bidLow.ok ? null : isReadable(bidLow.err, "1,000");
  ev(`STEP3 $1 bid rejected=${!bidLow.ok} readable=${bidLowRead?.readable} text="${bidLowRead?.text}"`);

  const bidHigh = await attempt(() =>
    client.mutation("bids:submitDirectBid", {
      tradePackageId: packageId,
      contractorId,
      subcontractorName: "QA-12 Verifier Electric",
      baseBidAmount: 999999999,
    })
  );
  const bidHighRead = bidHigh.ok ? null : isReadable(bidHigh.err, "budget");
  ev(`STEP3 $999,999,999 bid rejected=${!bidHigh.ok} readable=${bidHighRead?.readable} text="${bidHighRead?.text}"`);

  const bidsAfter = await client.query("bids:listByPackage", { tradePackageId: packageId });
  ev(`STEP3 bids persisted after rejects: ${bidsAfter.length} (expect 0)`);
  record("absurd_bids", {
    low: { rejected: !bidLow.ok, err: bidLow.err ?? null, readable: bidLowRead },
    high: { rejected: !bidHigh.ok, err: bidHigh.err ?? null, readable: bidHighRead },
    bidCountAfter: bidsAfter.length,
  });
  ev("");

  // ---- 4. guest RFI on package with no contractors ----
  const pkg2 = await attempt(() =>
    client.mutation("tradePackages:createTradePackage", {
      projectId,
      csiDivision: "23 00 00",
      tradeName: "HVAC Systems (QA-12 guest RFI fixture)",
      budgetEstimate: 800000,
      scopeSummary: "QA-12 fixture mechanical scope, deliberately no contractors.",
      mandatoryInclusions: ["RTUs"],
      bidDeadline: "2026-12-31",
    })
  );
  if (!pkg2.ok) {
    ev(`STEP4 FAIL creating guest-RFI package: ${JSON.stringify(pkg2.err)}`);
    record("guest_rfi_package", pkg2);
    throw new Error("cannot continue without guest RFI package");
  }
  const guestPkgId = pkg2.value;
  const contractorsBeforeRfi = await client.query("contractors:listByPackage", { tradePackageId: guestPkgId });
  ev(`STEP4 guest package ${guestPkgId} contractors before RFI: ${contractorsBeforeRfi.length} (expect 0)`);

  const rfi = await attempt(() =>
    client.mutation("simulation:submitCustomRfi", {
      tradePackageId: guestPkgId,
      subject: "QA-12 guest inquiry: temp power board supply",
      question:
        "Does the GC or the electrical subcontractor supply the 400A temporary power distribution board for this QA-12 fixture?",
    })
  );
  ev(`STEP4 submitCustomRfi accepted=${rfi.ok}${rfi.ok ? ` message="${rfi.value?.message}"` : ` err=${JSON.stringify(rfi.err)}`}`);

  let conversation = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    const convos = await client.query("rfq:listConversations", { tradePackageId: guestPkgId });
    if (convos.length > 0) {
      conversation = convos[0];
      break;
    }
    await delay(5000);
  }
  const waitedS = ((Date.now() - t0) / 1000).toFixed(1);
  if (conversation) {
    ev(`STEP4 conversation persisted after ${waitedS}s: status=${conversation.status} subject="${conversation.inboundSubject}" replyChars=${(conversation.autonomousReply || "").length} confidence=${conversation.confidenceScore}`);
  } else {
    ev(`STEP4 FAIL: no conversation persisted within ${waitedS}s`);
  }
  const contractorsAfterRfi = await client.query("contractors:listByPackage", { tradePackageId: guestPkgId });
  ev(`STEP4 contractors after RFI: ${contractorsAfterRfi.length} names=${JSON.stringify(contractorsAfterRfi.map((c) => c.companyName))}`);
  record("guest_rfi", {
    accepted: rfi.ok,
    err: rfi.err ?? null,
    response: rfi.value ?? null,
    conversationPersisted: Boolean(conversation),
    waitedS: Number(waitedS),
    conversation: conversation
      ? {
          status: conversation.status,
          inboundSubject: conversation.inboundSubject,
          inboundQuestionChars: (conversation.inboundQuestion || "").length,
          autonomousReplyChars: (conversation.autonomousReply || "").length,
          confidenceScore: conversation.confidenceScore,
          threadId: conversation.threadId,
        }
      : null,
    contractorsAfter: contractorsAfterRfi.map((c) => c.companyName),
  });
  ev("");

  // ---- 5. delete cascade ----
  const del = await attempt(() => client.mutation("projects:deleteProject", { projectId }));
  ev(`STEP5 deleteProject -> ${del.ok ? JSON.stringify(del.value) : JSON.stringify(del.err)}`);
  const packagesAfterDelete = await client.query("tradePackages:listByProject", { projectId });
  const bidsAfterDelete = await client.query("bids:listByPackage", { tradePackageId: packageId });
  const convosAfterDelete = await client.query("rfq:listConversations", { tradePackageId: guestPkgId });
  const contractorsAfterDelete = await client.query("contractors:listByPackage", { tradePackageId: guestPkgId });
  const projectsAfter = await client.query("projects:listProjects", {});
  const stillListed = projectsAfter.some((p) => p._id === projectId);
  const leftoverNonDemo = projectsAfter.filter((p) => !p.isDemoProject);
  ev(`STEP5 after delete: packages=${packagesAfterDelete.length} bids=${bidsAfterDelete.length} conversations=${convosAfterDelete.length} contractors=${contractorsAfterDelete.length} stillListed=${stillListed} nonDemoRemaining=${leftoverNonDemo.length}`);
  record("delete_cascade", {
    deleteOk: del.ok,
    err: del.err ?? null,
    packagesAfter: packagesAfterDelete.length,
    bidsAfter: bidsAfterDelete.length,
    conversationsAfter: convosAfterDelete.length,
    contractorsAfter: contractorsAfterDelete.length,
    stillListed,
    remainingTitles: projectsAfter.map((p) => p.title),
  });
  ev("");

  // ---- 6. demo untouched ----
  const demoAfter = await snapshotProject(demoId);
  const baselineMatchAfter = demoEquivalent(demoAfter, baseline.demoSnapshot);
  ev(`STEP6 demo unchanged vs QA-12 baseline: ${JSON.stringify(baselineMatchAfter)}`);
  const clashDemo = await attempt(() => client.query("coordination:detectCrossTradeClashes", { projectId: demoId }));
  const demoClashCount = clashDemo.ok
    ? (clashDemo.value?.doubleBuys?.length ?? 0) + (clashDemo.value?.scopeVoids?.length ?? 0)
    : null;
  ev(`STEP6 demo clashes: ok=${clashDemo.ok} count=${demoClashCount} (expect non-empty, >=4)`);
  record("demo_after", { ...demoAfter, unchanged: baselineMatchAfter === true, clashCount: demoClashCount });

  JSON_OUT.finishedAt = new Date().toISOString();
  const pass =
    foundImmediate &&
    foundFresh &&
    !badCsi.ok &&
    badCsiRead?.readable &&
    clashEmpty.ok &&
    clashEmptyCount === 0 &&
    !bidLow.ok &&
    bidLowRead?.readable &&
    !bidHigh.ok &&
    bidHighRead?.readable &&
    rfi.ok &&
    Boolean(conversation) &&
    del.ok &&
    !stillListed &&
    leftoverNonDemo.length === 0 &&
    baselineMatchAfter === true &&
    clashDemo.ok &&
    demoClashCount > 0;
  JSON_OUT.overall = pass ? "PASS" : "FAIL";
  ev("");
  ev(`OVERALL: ${JSON_OUT.overall}`);

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-backend-invariants.txt"), LOG.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-backend-invariants.json"), JSON.stringify(JSON_OUT, null, 2), "utf8");
  console.log("Wrote evidence files.");
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-backend-invariants.txt"), LOG.join("\n") + `\nFATAL: ${e?.message}\n`, "utf8");
  process.exit(1);
});