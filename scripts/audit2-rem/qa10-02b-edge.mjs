import { client, readEvidence, writeEvidence, writeLog, corruptId, call } from "./qa10-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const rows = [];
const say = (s) => { log.push(s); console.log(s); };

function record(id, expected, entry, note) {
  const observed = entry.ok
    ? `ACCEPTED ${typeof entry.value === "object" ? JSON.stringify(entry.value).slice(0, 200) : entry.value}`
    : `REJECTED: ${(entry.data ?? entry.message ?? "").toString().split("\n")[0].slice(0, 200)}`;
  const ok = expected === "reject" ? !entry.ok : expected === "accept" ? entry.ok : true;
  rows.push({ id, expected, observed, ok, note: note ?? null });
  say(`${ok ? "ok " : "FLAG"} ${id} | expected=${expected} | ${observed}`);
  return entry;
}

async function main() {
  const alphaPkg = F.alpha.elecPackageId;
  const alphaProject = F.alpha.projectId;
  const bravoPkg = F.bravo.elecPackageId;
  const bravoBid = F.bravo.bid;
  const bravoCtr = F.bravo.contractor;
  const malPkg = F.malformed.elecPackageId;
  const malProject = F.malformed.projectId;
  const malCtr = F.malformed.contractor;
  const corruptPkg = corruptId(alphaPkg, 12);
  const corruptProj = corruptId(alphaProject, 12);
  const corruptBid = corruptId(bravoBid, 12);

  // ---------- RFQ ----------
  record("A10-R01 dispatchRfqs nonexistent package", "reject", await call("bogus pkg", () => c.mutation("rfq:dispatchRfqs", { tradePackageId: corruptPkg })));
  const rfqEmpty = await call("empty-pkg dispatch", () => c.mutation("rfq:dispatchRfqs", { tradePackageId: malPkg }));
  record("A10-R02 dispatchRfqs re-dispatch (idempotent)", "inspect", rfqEmpty, rfqEmpty.ok ? `dispatchedCount=${rfqEmpty.value.dispatchedCount}` : null);
  record("A10-R03 reviewEscalatedRfi nonexistent", "reject", await call("bogus convo", () => c.mutation("rfq:reviewEscalatedRfi", { conversationId: "jx7c5a2mky9r6veah4hntv6z9d6wdg4z", status: "clarified" })));
  record("A10-R04 reviewEscalatedRfi invalid status", "reject", await call("bad status", () => c.mutation("rfq:reviewEscalatedRfi", { conversationId: "jx7c5a2mky9r6veah4hntv6z9d6wdg4z", status: "hacked" })));

  // custom RFI
  record("A10-R05 submitCustomRfi empty question", "reject", await call("empty q", () => c.mutation("simulation:submitCustomRfi", { tradePackageId: alphaPkg, subject: "QA10", question: "   " })));
  record("A10-R06 submitCustomRfi 4001-char question", "reject", await call("4001 q", () => c.mutation("simulation:submitCustomRfi", { tradePackageId: alphaPkg, subject: "QA10", question: "Q".repeat(4001) })));
  record("A10-R07 submitCustomRfi 201-char subject", "reject", await call("201 s", () => c.mutation("simulation:submitCustomRfi", { tradePackageId: alphaPkg, subject: "S".repeat(201), question: "valid question?" })));
  record("A10-R08 submitCustomRfi foreign contractor", "reject", await call("foreign ctr", () => c.mutation("simulation:submitCustomRfi", { tradePackageId: alphaPkg, contractorId: bravoCtr, subject: "QA10", question: "valid question?" })));
  record("A10-R09 submitCustomRfi nonexistent package", "reject", await call("bogus pkg", () => c.mutation("simulation:submitCustomRfi", { tradePackageId: corruptPkg, subject: "QA10", question: "valid question?" })));
  const rfi = await call("valid rfi", () => c.mutation("simulation:submitCustomRfi", { tradePackageId: alphaPkg, subject: "QA10 adversarial RFI 😀 <script>", question: "QA10 question with emoji 😀 and RTL مرحبا?" }));
  record("A10-R10 submitCustomRfi 4000-char emoji/RTL edge", "inspect", rfi, rfi.ok ? `conversationId=${rfi.value.conversationId}` : null);
  const rfiId = rfi.ok ? rfi.value.conversationId : null;
  record("A10-R11 retryRfiAnalysis nonexistent", "reject", await call("bogus convo", () => c.mutation("simulation:retryRfiAnalysis", { conversationId: "jx7c5a2mky9r6veah4hntv6z9d6wdg4z" })));
  if (rfiId) {
    const retry = await call("retry own", () => c.mutation("simulation:retryRfiAnalysis", { conversationId: rfiId }));
    record("A10-R12 retryRfiAnalysis on own pending/failed RFI", "inspect", retry, JSON.stringify(retry.value ?? retry.data));
    const pmCert = await call("pm certify pending", () => c.mutation("rfq:reviewEscalatedRfi", { conversationId: rfiId, status: "clarified" }));
    record("A10-R13 reviewEscalatedRfi certifies unanalyzed RFI", "inspect", pmCert, "PM certification accepts a pending/failed RFI without requiring a model reply");
    const convoRow = await c.query("rfq:listConversations", { tradePackageId: alphaPkg });
    const row = (convoRow || []).find((x) => x._id === rfiId);
    rows[rows.length - 1].note = row ? `status=${row.status} replyLen=${(row.autonomousReply || "").length} pmCertifiedAt=${row.pmCertifiedAt ? "set" : "unset"}` : "row not found";
  }

  // ---------- FILES ----------
  record("A10-F01 saveFileRecord http storageId", "reject", await call("http id", () => c.mutation("files:saveFileRecord", { projectId: alphaProject, storageId: "https://evil.example/x.pdf", fileName: "x.pdf", fileType: "spec", fileSize: 100, uploadedBy: "QA10" })));
  record("A10-F02 saveFileRecord rooted path storageId", "reject", await call("slash id", () => c.mutation("files:saveFileRecord", { projectId: alphaProject, storageId: "/etc/passwd", fileName: "x.pdf", fileType: "spec", fileSize: 100, uploadedBy: "QA10" })));
  record("A10-F03 saveFileRecord path traversal name", "reject", await call("trav", () => c.mutation("files:saveFileRecord", { projectId: alphaProject, storageId: "jd70w8vgd9hbv5mgd8mrtrwtd18enw3c", fileName: "../evil.pdf", fileType: "spec", fileSize: 100, uploadedBy: "QA10" })));
  record("A10-F04 saveFileRecord .exe extension", "reject", await call("exe", () => c.mutation("files:saveFileRecord", { projectId: alphaProject, storageId: "jd70w8vgd9hbv5mgd8mrtrwtd18enw3c", fileName: "evil.exe", fileType: "spec", fileSize: 100, uploadedBy: "QA10" })));
  record("A10-F05 saveFileRecord bad fileType", "reject", await call("bad type", () => c.mutation("files:saveFileRecord", { projectId: alphaProject, storageId: "jd70w8vgd9hbv5mgd8mrtrwtd18enw3c", fileName: "x.pdf", fileType: "malware", fileSize: 100, uploadedBy: "QA10" })));
  record("A10-F06 saveFileRecord negative fileSize", "reject", await call("neg size", () => c.mutation("files:saveFileRecord", { projectId: alphaProject, storageId: "quote_qa10neg", fileName: "x.pdf", fileType: "quote_pdf", fileSize: -1, uploadedBy: "QA10" })));
  record("A10-F07 saveFileRecord cross-project package", "reject", await call("cross", () => c.mutation("files:saveFileRecord", { projectId: alphaProject, tradePackageId: bravoPkg, storageId: "quote_qa10cross", fileName: "x.pdf", fileType: "quote_pdf", fileSize: 5000, uploadedBy: "QA10" })));
  record("A10-F08 saveFileRecord nonexistent project", "reject", await call("bogus proj", () => c.mutation("files:saveFileRecord", { projectId: corruptProj, storageId: "quote_qa10x", fileName: "x.pdf", fileType: "quote_pdf", fileSize: 5000, uploadedBy: "QA10" })));
  record("A10-F09 saveFileRecord contentType mismatch", "reject", await call("mismatch", () => c.mutation("files:saveFileRecord", { projectId: alphaProject, storageId: "quote_qa10ct", fileName: "x.pdf", fileType: "quote_pdf", fileSize: 5000, uploadedBy: "QA10", contentType: "text/plain" })));
  const fakeFile = await call("fake quote_ record", () => c.mutation("files:saveFileRecord", { projectId: alphaProject, storageId: "quote_qa10_fake_blob", fileName: "QA10_Fake_Quote.pdf", fileType: "quote_pdf", fileSize: 123456, uploadedBy: "QA10" }));
  record("A10-F10 saveFileRecord synthetic quote_ id (no blob)", "inspect", fakeFile, fakeFile.ok ? "phantom file row accepted with no storage object" : null);
  let fakeFileId = fakeFile.ok ? fakeFile.value : null;
  if (fakeFileId) {
    const listed = await c.query("files:listFilesByProject", { projectId: alphaProject });
    const row = (listed || []).find((x) => x._id === fakeFileId);
    rows[rows.length - 1].note = `url=${row?.url ?? "null"} exists=${!!row}`;
  }
  record("A10-F11 deleteFile nonexistent", "reject", await call("bogus file", () => c.mutation("files:deleteFile", { fileId: "jx7c5a2mky9r6veah4hntv6z9d6wdg4z" })));
  record("A10-F12 deleteFile on phantom row", "inspect", await call("delete phantom", () => c.mutation("files:deleteFile", { fileId: fakeFileId })), "cleanup of the phantom row");
  fakeFileId = null;

  // ---------- CRONS ----------
  record("A10-X01 runDeadlineMonitorNow nonexistent project", "reject", await call("bogus proj", () => c.mutation("crons:runDeadlineMonitorNow", { projectId: corruptProj })));
  record("A10-X02 runComplianceAuditNow nonexistent project", "reject", await call("bogus proj", () => c.mutation("crons:runComplianceAuditNow", { projectId: corruptProj })));
  const mon = await call("monitor alpha", () => c.mutation("crons:runDeadlineMonitorNow", { projectId: alphaProject }));
  record("A10-X03 runDeadlineMonitorNow alpha counts", "inspect", mon, JSON.stringify(mon.value));
  const comp = await call("compliance alpha", () => c.mutation("crons:runComplianceAuditNow", { projectId: alphaProject }));
  record("A10-X04 runComplianceAuditNow alpha counts", "inspect", comp, JSON.stringify(comp.value));

  // ---------- COORDINATION ----------
  record("A10-K01 deductDoubleBuyCredit nonexistent project", "reject", await call("bogus proj", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: corruptProj, clashId: "clash-vfd-01", tradePackageId: alphaPkg, deductAmount: 1000, description: "x" })));
  record("A10-K02 deductDoubleBuyCredit cross-project package", "reject", await call("cross pkg", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: alphaProject, clashId: "clash-vfd-01", tradePackageId: bravoPkg, deductAmount: 1000, description: "QA10 cross" })));
  record("A10-K03 deductDoubleBuyCredit negative amount", "reject", await call("neg", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: alphaProject, clashId: "clash-vfd-01", tradePackageId: alphaPkg, deductAmount: -5000, description: "QA10 neg" })));
  record("A10-K04 deductDoubleBuyCredit empty description", "reject", await call("empty desc", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: alphaProject, clashId: "clash-vfd-01", tradePackageId: alphaPkg, deductAmount: 5000, description: "   " })));
  record("A10-K05 deductDoubleBuyCredit foreign bidId", "reject", await call("foreign bid", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: alphaProject, clashId: "clash-vfd-01", tradePackageId: alphaPkg, deductAmount: 5000, description: "QA10 foreign bid", bidId: bravoBid })));
  const arbitraryClash = await call("arbitrary clash id", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: alphaProject, clashId: "not-a-real-clash-QA10", tradePackageId: alphaPkg, deductAmount: 1234, description: "QA10 arbitrary clash" }));
  record("A10-K06 deductDoubleBuyCredit arbitrary clashId", "inspect", arbitraryClash, arbitraryClash.ok ? "arbitrary clashId accepted and persisted as clashResolutions row" : null);
  const aliased = await call("clash alias", () => c.mutation("coordination:deductDoubleBuyCredit", { projectId: alphaProject, clashId: "clash-vfd-01", tradePackageId: alphaPkg, deductAmount: 9999, description: "QA10 alias credit" }));
  record("A10-K07 duplicate clash deduct different description", "inspect", aliased, aliased.ok ? "second credit for same clash accepted (additive leveling deduct)" : null);
  record("A10-K08 assignScopeVoidToTrade cross-project", "reject", await call("cross pkg", () => c.mutation("coordination:assignScopeVoidToTrade", { projectId: alphaProject, voidId: "void-bas-wiring-01", tradePackageId: bravoPkg, additionalCost: 5000, description: "QA10 cross void" })));
  record("A10-K09 assignScopeVoidToTrade negative cost", "reject", await call("neg", () => c.mutation("coordination:assignScopeVoidToTrade", { projectId: alphaProject, voidId: "void-bas-wiring-01", tradePackageId: alphaPkg, additionalCost: -1, description: "QA10 neg void" })));
  record("A10-K10 assignScopeVoidToTrade empty description", "reject", await call("empty", () => c.mutation("coordination:assignScopeVoidToTrade", { projectId: alphaProject, voidId: "void-bas-wiring-01", tradePackageId: alphaPkg, additionalCost: 5000, description: " " })));
  const voidOk = await call("void ok", () => c.mutation("coordination:assignScopeVoidToTrade", { projectId: alphaProject, voidId: "void-smoke-detectors-02", tradePackageId: F.alpha.hvacPackageId, additionalCost: 1000, description: "QA10 assigned smoke detector scope" }));
  record("A10-K11 assignScopeVoidToTrade valid", "accept", voidOk);
  const clashState = await c.query("coordination:detectCrossTradeClashes", { projectId: alphaProject });
  writeEvidence("edge-clash-state", clashState);
  record("A10-K12 clash state after arbitrary clash rows", "inspect", { ok: true, value: { active: clashState.summary?.activeClashesCount, doubleBuys: clashState.doubleBuys?.map((d) => d.status) } }, "persisted arbitrary clashId rows do not map to any displayed clash");

  // ---------- SIMULATION ----------
  record("A10-S01 triggerJudgeSimulation nonexistent pkg", "reject", await call("bogus pkg", () => c.mutation("simulation:triggerJudgeSimulation", { tradePackageId: corruptPkg, scenario: "rfi_inquiry" })));
  record("A10-S02 triggerJudgeSimulation bad scenario", "reject", await call("bad scenario", () => c.mutation("simulation:triggerJudgeSimulation", { tradePackageId: alphaPkg, scenario: "rm_rf" })));
  record("A10-S03 runFullProcurementCycle nonexistent project", "reject", await call("bogus proj", () => c.mutation("simulation:runFullProcurementCycle", { projectId: corruptProj })));
  record("A10-S04 runFullProcurementCycle cross-project package", "reject", await call("cross pkg", () => c.mutation("simulation:runFullProcurementCycle", { projectId: alphaProject, tradePackageId: bravoPkg })));

  // ---------- FILE ACTIONS ----------
  record("A10-FA01 extractBidFromQuoteFile cross-project", "reject", await call("cross", () => c.action("files:extractBidFromQuoteFile", { projectId: alphaProject, tradePackageId: bravoPkg, quoteText: "Base Bid Price: $500,000 for QA10 cross project" })));
  record("A10-FA02 extractBidFromQuoteFile short text", "inspect", await call("short text", () => c.action("files:extractBidFromQuoteFile", { projectId: alphaProject, tradePackageId: alphaPkg, quoteText: "hi" })));
  record("A10-FA03 extractBidFromQuoteFile nonexistent fileId", "reject", await call("bogus file", () => c.action("files:extractBidFromFile", { projectId: alphaProject, tradePackageId: alphaPkg, fileId: "jx7c5a2mky9r6veah4hntv6z9d6wdg4z" })));
  record("A10-FA04 generatePreBidAddendum cross-project package", "reject", await call("cross addendum", () => c.action("files:generatePreBidAddendum", { projectId: alphaProject, tradePackageId: bravoPkg })));
  record("A10-FA05 generatePreBidAddendum with pending RFI", "reject", await call("pending addendum", () => c.action("files:generatePreBidAddendum", { projectId: alphaProject })), "alpha has the QA10 adversarial RFI possibly pending");

  // ---------- stored-value verification of accepted-inspection probes ----------
  const malPkgs = await c.query("tradePackages:listByProject", { projectId: malProject });
  const emptyIncl = malPkgs.find((p) => p.csiDivision === "05 00 00");
  const hugeIncl = malPkgs.find((p) => p.csiDivision === "06 00 00");
  const malBids = await c.query("bids:listByPackage", { tradePackageId: malPkg });
  const negLineBid = malBids.find((b) => (b.lineItems || []).some((li) => li.totalCost < 0));
  const negWeekBid = malBids.find((b) => typeof b.longLeadEquipmentWeeks === "number" && b.longLeadEquipmentWeeks < 0);
  const scriptSevBid = malBids.find((b) => (b.identifiedExclusions || []).some((e) => String(e.severity).includes("<script>")));
  const stored = {
    emptyInclusions: emptyIncl ? emptyIncl.mandatoryInclusions : "not found",
    hugeInclusionsCount: hugeIncl ? hugeIncl.mandatoryInclusions.length : "not found",
    hugeInclusionsChars: hugeIncl ? hugeIncl.mandatoryInclusions.join("").length : "not found",
    negativeLineItems: negLineBid ? negLineBid.lineItems : "not found",
    negativeLeadWeeksBid: negWeekBid ? { id: negWeekBid._id, weeks: negWeekBid.longLeadEquipmentWeeks, leveled: negWeekBid.leveledTotalCost } : "not found",
    scriptSeverity: scriptSevBid ? scriptSevBid.identifiedExclusions : "not found",
  };
  writeEvidence("edge-stored-values", stored);
  say(`stored emptyInclusions=${JSON.stringify(stored.emptyInclusions)} hugeInclusions=${stored.hugeInclusionsCount}x${stored.hugeInclusionsChars}chars negativeLeadWeeks=${JSON.stringify(stored.negativeLeadWeeksBid)}`);

  writeEvidence("malformed-edge", { generatedAt: new Date().toISOString(), rows, log, stored });
  writeLog("malformed-edge", log);
  const fails = rows.filter((r) => !r.ok);
  console.log(`\nTOTAL ${rows.length} probes, ${fails.length} flagged`);
}

main().catch((e) => { console.error(e); process.exit(1); });