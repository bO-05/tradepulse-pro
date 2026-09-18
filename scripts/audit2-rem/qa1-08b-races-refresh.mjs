import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, writeLog, delay,
} from "./lib.mjs";
import {
  findButton, findField, findHandles, realClick, realClickText, realClickInCard, clickConfirm,
  selectProject, clickTab, waitForText, dismissTour, getToast, typeInto,
} from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const BASE = "https://brainy-skunk-440.convex.site/";
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
  try {
    const ready = async (p) => { await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 }); await waitForAppReady(p); await dismissTour(p); await selectProject(p, TITLE); await delay(2500); await dismissTour(p); };
    await ready(page);

    const projects = await q(() => http.query("projects:listProjects", {}));
    const proj = projects.find((p) => p.title === TITLE);
    const pkgs = await q(() => http.query("tradePackages:listByProject", { projectId: proj._id }));
    const pkg = pkgs.find((p) => p.tradeName === PKG_NAME);
    const snap = async () => ({
      bids: (await q(() => http.query("bids:listAllProjectBids", { projectId: proj._id }))).map((b) => ({ id: b._id, sub: b.subcontractorName, awarded: b.isAwarded, cid: b.contractorId })),
      agreements: (await q(() => http.query("agreements:listAgreements", { projectId: proj._id }))).map((a) => ({ id: a._id, num: a.agreementNumber, status: a.status, bid: a.bidId, sub: a.subcontractorName })),
      contractors: (await q(() => http.query("contractors:listByPackage", { tradePackageId: pkg._id }))).map((c) => ({ id: c._id, name: c.companyName })),
    });
    R.start = await snap();
    L("start " + JSON.stringify({ agrs: R.start.agreements, bids: R.start.bids.map((b) => b.sub), cons: R.start.contractors.map((c) => c.name) }));

    // ---------- Recreate: award "A" -> execute -> delete contractor A
    await clickTab(page, "04:");
    await delay(2000);
    await dismissTour(page);
    R.awardA = await realClickInCard(page, "A", "Award Subcontract & Generate AIA A401");
    R.awardAByFind = R.awardA;
    if (!R.awardA.ok) {
      // "A" card title also matches many; use exact-name card search
      const h = await page.evaluateHandle(() => {
        const btns = [...document.querySelectorAll("button")];
        for (const b of btns) {
          const t = (b.textContent || "").trim();
          if (!t.includes("Award Subcontract & Generate AIA A401")) continue;
          let el = b.parentElement;
          for (let i = 0; i < 8 && el; i++) {
            const it = el.innerText || "";
            if (it.includes("\nA\n") && it.length < 2600) return b;
            if (el.tagName === "MAIN" || el.tagName === "BODY") break;
            el = el.parentElement;
          }
        }
        return null;
      });
      const el = h.asElement();
      if (el) R.awardA = await realClick(page, { handle: el, meta: { text: "award A" } });
    }
    await delay(4500);
    let cv = await findButton(page, "Close Viewer", { exact: true });
    if (cv) { await realClick(page, cv); await delay(600); }
    let s = await snap();
    R.afterAwardA = s.agreements;
    L("award A: " + JSON.stringify(s.agreements));

    await clickTab(page, "06:");
    await delay(2200);
    R.execA = await realClickText(page, "Record Execution Status");
    await waitForText(page, "Record external execution?", 8000);
    R.execAConfirm = await clickConfirm(page, "Record execution");
    await delay(3200);
    s = await snap();
    R.afterExecA = s.agreements;
    L("exec A: " + JSON.stringify(s.agreements));
    await shot(page, "fix4-qa1-rf2-01-executed.png", { full: true });

    // Discovery: dump card headings next to delete buttons
    await clickTab(page, "02:");
    await delay(2500);
    await dismissTour(page);
    R.discoveryCards = await page.evaluate(() => {
      const out = [];
      for (const b of document.querySelectorAll('button[title="Delete contractor"]')) {
        let el = b.parentElement;
        let card = null;
        for (let i = 0; i < 8 && el; i++) {
          if ((el.innerText || "").length < 2600) card = el;
          if (el.tagName === "MAIN" || el.tagName === "BODY") break;
          el = el.parentElement;
        }
        const leaves = card ? [...card.querySelectorAll("*")].filter((x) => x.childElementCount === 0 && (x.textContent || "").trim()) : [];
        out.push({ hidden: b.offsetParent === null, sample: leaves.slice(0, 14).map((x) => (x.textContent || "").trim().slice(0, 40)) });
      }
      return out;
    });
    R.discoveryCardsBrief = R.discoveryCards.map((c) => c.sample.slice(0, 6));
    await shot(page, "fix4-qa1-rf2-02-discovery-cards.png", { full: true });

    // Delete contractor whose card has a leaf text exactly "A" (contractor A)
    const delH = await page.evaluateHandle(() => {
      const btns = [...document.querySelectorAll('button[title="Delete contractor"]')];
      for (const b of btns) {
        let el = b.parentElement;
        for (let i = 0; i < 8 && el; i++) {
          if ((el.innerText || "").length < 2600) {
            const exact = [...el.querySelectorAll("*")].some((x) => x.childElementCount === 0 && (x.textContent || "").trim() === "A");
            if (exact) return b;
          }
          if (el.tagName === "MAIN" || el.tagName === "BODY") break;
          el = el.parentElement;
        }
      }
      return null;
    });
    const delEl = delH.asElement();
    R.contractorADeleteFound = !!delEl;
    if (delEl) {
      R.contractorADeleteClick = await realClick(page, { handle: delEl, meta: { title: "Delete contractor" } });
      const dlg = await waitForText(page, "Remove contractor?", 6000);
      R.contractorADeleteDialog = dlg;
      if (dlg) {
        R.contractorADeleteConfirm = await clickConfirm(page, "Remove contractor");
        await delay(3500);
        R.contractorADeleteToast = await getToast(page);
      }
    }
    s = await snap();
    R.afterContractorADelete = s;
    R.executedAgreementSurvived = s.agreements.some((a) => a.status === "executed");
    R.executedAgreementPresent = s.agreements.find((a) => a.num === "A401-2026-2600-7436") || null;
    L("after delete A: " + JSON.stringify({ agrs: s.agreements, bids: s.bids.map((b) => b.sub), cons: s.contractors.map((c) => c.name) }));
    await shot(page, "fix4-qa1-rf2-03-after-delete-A.png", { full: true });

    // ---------- Refresh mid-flight ingest
    await clickTab(page, "04:");
    await delay(1600);
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
    R.refreshIngestStartedAt = Date.now();
    await delay(2000);
    try {
      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
      R.reloadOk = true;
    } catch (e) {
      R.reloadOk = false;
      R.reloadError = String(e).slice(0, 150);
      await page.evaluate(() => window.location.reload()).catch(() => {});
      await delay(4000);
    }
    await waitForAppReady(page, 60000).catch(() => {});
    await delay(45000);
    s = await snap();
    R.refreshIngest = {
      hasBid: s.bids.some((b) => b.sub.includes("Refresh")),
      bid: s.bids.find((b) => b.sub.includes("Refresh")) || null,
      hasContractor: s.contractors.some((c) => c.name === "Refresh QA1 Co"),
      contractor: s.contractors.find((c) => c.name === "Refresh QA1 Co") || null,
    };
    L("refresh ingest: " + JSON.stringify(R.refreshIngest));

    // ---------- Refresh mid-flight RFI
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
      await delay(2200);
      try { await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 }); } catch { await page.evaluate(() => window.location.reload()).catch(() => {}); await delay(4000); }
      await waitForAppReady(page, 60000).catch(() => {});
      await delay(50000);
      const convos = await q(() => http.query("rfq:listConversations", { tradePackageId: pkg._id }));
      R.refreshRfi = {
        found: convos.filter((c) => (c.inboundSubject || "").includes("refresh-midflight")).map((c) => ({ id: c._id, status: c.status, error: c.analysisError || null, replyLen: (c.autonomousReply || "").length })),
        total: convos.length,
        otherStatuses: convos.slice(0, 5).map((c) => c.status),
      };
      await shot(page, "fix4-qa1-rf2-04-rfi-after-refresh.png", { full: true });
    } else {
      R.refreshRfi = { error: "fields not found" };
    }
    L("refresh rfi: " + JSON.stringify(R.refreshRfi));

    // ---------- Dispatch double-click across two tabs
    await ready(page2).catch((e) => { R.p2ReadyErr = String(e).slice(0, 120); });
    await clickTab(page, "01:");
    await delay(1500);
    await clickTab(page2, "01:").catch(() => {});
    await delay(1500);
    const countDispatched = async () => (await q(() => http.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 200 }))).filter((l) => l.eventType === "rfq_dispatched").length;
    R.dispatchBefore = await countDispatched();
    const d1 = await realClickInCard(page, PKG_NAME, "Dispatch RFQs");
    const d2 = await realClickInCard(page2, PKG_NAME, "Dispatch RFQs");
    await delay(1800);
    const d3 = await realClickInCard(page, PKG_NAME, "Dispatch RFQs");
    await delay(6000);
    R.dispatchRace = {
      clicks: [d1.ok, d2.ok, d3.ok],
      before: R.dispatchBefore,
      after: await countDispatched(),
      toast1: await getToast(page),
      toast2: await getToast(page2),
    };
    L("dispatch race: " + JSON.stringify(R.dispatchRace));
    await shot(page, "fix4-qa1-rf2-05-dispatch.png", { full: true });

    R.consoleErrors = diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 200)).slice(0, 15);
    R.pageErrors = diag.pageErrors.slice(0, 8);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    await shot(page, "fix4-qa1-rf2-error.png", { full: true }).catch(() => {});
  } finally {
    await browser.close();
    writeJson("fix4-qa1-races-refresh2.json", R);
    writeLog("fix4-qa1-races-refresh2.log", log);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 18000));
};
run();