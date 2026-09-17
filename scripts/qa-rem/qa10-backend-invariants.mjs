// QA-10 (round 4) backend invariant probe (fresh independent verifier).
// Charter items:
//  1. create QA-REM project -> appears in listProjects immediately AND via a fresh client.
//  2. createTradePackage "99 99 99" REJECTED with readable ConvexError data; nothing persisted.
//  3. submitDirectBid $1 and $999,999,999 on a package WITH a contractor REJECTED with readable messages.
//  4. guest RFI (submitCustomRfi, no contractorId) accepted on a package with NO contractors,
//     conversation persists within ~120s.
//  5. deleteProject cascades; listProjects clean.
//  6. demo project untouched (title/estBudget/package count + extras).
// Usage: node scripts/qa-rem/qa10-backend-invariants.mjs
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const TAG = `QA-REM-QA10-BE-${Date.now()}`;

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
  return {
    name: err?.name,
    message: err?.message,
    data: err?.data,
    dataType: typeof err?.data,
  };
}
function isReadable(errShapeObj, expectLike) {
  const data = errShapeObj?.data;
  const message = errShapeObj?.message ?? "";
  const text = typeof data === "string" ? data : "";
  const okData = text.length > 0 && !text.includes("[CONVEX]");
  const okMessage = !message.includes("[CONVEX] Server Error") && message.length > 0;
  const like = expectLike ? text.toLowerCase().includes(expectLike.toLowerCase()) || message.toLowerCase().includes(expectLike.toLowerCase()) : true;
  return { readable: okData || okMessage, okData, okMessage, matchesExpected: like, text: text || message };
}
async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, err: errShape(err) };
  }
}

async function demoSnapshot(label) {
  const demo = await client.query("projects:getDemoProject", {});
  const packages = await client.query("tradePackages:listByProject", { projectId: demo._id });
  let bidCount = 0;
  for (const p of packages) {
    const bids = await client.query("bids:listByPackage", { tradePackageId: p._id });
    bidCount += bids.length;
  }
  const agreements = await client.query("agreements:listAgreements", { projectId: demo._id });
  const logs = await client.query("auditLogs:listRecentLogs", { projectId: demo._id, limit: 1000 });
  const snap = {
    label,
    id: demo._id,
    title: demo.title,
    location: demo.location,
    estBudget: demo.estBudget,
    targetCompletionWeeks: demo.targetCompletionWeeks,
    isDemoProject: demo.isDemoProject,
    packageCount: packages.length,
    packageDivisions: packages.map((p) => p.csiDivision).sort(),
    bidCount,
    agreementCount: agreements.length,
    auditLogCount: logs.length,
  };
  return snap;
}

async function main() {
  ev("=== QA-10 BACKEND INVARIANTS ===");
  ev(`Backend: ${BACKEND}`);
  ev(`UTC    : ${new Date().toISOString()}`);
  ev(`Tag    : ${TAG}`);
  ev("");

  const demoBefore = await demoSnapshot("before");
  record("demo_before", demoBefore);
  ev(`demo before: title="${demoBefore.title}" budget=${demoBefore.estBudget} packages=${demoBefore.packageCount} bids=${demoBefore.bidCount} agreements=${demoBefore.agreementCount} logs=${demoBefore.auditLogCount}`);

  const projectsBefore = await client.query("projects:listProjects", {});
  record("projects_before", { count: projectsBefore.length, titles: projectsBefore.map((p) => p.title) });
  ev(`projects before: count=${projectsBefore.length} titles=${JSON.stringify(projectsBefore.map((p) => p.title))}`);
  ev("");

  // ---- 1. create project ----
  const created = await attempt(() =>
    client.mutation("projects:createProject", {
      title: TAG,
      location: "Austin, TX",
      projectType: "commercial",
      estBudget: 2400000,
      targetCompletionWeeks: 52,
      specDocumentText: "QA-10 backend invariant fixture. Division 26 electrical scope.",
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
  ev(`STEP1 appears in listProjects immediately: ${foundImmediate}`);
  const fresh = freshClient();
  const listedFresh = await fresh.query("projects:listProjects", {});
  const foundFresh = listedFresh.some((p) => p._id === projectId);
  ev(`STEP1 appears via fresh client: ${foundFresh}`);
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
  ev(`STEP2 CSI 99 99 99 rejected=${!badCsi.ok} readable=${badCsiRead?.readable} text="${badCsiRead?.text}"`);
  const pkgsAfterBadCsi = await client.query("tradePackages:listByProject", { projectId });
  ev(`STEP2 packages after bad CSI: ${pkgsAfterBadCsi.length} (expect 0)`);
  record("bad_csi", { rejected: !badCsi.ok, err: badCsi.err ?? null, readable: badCsiRead, packageCountAfter: pkgsAfterBadCsi.length });
  ev("");

  // ---- 3. legit package + contractor + absurd bids ----
  const pkg1 = await attempt(() =>
    client.mutation("tradePackages:createTradePackage", {
      projectId,
      csiDivision: "26 00 00",
      tradeName: "Electrical & Lighting Systems (QA-10)",
      budgetEstimate: 1200000,
      scopeSummary: "QA-10 fixture electrical scope for bid plausibility checks.",
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
    companyName: "QA-10 Verifier Electric",
    contactEmail: "qa10.verifier@example.com",
    phone: "+1 (512) 555-0199",
    licenseNumber: "TX-TECL-QA10",
    licenseStatus: "Active / Verified (TX Licensing)",
    sourceUrl: "https://example.com/qa10",
    rfqStatus: "invited",
  });
  ev(`STEP3 contractor -> ${contractorId}`);

  const bidLow = await attempt(() =>
    client.mutation("bids:submitDirectBid", {
      tradePackageId: packageId,
      contractorId,
      subcontractorName: "QA-10 Verifier Electric",
      baseBidAmount: 1,
    })
  );
  const bidLowRead = bidLow.ok ? null : isReadable(bidLow.err, "1,000");
  ev(`STEP3 $1 bid rejected=${!bidLow.ok} readable=${bidLowRead?.readable} text="${bidLowRead?.text}"`);

  const bidHigh = await attempt(() =>
    client.mutation("bids:submitDirectBid", {
      tradePackageId: packageId,
      contractorId,
      subcontractorName: "QA-10 Verifier Electric",
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
      tradeName: "HVAC Systems (QA-10 guest RFI fixture)",
      budgetEstimate: 800000,
      scopeSummary: "QA-10 fixture mechanical scope, deliberately no contractors.",
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
      subject: "QA-10 guest inquiry: temp power board supply",
      question: "Does the GC or the electrical subcontractor supply the 400A temporary power distribution board for this QA-10 fixture?",
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
  ev(`STEP4 contractors after RFI: ${contractorsAfterRfi.length} (guest record expected) names=${JSON.stringify(contractorsAfterRfi.map((c) => c.companyName))}`);
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
  ev(`STEP5 after delete: packages=${packagesAfterDelete.length} bids=${bidsAfterDelete.length} conversations=${convosAfterDelete.length} contractors=${contractorsAfterDelete.length} stillListed=${stillListed}`);
  ev(`STEP5 remaining projects: ${JSON.stringify(projectsAfter.map((p) => p.title))}`);
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
  const demoAfter = await demoSnapshot("after");
  const same =
    demoAfter.title === demoBefore.title &&
    demoAfter.estBudget === demoBefore.estBudget &&
    demoAfter.packageCount === demoBefore.packageCount &&
    demoAfter.bidCount === demoBefore.bidCount &&
    demoAfter.agreementCount === demoBefore.agreementCount &&
    demoAfter.auditLogCount === demoBefore.auditLogCount;
  ev(`STEP6 demo untouched (title/budget/packages/bids/agreements/logs): ${same}`);
  ev(`demo after : title="${demoAfter.title}" budget=${demoAfter.estBudget} packages=${demoAfter.packageCount} bids=${demoAfter.bidCount} agreements=${demoAfter.agreementCount} logs=${demoAfter.auditLogCount}`);
  record("demo_after", { ...demoAfter, unchanged: same });

  JSON_OUT.finishedAt = new Date().toISOString();
  const pass =
    foundImmediate && foundFresh && !badCsi.ok && badCsiRead?.readable &&
    !bidLow.ok && bidLowRead?.readable && !bidHigh.ok && bidHighRead?.readable &&
    rfi.ok && Boolean(conversation) && del.ok && !stillListed && same;
  JSON_OUT.overall = pass ? "PASS" : "FAIL";
  ev("");
  ev(`OVERALL: ${JSON_OUT.overall}`);

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-backend-invariants.txt"), LOG.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-backend-invariants.json"), JSON.stringify(JSON_OUT, null, 2), "utf8");
  console.log("Wrote evidence files.");
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-backend-invariants.txt"), LOG.join("\n") + `\nFATAL: ${e?.message}\n`, "utf8");
  process.exit(1);
});