import { ConvexHttpClient } from "convex/browser";
import { writeJson, writeLog } from "./lib.mjs";

const c = new ConvexHttpClient(process.env.REM_CONVEX_URL || "https://brainy-skunk-440.convex.cloud");
const FIXTURE = "AUDIT-QA3-fixture-2026-09-18";
const TMP = "AUDIT-QA3-tmpdel-2026-09-18";

const results = [];
const rec = (id, label, outcome, detail) => {
  results.push({ id, label, outcome, detail });
  console.log(`${outcome.padEnd(8)} ${id} ${label} :: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};

async function call(fn, args) {
  try {
    const value = await c.mutation(fn, args);
    return { threw: false, value };
  } catch (e) {
    return { threw: true, data: e && e.data !== undefined ? e.data : null, message: e && e.message ? e.message : String(e) };
  }
}
async function query(fn, args) {
  try { return { threw: false, value: await c.query(fn, args) }; }
  catch (e) { return { threw: true, data: e && e.data !== undefined ? e.data : null, message: e && e.message ? e.message : String(e) }; }
}
const errText = (r) => (r.data && typeof r.data === "string" ? r.data : r.data ? JSON.stringify(r.data) : r.message);

const run = async () => {
  const out = { startedAt: new Date().toISOString(), fixture: null, results, accepted: [] };
  let projects = (await query("projects:listProjects", {})).value;
  let fixture = projects.find((p) => p.title === FIXTURE);
  if (!fixture) {
    const r = await call("projects:createProject", {
      title: FIXTURE, location: "Austin, TX", projectType: "Class-A Commercial Mixed-Use",
      estBudget: 1000000, targetCompletionWeeks: 52, specDocumentText: "QA3 fixture spec", isDemoProject: false,
    });
    if (r.threw) throw new Error("could not create fixture: " + errText(r));
    fixture = { _id: r.value };
    rec("V0", "fixture created", "SETUP", FIXTURE);
  }
  out.fixture = { id: fixture._id, title: FIXTURE };

  // ---------- A. createProject validation ----------
  const cp = (over) => call("projects:createProject", {
    title: "AUDIT-QA3-x-2026-09-18", location: "Dallas, TX", projectType: "Class-A", estBudget: 100000,
    targetCompletionWeeks: 52, specDocumentText: "s", isDemoProject: false, ...over,
  });
  let r = await cp({ title: "" });
  rec("V1", "createProject empty title rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await cp({ title: "   " });
  rec("V2", "createProject whitespace title rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await cp({ title: "T".repeat(501) });
  rec("V3", "createProject 501-char title rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  for (const [id, over, note] of [
    ["V4", { estBudget: 0 }, "budget zero"], ["V5", { estBudget: -5 }, "budget negative"],
    ["V6", { estBudget: 1_000_000_001 }, "budget > 1e9"], ["V7", { targetCompletionWeeks: 0 }, "weeks zero"],
    ["V8", { targetCompletionWeeks: 521 }, "weeks 521"], ["V9", { targetCompletionWeeks: 5.5 }, "weeks decimal"],
  ]) {
    r = await cp(over);
    rec(id, `createProject ${note} rejected`, r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  }
  // accepted Unicode/RTL and decimal budget then clean up
  r = await cp({ title: "AUDIT-QA3-rtl-2026-09-18 مشروع برج", estBudget: 100000.55 });
  if (!r.threw) {
    const pid = r.value;
    out.accepted.push({ kind: "rtl-unicode-decimal", id: pid });
    rec("V10", "createProject unicode/RTL + decimal budget accepted", "PASS", { projectId: pid, budget: 100000.55 });
    const del = await call("projects:deleteProject", { projectId: pid });
    rec("V10c", "cleanup unicode project", del.threw ? "FAIL" : "PASS", del.threw ? errText(del) : del.value);
  } else rec("V10", "unicode/RTL title accepted", "FAIL", errText(r));
  r = await cp({ title: "<img src=x onerror=alert(1)> AUDIT-QA3-html-2026-09-18" });
  if (!r.threw) {
    const pid = r.value;
    rec("V11", "createProject HTML title accepted as plain text", "PASS", { projectId: pid });
    const del = await call("projects:deleteProject", { projectId: pid });
    rec("V11c", "cleanup HTML project", del.threw ? "FAIL" : "PASS", del.threw ? errText(del) : del.value);
  } else rec("V11", "HTML title accepted", "FAIL", errText(r));

  // ---------- B. createTradePackage validation ----------
  const basePkg = (over) => call("tradePackages:createTradePackage", {
    projectId: fixture._id, csiDivision: "26 00 00", tradeName: "QA3 Electrical", budgetEstimate: 500000,
    scopeSummary: "QA3 scope", mandatoryInclusions: ["crane"], bidDeadline: "2027-01-15", ...over,
  });
  r = await basePkg({});
  let pkgId = null;
  if (!r.threw) { pkgId = r.value; rec("V12", "createTradePackage valid baseline accepted", "PASS", { pkgId }); }
  else rec("V12", "createTradePackage valid baseline", "FAIL", errText(r));

  for (const [id, over, note] of [
    ["V13", { csiDivision: "26 0 0" }, "CSI bad format"],
    ["V14", { csiDivision: "99 00 00" }, "CSI division 99"],
    ["V15", { tradeName: "   " }, "whitespace trade name"],
    ["V16", { scopeSummary: "" }, "empty scope"],
    ["V17", { budgetEstimate: 0 }, "budget zero"],
    ["V18", { budgetEstimate: -10 }, "budget negative"],
    ["V19", { bidDeadline: "2020-01-01" }, "deadline in past"],
    ["V20", { bidDeadline: "09/30/2027" }, "deadline bad format"],
    ["V21", { tradeName: "T".repeat(501) }, "501-char trade name"],
  ]) {
    r = await basePkg(over);
    rec(id, `createTradePackage ${note} rejected`, r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  }
  r = await basePkg({ csiDivision: "26 00 00" });
  rec("V22", "createTradePackage duplicate CSI rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  const countPkgs = (await query("tradePackages:listByProject", { projectId: fixture._id })).value.filter((p) => p.csiDivision === "26 00 00").length;
  rec("V22b", "duplicate attempt did not add a package", countPkgs === 1 ? "PASS" : "FAIL", `count=${countPkgs}`);

  // Unicode RTL trade name accepted, then delete
  r = await basePkg({ csiDivision: "27 00 00", tradeName: "اختبار الاتصالات", scopeSummary: "نطاق الاختبار" });
  if (!r.threw) {
    rec("V23", "createTradePackage unicode/RTL accepted", "PASS", { pkgId: r.value });
    const del = await call("tradePackages:deleteTradePackage", { tradePackageId: r.value });
    rec("V23c", "cleanup RTL package", del.threw ? "FAIL" : "PASS", del.threw ? errText(del) : del.value);
  } else rec("V23", "unicode/RTL trade name accepted", "FAIL", errText(r));

  // Nonexistent (deleted) project id
  const tmp = await cp({ title: TMP });
  if (!tmp.threw) {
    const tmpId = tmp.value;
    await call("projects:deleteProject", { projectId: tmpId });
    r = await basePkg({ projectId: tmpId, csiDivision: "28 00 00", tradeName: "QA3 Orphan Probe" });
    if (r.threw) rec("V24", "createTradePackage with deleted project id rejected", "PASS", errText(r));
    else {
      rec("V24", "createTradePackage with deleted project id rejected", "FAIL", { orphanPackageId: r.value, note: "package inserted for nonexistent project" });
      await call("tradePackages:deleteTradePackage", { tradePackageId: r.value });
    }
  } else rec("V24", "temp project setup", "FAIL", errText(tmp));

  // ---------- C. createContractor ----------
  const baseCon = (over) => call("contractors:createContractor", {
    tradePackageId: pkgId, companyName: "QA3 Valid Electric LLC", contactEmail: "qa3@tradepulse-pro.test",
    phone: "+1 512 555 0000", licenseNumber: "TX-QA3-1", licenseStatus: "Active / Verified",
    sourceUrl: "https://tradepulse-pro.test/qa3", rfqStatus: "discovered", ...over,
  });
  r = await baseCon({ contactEmail: "not-an-email" });
  rec("V25", "createContractor invalid email rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  r = await baseCon({ companyName: "   " });
  rec("V26", "createContractor whitespace name rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : r.value);
  const tmpPkg = await basePkg({ csiDivision: "28 00 00", tradeName: "QA3 Temp Package" });
  if (!tmpPkg.threw) {
    await call("tradePackages:deleteTradePackage", { tradePackageId: tmpPkg.value });
    r = await call("contractors:createContractor", {
      tradePackageId: tmpPkg.value, companyName: "QA3 Deleted Pkg Probe", contactEmail: "deleted-pkg@tradepulse-pro.test",
      licenseNumber: "L", licenseStatus: "Active", sourceUrl: "s", rfqStatus: "discovered",
    });
    rec("V27", "createContractor against deleted package id rejected", r.threw ? "PASS" : "FAIL-ACCEPTED", r.threw ? errText(r) : JSON.stringify(r.value));
  } else rec("V27", "temp package setup", "FAIL", errText(tmpPkg));
  r = await baseCon({ companyName: "QA3 Valid Electric LLC" });
  let contractorId = null;
  if (!r.threw) { contractorId = r.value; rec("V28", "createContractor valid accepted", "PASS", { contractorId }); }
  else rec("V28", "createContractor valid", "FAIL", errText(r));
  r = await baseCon({ licenseNumber: "L".repeat(2000), companyName: "QA3 Long License", contactEmail: "long@tradepulse-pro.test" });
  rec("V28b", "createContractor 2000-char license accepted (unvalidated)", r.threw ? "NOTE-REJECT" : "NOTE-ACCEPTED", r.threw ? errText(r) : JSON.stringify(r.value));
  if (!r.threw) await call("contractors:deleteContractor", { contractorId: r.value });

  // ---------- D. submitDirectBid ----------
  const baseBid = (over) => call("bids:submitDirectBid", {
    tradePackageId: pkgId, contractorId, subcontractorName: "QA3 Valid Electric LLC", baseBidAmount: 480000, ...over,
  });
  r = await baseBid({ baseBidAmount: 0 });
  rec("V29", "submitDirectBid amount 0 rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  r = await baseBid({ baseBidAmount: -100 });
  rec("V30", "submitDirectBid negative rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  r = await baseBid({ baseBidAmount: 500 });
  rec("V31", "submitDirectBid below $1,000 floor rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  r = await baseBid({ baseBidAmount: 3000000 });
  rec("V32", "submitDirectBid above 5x budget ceiling rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  r = await baseBid({ baseBidAmount: 480000.5, identifiedExclusions: [{ description: "firestop", costImpact: 20000, severity: "critical", isWaived: false }], leadTimePenalty: 12000, coiPenalty: 15000, valueEngineeringAlternates: [{ description: "VE-1", costDeduct: 5000, isAccepted: true }], longLeadEquipmentWeeks: 14, coiComplianceStatus: "deficient \" quote" });
  let bidId = null;
  if (!r.threw) { bidId = r.value.bidId; rec("V33", "submitDirectBid valid accepted", "PASS", r.value); }
  else rec("V33", "submitDirectBid valid", "FAIL", errText(r));
  if (bidId) {
    const bids = (await query("bids:listByPackage", { tradePackageId: pkgId })).value.filter((b) => b._id === bidId);
    const b = bids[0];
    const expected = 480000.5 + 20000 + 12000 + 15000 - 5000;
    rec("V33b", "leveled total recomputed correctly", Math.abs(b.leveledTotalCost - expected) < 0.001 ? "PASS" : "FAIL", { stored: b.leveledTotalCost, expected });
    const r2 = await baseBid({ baseBidAmount: 481000 });
    const after = (await query("bids:listByPackage", { tradePackageId: pkgId })).value;
    rec("V34", "double submit upserts one bid (no duplicate)", after.length === 1 && after[0].revisionNumber >= 2 ? "PASS" : "FAIL", { bidCount: after.length, revision: after[0]?.revisionNumber });
  }

  // ---------- E. submitCustomRfi ----------
  const baseRfi = (over) => call("simulation:submitCustomRfi", { tradePackageId: pkgId, contractorId, subject: "QA3 subject", question: "What is the switchgear lead time?", ...over });
  r = await baseRfi({ question: "" });
  rec("V35", "submitCustomRfi empty question rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  r = await baseRfi({ question: "   \n\t  " });
  rec("V36", "submitCustomRfi whitespace question rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  r = await baseRfi({ subject: "S".repeat(201) });
  rec("V37", "submitCustomRfi 201-char subject rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  r = await baseRfi({ question: "Q".repeat(4001) });
  rec("V38", "submitCustomRfi 4001-char question rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  r = await baseRfi({ contractorId: "k179zp8p8ewsfznzcjzg41wq9x8em427" });
  rec("V39", "submitCustomRfi foreign contractor rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  r = await baseRfi({ question: "RTL سؤال: ما هي مدة التسليم؟ <b>bold</b>" });
  if (!r.threw) rec("V40", "submitCustomRfi unicode/RTL/HTML accepted and persisted", "PASS", r.value);
  else rec("V40", "submitCustomRfi valid", "FAIL", errText(r));

  // ---------- F. bid adjustment validation ----------
  if (bidId) {
    r = await call("bids:updateBidLeveling", { bidId, baseBidAmount: 0 });
    rec("V41", "updateBidLeveling base 0 rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
    r = await call("bids:updateBidLeveling", { bidId, leadTimePenalty: -1 });
    rec("V42", "updateBidLeveling negative penalty rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
    r = await call("bids:updateBidAdjustments", { bidId, identifiedExclusions: [{ description: "neg", costImpact: -100000, severity: "minor" }] });
    const after = (await query("bids:listByPackage", { tradePackageId: pkgId })).value.find((b) => b._id === bidId);
    rec("V43", "updateBidAdjustments negative exclusion accepted (credit semantics)", r.threw ? "NOTE-REJECT" : "NOTE-ACCEPTED", r.threw ? errText(r) : { leveled: after?.leveledTotalCost });
  }

  // ---------- G. files ----------
  const uploadUrlRes = await call("files:generateUploadUrl", {});
  if (!uploadUrlRes.threw) {
    const uploadUrl = uploadUrlRes.value;
    const putBytes = async (bytes, mime) => {
      const resp = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": mime }, body: bytes });
      if (!resp.ok) throw new Error(`upload HTTP ${resp.status}`);
      return (await resp.json()).storageId;
    };
    const sidTxt = await putBytes("QA3 plain text payload", "text/plain");
    r = await call("files:saveFileRecord", {
      projectId: fixture._id, tradePackageId: pkgId, storageId: sidTxt, fileName: "qa3-notes.txt",
      fileType: "spec", fileSize: 999999, uploadedBy: "QA3", textContent: "QA3 plain text payload", contentType: "text/plain",
    });
    if (!r.threw) {
      const files = (await query("files:listFilesByPackage", { tradePackageId: pkgId })).value.filter((f) => f._id === r.value);
      rec("V44", "saveFileRecord authoritative size overrides spoofed size", files[0]?.fileSize === 21 ? "PASS" : "FAIL", { storedSize: files[0]?.fileSize, actualBytes: 21, spoofed: 999999 });
      out.accepted.push({ kind: "file", id: r.value });
    } else rec("V44", "saveFileRecord valid txt", "FAIL", errText(r));

    const sidHtml = await putBytes("<html><body><script>alert(1)</script></body></html>", "application/pdf");
    r = await call("files:saveFileRecord", {
      projectId: fixture._id, tradePackageId: pkgId, storageId: sidHtml, fileName: "qa3-drawing.pdf",
      fileType: "blueprint", fileSize: 50, uploadedBy: "QA3", contentType: "application/pdf",
    });
    if (!r.threw) {
      rec("V45", "content-vs-extension: HTML bytes accepted as .pdf", "FINDING", { fileId: r.value, note: "no server-side byte sniffing in saveFileRecord" });
      out.accepted.push({ kind: "file", id: r.value });
      await call("files:deleteFile", { fileId: r.value });
    } else rec("V45", "content-vs-extension byte sniff", "PASS-REJECTED", errText(r));

    r = await call("files:saveFileRecord", {
      projectId: fixture._id, storageId: sidTxt, fileName: "qa3-plan.pdf", fileType: "spec",
      fileSize: 10, uploadedBy: "QA3", contentType: "text/plain",
    });
    rec("V46", "content-type mismatch .pdf vs text/plain rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
    r = await call("files:saveFileRecord", {
      projectId: fixture._id, storageId: sidTxt, fileName: "malware.exe", fileType: "spec",
      fileSize: 10, uploadedBy: "QA3",
    });
    rec("V47", "unsupported extension .exe rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
    r = await call("files:saveFileRecord", {
      projectId: fixture._id, storageId: sidTxt, fileName: "..\\..\\evil.pdf", fileType: "spec",
      fileSize: 10, uploadedBy: "QA3",
    });
    rec("V48", "path traversal file name rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
    r = await call("files:saveFileRecord", {
      projectId: fixture._id, storageId: "http://evil.example/remote.pdf", fileName: "remote.pdf", fileType: "spec",
      fileSize: 10, uploadedBy: "QA3",
    });
    rec("V49", "http storageId rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
    r = await call("files:saveFileRecord", {
      projectId: fixture._id, storageId: "kg2nonexistentstorageid", fileName: "ghost.pdf", fileType: "spec",
      fileSize: 10, uploadedBy: "QA3",
    });
    rec("V50", "nonexistent storageId rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
    r = await call("files:saveFileRecord", {
      projectId: fixture._id, tradePackageId: "k17c5yx616xbye2sz9cfy1f22d8ekr0f", storageId: sidTxt, fileName: "qa3-cross.pdf", fileType: "spec",
      fileSize: 10, uploadedBy: "QA3",
    });
    rec("V51", "file package foreign to project rejected", r.threw ? "PASS" : "FAIL", r.threw ? errText(r) : JSON.stringify(r.value));
  } else rec("V44", "generateUploadUrl", "FAIL", errText(uploadUrlRes));

  // ---------- H. crons ----------
  const cronStatus = await query("crons:getCronStatus", {});
  rec("V52", "cron status query returns 2 scheduled jobs", cronStatus.value?.activeCrons?.length === 2 ? "PASS" : "FAIL", cronStatus.value);
  const demoPkgBefore = (await query("tradePackages:listByProject", { projectId: "jx7emzjxc9q9ckdrb0pnjd90zd8ejz06" })).value.map((p) => `${p._id}:${p.status}`);
  const live = await call("crons:runDeadlineMonitorNow", { projectId: fixture._id });
  const live2 = await call("crons:runDeadlineMonitorNow", { projectId: fixture._id });
  rec("V53", "runDeadlineMonitorNow scoped + idempotent state", live.value?.transitionedCount === 0 && live2.value?.transitionedCount === 0 ? "PASS" : "NOTE", { first: live.value, second: live2.value });
  const demoPkgAfter = (await query("tradePackages:listByProject", { projectId: "jx7emzjxc9q9ckdrb0pnjd90zd8ejz06" })).value.map((p) => `${p._id}:${p.status}`);
  rec("V54", "cron run did not touch demo project state", JSON.stringify(demoPkgBefore) === JSON.stringify(demoPkgAfter) ? "PASS" : "FAIL", { before: demoPkgBefore, after: demoPkgAfter });
  const ca = await call("crons:runComplianceAuditNow", { projectId: fixture._id });
  rec("V55", "runComplianceAuditNow scoped to fixture", ca.value?.success === true ? "PASS" : "FAIL", ca.value);

  // read-back final fixture state
  const finalPkgs = (await query("tradePackages:listByProject", { projectId: fixture._id })).value;
  const convoList = [];
  for (const p of finalPkgs) {
    const cs = await query("rfq:listConversations", { tradePackageId: p._id });
    if (!cs.threw) for (const x of cs.value) convoList.push({ pkg: p.csiDivision, id: x._id, status: x.status, q: x.inboundQuestion?.slice(0, 80) });
  }
  out.finalState = {
    packages: finalPkgs.map((p) => ({ id: p._id, csi: p.csiDivision, status: p.status })),
    contractors: (await query("contractors:listByProject", { projectId: fixture._id })).value.map((c) => ({ id: c._id, name: c.companyName, email: c.contactEmail })),
    bids: (await query("bids:listAllProjectBids", { projectId: fixture._id })).value.map((b) => ({ id: b._id, base: b.baseBidAmount, leveled: b.leveledTotalCost, rev: b.revisionNumber, coi: b.coiComplianceStatus })),
    conversations: convoList,
    files: (await query("files:listFilesByProject", { projectId: fixture._id })).value.map((f) => ({ id: f._id, name: f.fileName, type: f.fileType, size: f.fileSize })),
  };

  writeJson("fix4-qa3-02-validation.json", out);
  writeLog("fix4-qa3-02-validation.log", results.map((x) => `${x.outcome} ${x.id} ${x.label} :: ${typeof x.detail === "string" ? x.detail : JSON.stringify(x.detail)}`));
  const fails = results.filter((x) => x.outcome === "FAIL");
  console.log(`\nDONE fixture=${fixture._id} total=${results.length} fails=${fails.length} findings=${results.filter((x) => x.outcome === "FINDING").length}`);
};
run().catch((e) => { console.error("ERR", e && e.stack ? e.stack : e); process.exit(1); });