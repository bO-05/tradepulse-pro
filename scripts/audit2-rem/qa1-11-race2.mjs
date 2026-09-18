import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, writeLog, delay,
} from "./lib.mjs";
import {
  findButton, findHandles, realClick, realClickInCard, clickConfirm, selectProject, clickTab,
  waitForText, dismissTour, getToast,
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
    const projects = await q(() => http.query("projects:listProjects", {}));
    const proj = projects.find((p) => p.title === TITLE);
    const pkgs = await q(() => http.query("tradePackages:listByProject", { projectId: proj._id }));
    const pkg = pkgs.find((p) => p.tradeName === PKG_NAME);
    const snap = async () => ({
      bids: (await q(() => http.query("bids:listAllProjectBids", { projectId: proj._id }))).map((b) => ({ id: b._id, sub: b.subcontractorName, awarded: b.isAwarded })),
      agreements: (await q(() => http.query("agreements:listAgreements", { projectId: proj._id }))).map((a) => ({ id: a._id, num: a.agreementNumber, status: a.status, bid: a.bidId, sub: a.subcontractorName })),
      contractors: (await q(() => http.query("contractors:listByPackage", { tradePackageId: pkg._id }))).map((c) => ({ id: c._id, name: c.companyName })),
    });
    R.start = await snap();
    L("start " + JSON.stringify({ agrs: R.start.agreements, cons: R.start.contractors.map((c) => c.name) }));

    // ---------- 1) Backend cascade: delete contractor owning the EXECUTED agreement
    const executed = R.start.agreements.find((a) => a.status === "executed");
    const owner = executed ? R.start.contractors.find((c) => c.name === executed.sub) : null;
    R.executedBefore = executed;
    R.owner = owner;
    if (executed && owner) {
      R.deleteContractorResult = await q(() => http.mutation("contractors:deleteContractor", { contractorId: owner.id })).catch((e) => ({ error: String(e).slice(0, 200) }));
      await delay(2500);
      const after = await q(() => http.query("agreements:listAgreements", { projectId: proj._id }));
      R.executedAgreementAfterCascadeDelete = after.filter((a) => a.num === executed.num).map((a) => ({ num: a.num, status: a.status }))[0] || null;
      R.bidAfterCascadeDelete = (await q(() => http.query("bids:listAllProjectBids", { projectId: proj._id }))).filter((b) => b._id === executed.bid).length;
      L("cascade delete executed agreement result: " + JSON.stringify({ agreement: R.executedAgreementAfterCascadeDelete, bidRemaining: R.bidAfterCascadeDelete }));
    }

    // ---------- 2) Two-tab delete race on remaining bid "decimal co"
    const ready = async (p) => { await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 }); await waitForAppReady(p); await dismissTour(p); await selectProject(p, TITLE); await delay(2500); await dismissTour(p); await clickTab(p, "04:"); await delay(1800); await dismissTour(p); };
    await ready(page);
    await ready(page2);
    // reset any viewer
    for (const p of [page, page2]) { const cv = await findButton(p, "Close Viewer", { exact: true }); if (cv) { await realClick(p, cv); await delay(400); } }

    const delHandle = async (p) => {
      const h = await p.evaluateHandle(() => {
        const btns = [...document.querySelectorAll('button[title="Delete proposal"]')];
        for (const b of btns) {
          let el = b.parentElement;
          for (let i = 0; i < 8 && el; i++) {
            const lines = (el.innerText || "").split("\n").map((s) => s.trim());
            if (lines.includes("decimal co") && (el.innerText || "").length < 2600) return b;
            if (el.tagName === "MAIN" || el.tagName === "BODY") break;
            el = el.parentElement;
          }
        }
        return null;
      });
      return h.asElement();
    };
    const d1 = await delHandle(page);
    const d2 = await delHandle(page2);
    R.deleteButtons = [!!d1, !!d2];
    if (d1 && d2) {
      // click delete in both tabs, then confirm in both nearly simultaneously
      await d1.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await d2.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await delay(200);
      await d1.click();
      await delay(200);
      await d2.click();
      await delay(600);
      const c1 = await clickConfirm(page, "Delete proposal");
      const c2 = await clickConfirm(page2, "Delete proposal");
      R.deleteConfirmClicks = [c1.ok, c2.ok];
      await delay(4500);
      R.deleteToasts = [await getToast(page), await getToast(page2)];
    }
    let s = await snap();
    R.afterDeleteRace = { bids: s.bids.map((b) => b.sub), agreements: s.agreements.length };
    L("delete race: " + JSON.stringify(R.afterDeleteRace));

    // ---------- 3) Two-tab double-click dispatch race
    const countDispatched = async () => (await q(() => http.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 200 }))).filter((l) => l.eventType === "rfq_dispatched").length;
    await clickTab(page, "01:");
    await delay(1500);
    await clickTab(page2, "01:");
    await delay(1500);
    R.dispatchBefore = await countDispatched();
    const b1 = await realClickInCard(page, PKG_NAME, "Dispatch RFQs");
    const b2 = await realClickInCard(page2, PKG_NAME, "Dispatch RFQs");
    await delay(1500);
    const b3 = await realClickInCard(page, PKG_NAME, "Dispatch RFQs");
    await delay(6000);
    R.dispatchRace = { clicks: [b1.ok, b2.ok, b3.ok], before: R.dispatchBefore, after: await countDispatched(), toast1: await getToast(page), toast2: await getToast(page2) };
    L("dispatch race: " + JSON.stringify(R.dispatchRace));
    await shot(page, "fix4-qa1-race2-01-dispatch.png", { full: true });

    // verify package/contractor state idempotence
    const cons = await q(() => http.query("contractors:listByPackage", { tradePackageId: pkg._id }));
    R.contractorStatusesAfterDispatch = cons.map((c) => ({ name: c.companyName, status: c.rfqStatus }));

    R.consoleErrors = diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 200)).slice(0, 12);
    R.pageErrors = diag.pageErrors.slice(0, 8);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    await shot(page, "fix4-qa1-race2-error.png", { full: true }).catch(() => {});
  } finally {
    await browser.close();
    writeJson("fix4-qa1-race2.json", R);
    writeLog("fix4-qa1-race2.log", log);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 12000));
};
run();