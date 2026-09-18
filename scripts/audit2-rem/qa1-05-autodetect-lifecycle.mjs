import fs from "node:fs";
import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, writeLog, delay,
} from "./lib.mjs";
import {
  findButton, findField, findHandles, realClick, realClickText, realClickInCard, clickConfirm,
  typeInto, selectProject, projectOptionState, clickTab, waitForText, dismissTour, getToast,
} from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const TITLE = "AUDIT-QA1-BIDS-2026-09-18";
const PKG_NAME = "AUDIT-QA1 Electrical";
const R = { startedAt: new Date().toISOString() };
const log = [];
const L = (m) => { log.push(`[${new Date().toISOString()}] ${m}`); console.log(m); };
const q = async (fn, tries = 6) => { let last; for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; await delay(1500); } } throw last; };

const modalState = async (page) => page.evaluate(() => {
  const h = [...document.querySelectorAll("h3")].find((x) => x.textContent.includes("Direct Quote / PDF Bid Ingestion"));
  if (!h) return { open: false };
  let root = h;
  for (let i = 0; i < 8 && root.parentElement; i++) { root = root.parentElement; if (root.querySelector("form")) break; }
  const sel = root.querySelector("select");
  const nameInput = [...root.querySelectorAll("input")].find((i) => (i.placeholder || "").includes("Enter Subcontractor Company Name"));
  return {
    open: true,
    selectValue: sel ? sel.value : null,
    selectText: sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].textContent.trim() : null,
    customNameVisible: !!nameInput && nameInput.offsetParent !== null,
    customNameValue: nameInput ? nameInput.value : null,
  };
});

const selectModalContractor = async (page, name) => {
  const handles = await findHandles(page, "select", (m) => m.visible && m.text.includes("Select Registered"), null);
  if (!handles[0]) return { ok: false, reason: "modal select not found" };
  const val = await handles[0].handle.evaluate((el, n) => {
    const o = [...el.options].find((x) => x.textContent.includes(n));
    return o ? o.value : null;
  }, name);
  if (!val) return { ok: false, reason: "contractor option not found" };
  await handles[0].handle.select(val);
  await delay(300);
  return { ok: true, value: val };
};

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await dismissTour(page);
    await selectProject(page, TITLE);
    await delay(2500);
    await dismissTour(page);
    await clickTab(page, "04:");
    await delay(2000);
    await dismissTour(page);

    const projects = await q(() => http.query("projects:listProjects", {}));
    const proj = projects.find((p) => p.title === TITLE);
    const pkgs = await q(() => http.query("tradePackages:listByProject", { projectId: proj._id }));
    const pkg = pkgs.find((p) => p.tradeName === PKG_NAME);
    const cs = await q(() => http.query("contractors:listByPackage", { tradePackageId: pkg._id }));
    R.contractorsBefore = cs.map((c) => ({ id: c._id, name: c.companyName }));
    const beacon = cs.find((c) => c.companyName === "Beacon Power Systems");
    const beforeBids = await q(() => http.query("bids:listAllProjectBids", { projectId: proj._id }));
    const beaconBid = beforeBids.find((b) => b.contractorId === beacon._id);
    R.beaconBidBefore = { id: beaconBid._id, rev: beaconBid.revisionNumber, base: beaconBid.baseBidAmount, sub: beaconBid.subcontractorName };

    // ---------- DEFECT REPRO: auto-detect silently overrides an explicitly selected contractor
    const openBtn = await findButton(page, "Ingest Quote / PDF");
    await realClick(page, openBtn);
    await waitForText(page, "Direct Quote / PDF Bid Ingestion", 10000);
    await delay(400);
    R.modalInitial = await modalState(page);
    const area = await findField(page, "Paste raw text or PDF transcript");
    const c = await (async () => {
      await area.handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const box = await area.handle.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + 40);
      return true;
    })();
    await page.keyboard.type("PROPOSAL AND QUOTATION\nSubcontractor: A", { delay: 15 });
    await delay(400);
    R.afterPartialTyping = await modalState(page);
    await shot(page, "fix4-qa1-05-autodetect-partial.png");
    const rest = `UDIT QA1 Beacon Power Systems\nProject: QA1 Commercial MEP\nBase Bid Price: $1,149,000.00\nSCOPE INCLUSIONS (100% COMPLETE):\n- Crane hoisting to penthouse switchgear room INCLUDED\n- UL 1479 rated firestop penetrations INCLUDED\n- Seismic bracing engineering INCLUDED\nLead time: 12 weeks.\nInsurance: Fully compliant ACORD 25 with $5M Umbrella.`;
    await page.keyboard.type(rest, { delay: 3 });
    await delay(400);
    R.afterFullTyping = await modalState(page);
    await shot(page, "fix4-qa1-05-autodetect-full.png");

    // user notices and re-selects the existing contractor, then submits
    R.reselect = await selectModalContractor(page, "Beacon Power Systems");
    await delay(300);
    R.afterReselect = await modalState(page);
    const submit = await findButton(page, "Extract & Level Bid");
    R.submitClick = await realClick(page, submit);
    let closed = false;
    for (let i = 0; i < 90; i++) {
      await delay(1500);
      const open = await page.evaluate(() => document.body.innerText.includes("Direct Quote / PDF Bid Ingestion"));
      const err = await page.evaluate(() => (document.body.innerText.match(/Bid ingestion failed:([^\n]{0,300})/) || [])[1] || null);
      if (err) { R.submitError = err.trim(); break; }
      if (!open) { closed = true; break; }
    }
    R.submitClosed = closed;
    await delay(2500);
    const midBids = await q(() => http.query("bids:listAllProjectBids", { projectId: proj._id }));
    const beaconAfter = midBids.find((b) => b.contractorId === beacon._id);
    const newBid = midBids.find((b) => !beforeBids.some((x) => x._id === b._id));
    R.afterRevisionAttempt = {
      beaconBid: beaconAfter ? { id: beaconAfter._id, rev: beaconAfter.revisionNumber, base: beaconAfter.baseBidAmount, sub: beaconAfter.subcontractorName } : null,
      newBid: newBid ? { id: newBid._id, sub: newBid.subcontractorName, base: newBid.baseBidAmount, rev: newBid.revisionNumber } : null,
      bidCount: midBids.length,
    };
    L("revision attempt: " + JSON.stringify(R.afterRevisionAttempt));
    await shot(page, "fix4-qa1-05-after-revision-attempt.png", { full: true });

    // ---------- LIFECYCLE using the compliant bid (Beacon / renamed record)
    let bids = await q(() => http.query("bids:listAllProjectBids", { projectId: proj._id }));
    const target = bids.find((b) => b.contractorId === beacon._id);
    const pkgBids = bids.filter((b) => b.tradePackageId === pkg._id);
    R.packageBids = pkgBids.map((b) => ({ id: b._id, sub: b.subcontractorName, base: b.baseBidAmount, leveled: b.leveledTotalCost, awarded: b.isAwarded }));
    const awardCardText = target.subcontractorName;

    R.awardClick = await realClickInCard(page, awardCardText, "Award & AIA A401");
    await delay(3500);
    R.awardToast = await getToast(page);
    let agrs = await q(() => http.query("agreements:listAgreements", { projectId: proj._id }));
    R.afterAward = {
      agreements: agrs.map((a) => ({ id: a._id, num: a.agreementNumber, status: a.status, sum: a.contractSum, bid: a.bidId, sub: a.subcontractorName })),
      bids: (await q(() => http.query("bids:listAllProjectBids", { projectId: proj._id }))).map((b) => ({ id: b._id, sub: b.subcontractorName, awarded: b.isAwarded })),
    };
    await shot(page, "fix4-qa1-05-awarded.png", { full: true });

    // Un-award
    R.unawardClick = await realClickInCard(page, awardCardText, "Unaward");
    await waitForText(page, "Unaward proposal?", 8000);
    R.unawardConfirm = await clickConfirm(page, "Unaward proposal");
    await delay(3000);
    R.unawardToast = await getToast(page);
    agrs = await q(() => http.query("agreements:listAgreements", { projectId: proj._id }));
    R.afterUnaward = { agreements: agrs.map((a) => ({ num: a.agreementNumber, status: a.status })) };

    // Re-award
    R.reawardClick = await realClickInCard(page, awardCardText, "Award & AIA A401");
    await delay(3500);
    agrs = await q(() => http.query("agreements:listAgreements", { projectId: proj._id }));
    R.afterReaward = { agreements: agrs.map((a) => ({ id: a._id, num: a.agreementNumber, status: a.status, sum: a.contractSum })) };
    await shot(page, "fix4-qa1-05-reawarded.png");

    // Execute via contracts tab
    await clickTab(page, "06:");
    await delay(2000);
    await dismissTour(page);
    R.executeClick = await realClickText(page, "Record Execution Status");
    await waitForText(page, "Record external execution?", 8000);
    R.executeConfirm = await clickConfirm(page, "Record execution");
    await delay(3000);
    R.executeToast = await getToast(page);
    agrs = await q(() => http.query("agreements:listAgreements", { projectId: proj._id }));
    R.afterExecute = { agreements: agrs.map((a) => ({ id: a._id, num: a.agreementNumber, status: a.status, sum: a.contractSum, executedAt: a.executedAt || null })) };
    await shot(page, "fix4-qa1-05-executed.png", { full: true });

    // Try unaward the executed bid
    await clickTab(page, "04:");
    await delay(2000);
    R.unawardExecutedClick = await realClickInCard(page, awardCardText, "Unaward");
    if (R.unawardExecutedClick.ok) {
      await waitForText(page, "Unaward proposal?", 8000);
      R.unawardExecutedConfirm = await clickConfirm(page, "Unaward proposal");
      await delay(3000);
      R.unawardExecutedToast = await getToast(page);
    } else {
      R.unawardExecutedToast = "button missing";
    }
    agrs = await q(() => http.query("agreements:listAgreements", { projectId: proj._id }));
    R.afterUnawardExecuted = { agreements: agrs.map((a) => ({ num: a.agreementNumber, status: a.status })), toast: R.unawardExecutedToast };

    // Try awarding a DIFFERENT bid while an executed agreement exists
    const other = pkgBids.find((b) => b._id !== target._id && b.subcontractorName === "Apex Electric");
    R.awardOtherClick = await realClickInCard(page, other.subcontractorName, "Award & AIA A401");
    await delay(4000);
    R.awardOtherToast = await getToast(page);
    agrs = await q(() => http.query("agreements:listAgreements", { projectId: proj._id }));
    const afterOtherBids = await q(() => http.query("bids:listAllProjectBids", { projectId: proj._id }));
    R.afterAwardOther = {
      agreements: agrs.map((a) => ({ num: a.agreementNumber, status: a.status, sub: a.subcontractorName, sum: a.contractSum })),
      bids: afterOtherBids.filter((b) => b.tradePackageId === pkg._id).map((b) => ({ sub: b.subcontractorName, awarded: b.isAwarded })),
      nonSuperseded: agrs.filter((a) => a.status !== "superseded").length,
    };
    L("award other after executed: " + JSON.stringify(R.afterAwardOther));
    await shot(page, "fix4-qa1-05-award-other-after-executed.png", { full: true });

    // Try deleting the executed bid
    const delBtn = await page.evaluateHandle((ct) => {
      const btns = [...document.querySelectorAll('button[title="Delete Bid Proposal"]')];
      for (const b of btns) {
        let p = b;
        for (let i = 0; i < 12 && p; i++) {
          if ((p.innerText || "").includes(ct)) return b;
          p = p.parentElement;
        }
      }
      return null;
    }, awardCardText);
    const delEl = delBtn.asElement();
    if (delEl) {
      R.deleteExecutedClick = await realClick(page, { handle: delEl, meta: { title: "Delete Bid Proposal" } });
      await waitForText(page, "Delete proposal?", 8000);
      R.deleteConfirm = await clickConfirm(page, "Delete proposal");
      await delay(3000);
      R.deleteExecutedToast = await getToast(page);
    } else {
      R.deleteExecutedToast = "delete button not found";
    }
    const finalBids = await q(() => http.query("bids:listAllProjectBids", { projectId: proj._id }));
    R.afterDeleteExecuted = { bidCount: finalBids.length };

    R.consoleErrors = diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 220)).slice(0, 12);
    R.pageErrors = diag.pageErrors.slice(0, 6);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    await shot(page, "fix4-qa1-05-error.png", { full: true }).catch(() => {});
  } finally {
    await browser.close();
    writeJson("fix4-qa1-lifecycle.json", R);
    writeLog("fix4-qa1-lifecycle.log", log);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 18000));
};
run();