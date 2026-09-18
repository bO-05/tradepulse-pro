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

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const page2 = await browser.newPage();
  const diag = attachDiagnostics(page);
  const diag2 = attachDiagnostics(page2);
  try {
    const ready = async (p) => { await p.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 }); await waitForAppReady(p); await dismissTour(p); await selectProject(p, TITLE); await delay(2500); await dismissTour(p); };
    await ready(page);
    await ready(page2);

    const projects = await q(() => http.query("projects:listProjects", {}));
    const proj = projects.find((p) => p.title === TITLE);
    const pkgs = await q(() => http.query("tradePackages:listByProject", { projectId: proj._id }));
    const pkg = pkgs.find((p) => p.tradeName === PKG_NAME);
    const snap = async () => ({
      bids: (await q(() => http.query("bids:listAllProjectBids", { projectId: proj._id }))).map((b) => ({ id: b._id, sub: b.subcontractorName, awarded: b.isAwarded, rev: b.revisionNumber, base: b.baseBidAmount, cid: b.contractorId })),
      agreements: (await q(() => http.query("agreements:listAgreements", { projectId: proj._id }))).map((a) => ({ id: a._id, num: a.agreementNumber, status: a.status, bid: a.bidId, sub: a.subcontractorName })),
      contractors: (await q(() => http.query("contractors:listByPackage", { tradePackageId: pkg._id }))).map((c) => ({ id: c._id, name: c.companyName, status: c.rfqStatus })),
    });
    R.start = await snap();
    L("start state saved");

    // ---------- PART 1: execute the generated agreement for bid "A" via Contracts tab
    await clickTab(page, "06:");
    await delay(2200);
    await dismissTour(page);
    R.executeClick = await realClickText(page, "Record Execution Status");
    await waitForText(page, "Record external execution?", 8000);
    R.executeConfirm = await clickConfirm(page, "Record execution");
    await delay(3200);
    R.executeToast = await getToast(page);
    let s = await snap();
    R.afterExecute = s;
    L("executed: " + JSON.stringify(s.agreements));

    // ---------- PART 2: delete the contractor that owns the EXECUTED agreement
    await clickTab(page, "02:");
    await delay(2500);
    await dismissTour(page);
    const delHandle = await page.evaluateHandle(() => {
      const btns = [...document.querySelectorAll('button[title="Delete contractor"]')];
      for (const b of btns) {
        let p = b.parentElement;
        for (let i = 0; i < 8 && p; i++) {
          const it = p.innerText || "";
          if (it.split("\n").some((line) => line.trim() === "A") && it.length < 2600) return b;
          if (p.tagName === "MAIN" || p.tagName === "BODY") break;
          p = p.parentElement;
        }
      }
      return null;
    });
    const delEl = delHandle.asElement();
    R.contractorDeleteFound = !!delEl;
    if (delEl) {
      await shot(page, "fix4-qa1-rf-01-discovery.png", { full: true });
      R.contractorDeleteClick = await realClick(page, { handle: delEl, meta: { title: "Delete contractor" } });
      const dlg = await waitForText(page, "Remove contractor?", 6000);
      R.contractorDeleteDialog = dlg;
      if (dlg) {
        R.contractorDeleteConfirm = await clickConfirm(page, "Remove contractor");
        await delay(3500);
        R.contractorDeleteToast = await getToast(page);
      }
    }
    s = await snap();
    R.afterContractorDelete = s;
    R.executedAgreementSurvived = s.agreements.some((a) => a.num === "A401-2026-2600-7436");
    L("after contractor delete: " + JSON.stringify({ agrs: s.agreements, cids: s.contractors.map((c) => c.name) }));

    // ---------- PART 3: two-tab award race
    const targets1 = ["AU"];
    const targets2 = ["Apex Electric"];
    await clickTab(page, "04:");
    await delay(1800);
    await clickTab(page2, "04:");
    await delay(1800);
    const clickAward = async (p, sub) => {
      const btn = await p.evaluateHandle((name) => {
        const btns = [...document.querySelectorAll("button")];
        for (const b of btns) {
          const t = (b.textContent || "").trim();
          if (!t.includes("Award Subcontract & Generate AIA A401")) continue;
          let el = b.parentElement;
          for (let i = 0; i < 8 && el; i++) {
            const it = el.innerText || "";
            if (it.split("\n").some((line) => line.trim() === name) && it.length < 2600) return b;
            if (el.tagName === "MAIN" || el.tagName === "BODY") break;
            el = el.parentElement;
          }
        }
        return null;
      }, sub);
      const el = btn.asElement();
      if (!el) return { ok: false };
      await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
      await delay(120);
      const box = await el.boundingBox();
      if (!box) return { ok: false };
      await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await delay(90);
      await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return { ok: true };
    };
    R.raceAward1 = await clickAward(page, targets1[0]);
    R.raceAward2 = await clickAward(page2, targets2[0]);
    await delay(7000);
    s = await snap();
    R.afterAwardRace = {
      awardedBids: s.bids.filter((b) => b.awarded).map((b) => b.sub),
      activeAgreements: s.agreements.filter((a) => a.status !== "superseded").map((a) => ({ num: a.num, status: a.status, sub: a.sub, bid: a.bid })),
      allAgreements: s.agreements,
    };
    L("award race: " + JSON.stringify(R.afterAwardRace));
    await shot(page, "fix4-qa1-rf-02-award-race-tab1.png", { full: true });
    await shot(page2, "fix4-qa1-rf-03-award-race-tab2.png", { full: true });
    // close viewers
    for (const p of [page, page2]) {
      const cv = await findButton(p, "Close Viewer", { exact: true });
      if (cv) { await realClick(p, cv); await delay(500); }
    }

    // ---------- PART 4: refresh mid-flight during bid ingestion
    await clickTab(page, "04:");
    await delay(1500);
    const openBtn = await findButton(page, "Ingest Quote / PDF");
    await realClick(page, openBtn);
    await waitForText(page, "Direct Quote / PDF Bid Ingestion", 10000);
    await delay(300);
    const nameField = await findField(page, "Enter Subcontractor Company Name");
    if (nameField) await typeInto(page, nameField, "Refresh QA1 Co");
    const area = await findField(page, "Paste raw text or PDF transcript");
    await area.handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const abox = await area.handle.boundingBox();
    await page.mouse.click(abox.x + abox.width / 2, abox.y + 30);
    await page.keyboard.type(`PROPOSAL AND QUOTATION\nSubcontractor: Refresh QA1 Co\nBase Bid Price: $905,000.00\nSCOPE INCLUSIONS (100% COMPLETE):\n- All scope INCLUDED\nLead time: 9 weeks.\nInsurance: Fully compliant ACORD 25 with $5M Umbrella.`);
    await delay(200);
    const submit = await findButton(page, "Extract & Level Bid");
    await realClick(page, submit);
    R.refreshIngestSubmitMs = Date.now();
    await delay(2200);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(45000);
    s = await snap();
    R.refreshIngest = {
      hasBid: s.bids.some((b) => b.sub.includes("Refresh")),
      bid: s.bids.find((b) => b.sub.includes("Refresh")) || null,
      hasContractor: s.contractors.some((c) => c.name === "Refresh QA1 Co"),
      contractor: s.contractors.find((c) => c.name === "Refresh QA1 Co") || null,
      bidCount: s.bids.length,
    };
    L("refresh ingest: " + JSON.stringify(R.refreshIngest));

    // ---------- PART 5: refresh mid-flight during RFI submission
    await clickTab(page, "03:");
    await delay(2500);
    await dismissTour(page);
    const subj = await findField(page, "e.g. Hoisting responsibility for switchgear");
    const question = await findField(page, "Ask a technical or scope coordination question");
    if (subj && question) {
      await typeInto(page, subj, "QA1 refresh-midflight RFI");
      await typeInto(page, question, "Does the Division 26 scope include the rooftop switchgear crane hoisting and street closure permits, and are seismic bracing calculations part of this package?");
      const submitRfi = await findButton(page, "Submit RFI for Clarification");
      R.rfiSubmit = await realClick(page, submitRfi);
      await delay(2500);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForAppReady(page);
      await delay(50000);
      const convos = await q(() => http.query("rfq:listConversations", { tradePackageId: pkg._id }));
      R.refreshRfi = {
        found: convos.filter((c) => c.inboundSubject && c.inboundSubject.includes("refresh-midflight")).map((c) => ({ id: c._id, status: c.status, error: c.analysisError || null, hasReply: !!c.autonomousReply, replyLen: (c.autonomousReply || "").length })),
        total: convos.length,
      };
      const uiRetry = await page.evaluate(() => /pending analysis|Retry|failed/i.test(document.body.innerText));
      R.refreshRfi.uiShowsRetryOrPending = uiRetry;
    } else {
      R.refreshRfi = { error: "rfi fields not found", subj: !!subj, question: !!question };
    }
    L("refresh rfi: " + JSON.stringify(R.refreshRfi));

    // ---------- PART 6: dispatch double-click across two tabs
    await clickTab(page, "01:");
    await delay(1500);
    await clickTab(page2, "01:");
    await delay(1500);
    const beforeLogs = (await q(() => http.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 100 }))).filter((l) => l.eventType === "rfq_dispatched").length;
    const d1 = await realClickInCard(page, PKG_NAME, "Dispatch RFQs");
    const d2 = await realClickInCard(page2, PKG_NAME, "Dispatch RFQs");
    await delay(2500);
    const d1b = await realClickInCard(page, PKG_NAME, "Dispatch RFQs");
    await delay(5000);
    const logs = await q(() => http.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 200 }));
    R.dispatchRace = {
      clicks: [d1.ok, d2.ok, d1b.ok],
      dispatchedEventsBefore: beforeLogs,
      dispatchedEventsAfter: logs.filter((l) => l.eventType === "rfq_dispatched").length,
      recent: logs.filter((l) => l.eventType === "rfq_dispatched").slice(0, 4).map((l) => ({ title: l.title, at: l.timestamp })),
      toast1: await getToast(page),
      toast2: await getToast(page2),
    };
    L("dispatch race: " + JSON.stringify(R.dispatchRace));
    await shot(page, "fix4-qa1-rf-04-dispatch-race.png", { full: true });

    R.consoleErrors = diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 200)).slice(0, 15);
    R.failedRequests = diag.failedRequests.slice(0, 10);
    R.pageErrors = diag.pageErrors.slice(0, 8);
    R.consoleErrors2 = diag2.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 200)).slice(0, 10);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    await shot(page, "fix4-qa1-rf-error.png", { full: true }).catch(() => {});
  } finally {
    await browser.close();
    writeJson("fix4-qa1-races-refresh.json", R);
    writeLog("fix4-qa1-races-refresh.log", log);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 18000));
};
run();