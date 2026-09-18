import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, writeLog, delay,
} from "./lib.mjs";
import {
  findButton, findField, findHandles, realClick, realClickText, realClickInCard, clickConfirm,
  selectProject, clickTab, waitForText, dismissTour, getToast, typeInto,
} from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const TITLE = "AUDIT-QA1-BIDS-2026-09-18";
const PKG_NAME = "AUDIT-QA1 Electrical";
const R = { startedAt: new Date().toISOString() };
const log = [];
const L = (m) => { log.push(`[${new Date().toISOString()}] ${m}`); console.log(m); };
const q = async (fn, tries = 6) => { let last; for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; await delay(1500); } } throw last; };

const closeViewer = async (page) => {
  for (const label of ["Close Viewer", "Close"]) {
    const b = await findButton(page, label, { exact: true });
    if (b) { await realClick(page, b); await delay(800); return label; }
  }
  await page.keyboard.press("Escape");
  await delay(500);
  return null;
};

const snap = async (projId) => ({
  bids: (await q(() => http.query("bids:listAllProjectBids", { projectId: projId }))).map((b) => ({ id: b._id, sub: b.subcontractorName, base: b.baseBidAmount, leveled: b.leveledTotalCost, awarded: b.isAwarded, rev: b.revisionNumber })),
  agreements: (await q(() => http.query("agreements:listAgreements", { projectId: projId }))).map((a) => ({ id: a._id, num: a.agreementNumber, status: a.status, sum: a.contractSum, bid: a.bidId, sub: a.subcontractorName, executedAt: a.executedAt || null })),
});

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
    const before = await snap(proj._id);
    const target = before.bids.find((b) => b.sub === "AU");
    R.before = { target, agreements: before.agreements };
    L("target: " + JSON.stringify(target));

    // Reset: if a prior run left the target awarded (generated agreement), un-award first
    if (target && target.awarded) {
      R.resetUnaward = await realClickInCard(page, "AU", "Unaward");
      await waitForText(page, "Unaward proposal?", 8000);
      R.resetConfirm = await clickConfirm(page, "Unaward proposal");
      await delay(3000);
      R.resetToast = await getToast(page);
    }

    // 1) Award
    R.award = await realClickInCard(page, "AU", "Award Subcontract & Generate AIA A401");
    await delay(4500);
    R.awardToast = await getToast(page);
    R.awardViewer = await closeViewer(page);
    let s = await snap(proj._id);
    R.afterAward = s;
    R.contractVsBid = s.agreements[0] ? { contractSum: s.agreements[0].sum, bidLeveled: target.leveled, match: s.agreements[0].sum === target.leveled } : null;
    await shot(page, "fix4-qa1-lc-01-awarded.png", { full: true });

    // 2) Unaward
    R.unaward = await realClickInCard(page, "AU", "Unaward");
    await waitForText(page, "Unaward proposal?", 8000);
    R.unawardConfirm = await clickConfirm(page, "Unaward proposal");
    await delay(3500);
    R.unawardToast = await getToast(page);
    s = await snap(proj._id);
    R.afterUnaward = s;

    // 3) Re-award
    R.reaward = await realClickInCard(page, "AU", "Award Subcontract & Generate AIA A401");
    await delay(4500);
    R.reawardToast = await getToast(page);
    R.reawardViewer = await closeViewer(page);
    s = await snap(proj._id);
    R.afterReaward = s;
    await shot(page, "fix4-qa1-lc-02-reawarded.png", { full: true });

    // 4) Execute from Contracts tab
    await clickTab(page, "06:");
    await delay(2200);
    await dismissTour(page);
    R.execute = await realClickText(page, "Record Execution Status");
    await waitForText(page, "Record external execution?", 8000);
    R.executeConfirm = await clickConfirm(page, "Record execution");
    await delay(3500);
    R.executeToast = await getToast(page);
    s = await snap(proj._id);
    R.afterExecute = s;
    await shot(page, "fix4-qa1-lc-03-executed.png", { full: true });

    // 5) Unaward executed (expect blocked)
    await clickTab(page, "04:");
    await delay(2200);
    await closeViewer(page);
    R.unawardExecuted = await realClickInCard(page, "AU", "Unaward");
    if (R.unawardExecuted.ok) {
      const hasDlg = await waitForText(page, "Unaward proposal?", 6000);
      R.unawardExecutedDialog = hasDlg;
      if (hasDlg) {
        R.unawardExecutedConfirm = await clickConfirm(page, "Unaward proposal");
        await delay(3200);
        R.unawardExecutedToast = await getToast(page);
      }
    }
    s = await snap(proj._id);
    R.afterUnawardExecuted = s;
    await shot(page, "fix4-qa1-lc-04-unaward-executed.png", { full: true });

    // 6) Delete executed bid (expect blocked)
    const delHandle = await page.evaluateHandle((ct) => {
      const btns = [...document.querySelectorAll('button[title="Delete Bid Proposal"]')];
      for (const b of btns) {
        let p = b.parentElement;
        for (let i = 0; i < 8 && p; i++) {
          const it = p.innerText || "";
          if (it.includes(ct) && it.length < 3000) return b;
          if (p.tagName === "MAIN" || p.tagName === "BODY") break;
          p = p.parentElement;
        }
      }
      return null;
    }, "AU");
    const delEl = delHandle.asElement();
    if (delEl) {
      R.deleteExecuted = await realClick(page, { handle: delEl, meta: { title: "Delete Bid Proposal" } });
      const hasDlg = await waitForText(page, "Delete proposal?", 6000);
      R.deleteExecutedDialog = hasDlg;
      if (hasDlg) {
        R.deleteExecutedConfirm = await clickConfirm(page, "Delete proposal");
        await delay(3000);
        R.deleteExecutedToast = await getToast(page);
      }
    }
    s = await snap(proj._id);
    R.afterDeleteExecuted = s;

    // 7) Award a DIFFERENT bid while an executed agreement exists
    R.awardOther = await realClickInCard(page, "Apex Electric", "Award Subcontract & Generate AIA A401");
    await delay(4500);
    R.awardOtherToast = await getToast(page);
    s = await snap(proj._id);
    R.afterAwardOther = {
      agreements: s.agreements,
      bids: s.bids,
      nonSuperseded: s.agreements.filter((a) => a.status !== "superseded").length,
    };
    L("award other: " + JSON.stringify(R.afterAwardOther));
    await shot(page, "fix4-qa1-lc-05-award-other-post-execute.png", { full: true });

    // 8) Try revising the executed bid via ingest after it lost the award flag
    await closeViewer(page);
    const openBtn = await findButton(page, "Ingest Quote / PDF");
    await realClick(page, openBtn);
    await waitForText(page, "Direct Quote / PDF Bid Ingestion", 10000);
    await delay(300);
    const area = await findField(page, "Paste raw text or PDF transcript");
    const bx = await area.handle.boundingBox();
    await page.mouse.click(bx.x + bx.width / 2, bx.y + 40);
    await page.keyboard.type(`PROPOSAL AND QUOTATION\nSubcontractor: AUDIT QA1 Beacon Power Systems\nBase Bid Price: $1,101,000.00\nSCOPE INCLUSIONS (100% COMPLETE):\n- All scope INCLUDED\nLead time: 8 weeks.\nInsurance: Fully compliant ACORD 25 with $5M Umbrella.`);
    await delay(300);
    const selHandles = await findHandles(page, "select", (m) => m.visible && m.text.includes("Select Registered"), null);
    if (selHandles[0]) {
      const val = await selHandles[0].handle.evaluate((el) => {
        const o = [...el.options].find((x) => x.textContent.includes("Beacon Power Systems"));
        return o ? o.value : null;
      });
      if (val) await selHandles[0].handle.select(val);
    }
    await delay(300);
    const submit = await findButton(page, "Extract & Level Bid");
    await realClick(page, submit);
    let outcome = "timeout";
    let errText = null;
    for (let i = 0; i < 90; i++) {
      await delay(1500);
      const st = await page.evaluate(() => {
        const t = document.body.innerText;
        return { modal: t.includes("Direct Quote / PDF Bid Ingestion"), err: (t.match(/Bid ingestion failed:([^\n]{0,300})/) || [])[1] || null };
      });
      if (st.err) { outcome = "error"; errText = st.err.trim(); break; }
      if (!st.modal) { outcome = "closed"; break; }
    }
    R.revisePostExecute = { outcome, errText };
    await delay(2500);
    s = await snap(proj._id);
    R.afterRevisePostExecute = s;
    R.consoleErrors = diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 220)).slice(0, 12);
    R.pageErrors = diag.pageErrors.slice(0, 6);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    await shot(page, "fix4-qa1-lc-error.png", { full: true }).catch(() => {});
  } finally {
    await browser.close();
    writeJson("fix4-qa1-lifecycle2.json", R);
    writeLog("fix4-qa1-lifecycle2.log", log);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 20000));
};
run();