/**
 * QA9 Journey 2: Sub bidder RFI flow — cross-package routing, PM certification,
 * addendum issue+download+inspect, rejection leaves queue, waiver escalation.
 * Evidence: evidence/fix4-qa9-j2-*.json
 */
import fs from "node:fs";
import path from "node:path";
import {
  client, launchBrowser, attachDiagnostics, diagnosticsSummary, waitForAppReady, delay,
  selectProjectByTitle, clickByText, setReactValue, typeInto, shot, writeEvidence, FIXTURE_TAG, EVIDENCE_DIR,
} from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J2-RFI`;
const log = []; const problems = [];
const step = (s) => { log.push(s); console.log("STEP:", s); };

// ---- Fixture setup (delete stale first) ----
for (const p of (await c.query("projects:listProjects", {})).filter((x) => x.title === PROJECT)) {
  try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
}
const projId = await c.mutation("projects:createProject", {
  title: PROJECT, location: "Austin, TX", projectType: "Commercial Office",
  estBudget: 3200000, targetCompletionWeeks: 48, specDocumentText: "QA9 J2 fixture.", isDemoProject: false,
});
const pkgA = await c.mutation("tradePackages:createTradePackage", {
  projectId: projId, csiDivision: "21 00 00", tradeName: "QA9 Fire Suppression",
  budgetEstimate: 480000, scopeSummary: "Wet standpipe and sprinkler systems.",
  mandatoryInclusions: ["Hydraulic calcs", "Backflow certification"],
  bidDeadline: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
});
const pkgB = await c.mutation("tradePackages:createTradePackage", {
  projectId: projId, csiDivision: "26 00 00", tradeName: "QA9 Electrical",
  budgetEstimate: 1250000, scopeSummary: "Switchgear, feeder, emergency power.",
  mandatoryInclusions: ["Seismic bracing", "UL 1479 firestopping"],
  bidDeadline: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
});
await c.mutation("contractors:createContractor", {
  tradePackageId: pkgA, companyName: "QA9 Suppression Co", contactEmail: "bids@qa9-suppress.test",
  phone: "(512) 555-0111", licenseNumber: "TX-QA9-7001", licenseStatus: "Active & Verified",
  sourceUrl: "https://qa9-suppress.test", rfqStatus: "invited",
});
const result = { journey: "J2", project: PROJECT, ids: { projectId: projId, pkgA, pkgB }, steps: log, data: {} };

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
await page.evaluateOnNewDocument(() => {
  window.__qa9OpenedUrls = [];
  const orig = window.open;
  window.open = (url, ...rest) => { window.__qa9OpenedUrls.push(String(url)); return null; };
  void orig;
});

async function conversations(pkgId) {
  return await c.query("rfq:listConversations", { tradePackageId: pkgId });
}
async function waitConvo(pkgId, subject, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const list = await conversations(pkgId).catch(() => []);
    const hit = list.find((x) => x.inboundSubject === subject);
    if (hit && !["pending_analysis"].includes(hit.status) && (!hit.autonomousReply || hit.status !== "pending_analysis")) {
      if (hit.status !== "pending_analysis") return hit;
    }
    await delay(3000);
  }
  return null;
}
async function clickInCard(cardText, buttonText) {
  const hit = await page.evaluate((ct, bt) => {
    const cards = [...document.querySelectorAll("div")]
      .filter((d) => [...d.querySelectorAll("button")].some((b) => (b.textContent || "").trim().includes(bt) || (b.getAttribute("title") || "").includes(bt)))
      .filter((d) => (d.textContent || "").includes(ct))
      .sort((a, b) => a.textContent.length - b.textContent.length);
    const card = cards[0];
    if (!card) return { ok: false };
    const b = [...card.querySelectorAll("button")].find((x) => (x.textContent || "").trim().includes(bt) || (x.getAttribute("title") || "").includes(bt));
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, cardHead: card.textContent.slice(0, 80) };
  }, cardText, buttonText);
  if (hit.ok) await page.mouse.click(hit.x, hit.y);
  return hit;
}
async function submitRfi(targetPkgId, subject, question) {
  await page.evaluate((v) => {
    const sel = document.querySelector('select[aria-label="Target trade package for this RFI"]');
    if (!sel) return false;
    sel.value = v;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, targetPkgId);
  await delay(500);
  await typeInto(page, 'input[aria-label="RFI subject or scope topic"]', subject);
  await typeInto(page, 'textarea[aria-label="Subcontractor question"]', question);
  await clickByText(page, "Submit RFI for Clarification", { exact: true });
}

try {
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, PROJECT);
  await delay(1500);
  await page.keyboard.press("Digit3");
  await page.waitForSelector('select[aria-label="Target trade package for this RFI"]', { timeout: 15000 });
  await delay(1200);
  result.data.initialButtons = await page.evaluate(() => [...document.querySelectorAll("main button")].map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 30));

  // ---- RFI 1: cross-package route (target Electrical while Fire active) ----
  await submitRfi(pkgB, "QA9 cross-package route probe", "Confirm the 480V feeder routing for the fire pump controller and whether this is included in Division 26.");
  step("RFI1 submitted (target=Electrical, active=Fire)");
  let convo1 = await waitConvo(pkgB, "QA9 cross-package route probe");
  if (!convo1) { convo1 = await waitConvo(pkgB, "QA9 cross-package route probe", 60000); }
  result.data.rfi1 = convo1 ? { id: convo1._id, status: convo1.status, pkg: convo1.tradePackageId, contractor: convo1.contractorId, reply: (convo1.autonomousReply || "").slice(0, 200), err: convo1.analysisError } : null;
  const convA = await conversations(pkgA);
  result.data.rfi1OnFirePackage = convA.filter((x) => x.inboundSubject === "QA9 cross-package route probe").length;
  step(`RFI1 landed pkg=${convo1?.tradePackageId === pkgB} status=${convo1?.status} onFire=${result.data.rfi1OnFirePackage}`);
  if (!convo1) problems.push({ id: "A9-20", sev: "High", title: "Cross-package RFI never completed analysis", detail: "no conversation on target package after 180s" });
  if (result.data.rfi1OnFirePackage > 0) problems.push({ id: "A9-21", sev: "High", title: "Cross-package RFI misrouted to active package", detail: "subject present on Fire package" });
  const guests = (await c.query("contractors:listByPackage", { tradePackageId: pkgB })).filter((x) => x.companyName.includes("Guest"));
  result.data.guestCreated = guests.length > 0;
  const aGuests = (await c.query("contractors:listByPackage", { tradePackageId: pkgA })).filter((x) => x.companyName.includes("Guest"));
  if (aGuests.length > 0) problems.push({ id: "A9-22", sev: "Medium", title: "Guest contractor created on wrong (active) package", detail: `count=${aGuests.length}` });
  await shot(page, "fix4-qa9-j2-rfi1.png");

  // ---- Activate Electrical package in QnA and certify ----
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("QA9 Electrical"));
    if (b) b.click();
  });
  await delay(1200);
  const approveHit = await clickInCard("QA9 cross-package route probe", "Approve for Addendum");
  result.data.approveClick = approveHit;
  await delay(2500);
  convo1 = (await conversations(pkgB)).find((x) => x.inboundSubject === "QA9 cross-package route probe");
  result.data.certified = Boolean(convo1?.pmCertifiedAt);
  step(`approve click=${approveHit.ok} certified=${result.data.certified}`);
  if (!result.data.certified) problems.push({ id: "A9-23", sev: "High", title: "Approve for Addendum did not certify RFI", detail: `status=${convo1?.status}` });
  await shot(page, "fix4-qa9-j2-certified.png");

  // ---- Issue addendum + download + inspect ----
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button")].find((x) => (x.textContent || "").includes("Issue Legal Addendum"));
    return b && !b.disabled;
  }, { timeout: 15000 }).catch(() => {});
  const issueHit = await clickByText(page, "Issue Legal Addendum", { exact: false });
  await delay(6000);
  const addendum = await page.evaluate(() => ({
    urls: window.__qa9OpenedUrls || [],
    hrefs: [...document.querySelectorAll("a[download], a[href*='/api/storage']")].map((a) => a.getAttribute("href")),
    panelText: document.body.innerText.split("\n").filter((l) => /ADDENDUM|addendum|File|Download/i.test(l)).slice(0, 12).join(" | "),
  }));
  result.data.addendumPanel = addendum.panelText;
  result.data.addendumHrefs = addendum.hrefs;
  const dlBtn = await clickByText(page, "Download Addendum", { exact: false });
  await delay(2500);
  const urls = await page.evaluate(() => window.__qa9OpenedUrls || []);
  result.data.openedUrls = urls;
  result.data.issueClick = issueHit;
  result.data.dlBtnClick = dlBtn;
  step(`issue=${issueHit.ok} openedUrls=${JSON.stringify(urls)} hrefs=${JSON.stringify(result.data.addendumHrefs)}`);
  const dlUrl = urls[0] || result.data.addendumHrefs[0] || null;
  if (dlUrl && !dlUrl.startsWith("blob:")) {
    const res = await fetch(dlUrl).catch(() => null);
    if (res && res.ok) {
      const txt = await res.text();
      result.data.downloadedAddendum = { ok: true, bytes: txt.length, hasSubject: txt.includes("QA9 cross-package route probe"), hasAddendumNo: /ADDENDUM NO\. 01/.test(txt), snippet: txt.split("\n").slice(0, 10).join(" | ") };
      if (!result.data.downloadedAddendum.hasSubject) problems.push({ id: "A9-24", sev: "Medium", title: "Downloaded addendum misses certified RFI content", detail: result.data.downloadedAddendum.snippet });
    } else {
      problems.push({ id: "A9-30", sev: "Medium", title: "Download addendum URL not fetchable", detail: String(dlUrl).slice(0, 160) });
    }
  } else if (!dlUrl) {
    problems.push({ id: "A9-31", sev: "Medium", title: "No addendum download URL exposed after issuing" });
  }
  const files = await c.query("files:listFilesByProject", { projectId: projId });
  const addendumFile = files.find((f) => /ADDENDUM/i.test(f.fileName || ""));
  result.data.addendumFile = addendumFile ? { name: addendumFile.fileName, size: addendumFile.fileSize, type: addendumFile.fileType } : null;
  if (addendumFile) {
    const doc = await c.query("files:getFileText", { fileId: addendumFile._id }).catch(() => null);
    if (doc?.textContent || doc?.text) {
      const txt = doc.textContent || doc.text;
      result.data.addendumHasSubject = txt.includes("QA9 cross-package route probe");
      result.data.addendumSnippet = txt.split("\n").slice(0, 12).join(" | ");
      if (!result.data.addendumHasSubject) problems.push({ id: "A9-24", sev: "Medium", title: "Issued addendum content omits certified RFI", detail: String(txt).slice(0, 200) });
    } else {
      if (urls[0]) {
        const res = await fetch(urls[0]).catch(() => null);
        if (res && res.ok) {
          const txt = await res.text();
          result.data.addendumHasSubject = txt.includes("QA9 cross-package route probe");
          result.data.addendumSnippet = txt.split("\n").slice(0, 12).join(" | ");
        }
      }
    }
  } else {
    problems.push({ id: "A9-25", sev: "Medium", title: "No addendum file record stored in project files", detail: JSON.stringify(files.map((f) => f.fileName)) });
  }
  await shot(page, "fix4-qa9-j2-addendum.png");

  // ---- RFI 2: reject leaves queue ----
  await submitRfi(pkgB, "QA9 rejection probe", "Provide the conduit fill calculations for the 4-inch feeders for review.");
  step("RFI2 submitted");
  let convo2 = await waitConvo(pkgB, "QA9 rejection probe");
  result.data.rfi2 = convo2 ? { id: convo2._id, status: convo2.status } : null;
  const queueBeforeReject = await page.evaluate(() => [...document.querySelectorAll("main button")].map((b) => (b.textContent || "").trim()).filter((t) => t.includes("PM Review Queue") || t.includes("Review PM Queue")));
  result.data.queueBeforeRejectText = queueBeforeReject[0] || null;
  if (convo2) {
    const rej = await clickInCard("QA9 rejection probe", "Reject");
    await delay(2500);
    convo2 = (await conversations(pkgB)).find((x) => x.inboundSubject === "QA9 rejection probe");
    result.data.rejectClick = rej;
    result.data.statusAfterReject = convo2?.status;
    result.data.certifiedAfterReject = Boolean(convo2?.pmCertifiedAt);
    step(`reject click=${rej.ok} status=${convo2?.status}`);
    if (convo2?.status !== "rejected") problems.push({ id: "A9-26", sev: "Medium", title: "Reject RFI did not set status rejected", detail: `status=${convo2?.status}` });
    await delay(800);
    const rejectedStillInQueue = await page.evaluate(() => document.body.innerText.includes("QA9 rejection probe") && document.body.innerText.includes("Reject\n") );
    result.data.rejectedInQueueRender = rejectedStillInQueue;
    const queueAfter = await page.evaluate(() => [...document.querySelectorAll("main button")].map((b) => (b.textContent || "").trim()).filter((t) => t.includes("PM Review Queue") || t.includes("Review PM Queue")));
    result.data.queueAfterRejectText = queueAfter[0] || null;
  } else {
    problems.push({ id: "A9-27", sev: "High", title: "Rejection RFI never completed analysis", detail: "no conversation" });
  }
  await shot(page, "fix4-qa9-j2-rejected.png");

  // ---- RFI 3: waiver escalation ----
  await submitRfi(pkgB, "QA9 waiver escalation probe", "Request a waiver of liquidated damages for late energization due to utility delay.");
  step("RFI3 (waiver) submitted");
  const convo3 = await waitConvo(pkgB, "QA9 waiver escalation probe");
  result.data.rfi3 = convo3 ? { id: convo3._id, status: convo3.status, reply: (convo3.autonomousReply || "").slice(0, 160) } : null;
  step(`RFI3 status=${convo3?.status}`);
  if (!convo3) problems.push({ id: "A9-28", sev: "High", title: "Waiver RFI never completed analysis", detail: "no conversation" });
  else if (convo3.status !== "escalated_to_pm") problems.push({ id: "A9-29", sev: "High", title: "Waiver RFI not escalated to PM queue", detail: `status=${convo3.status}` });
  await delay(1000);
  const pmQueueText = await page.evaluate(() => [...document.querySelectorAll("main button")].map((b) => (b.textContent || "").trim()).filter((t) => t.includes("PM Review Queue") || t.includes("Review PM Queue")));
  result.data.pmQueueFinalText = pmQueueText[0] || null;
  await shot(page, "fix4-qa9-j2-escalated.png");
  result.console = diagnosticsSummary(diag);
} catch (err) {
  problems.push({ id: "A9-90", sev: "High", title: "J2 crashed: " + (err?.message ?? String(err)).split("\n")[0] });
  await shot(page, "fix4-qa9-j2-crash.png").catch(() => {});
} finally {
  result.findings = problems;
  result.verdict = problems.some((p) => p.sev === "High") ? "blocked" : problems.length ? "complete-with-issues" : "complete";
  writeEvidence("j2-rfi", result);
  await browser.close();
}
console.log(`J2 verdict=${result.verdict} findings=${problems.length}`);