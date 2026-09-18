import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, writeLog, delay,
} from "./lib.mjs";
import {
  findButton, findHandles, realClick, realClickInCard, clickConfirm, selectProject, clickTab,
  waitForText, dismissTour, getToast,
} from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const TITLE = "AUDIT-QA1-BIDS-2026-09-18";
const R = { startedAt: new Date().toISOString() };
const log = [];
const L = (m) => { log.push(`[${new Date().toISOString()}] ${m}`); console.log(m); };
const q = async (fn, tries = 6) => { let last; for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; await delay(1500); } } throw last; };
const snap = async (projId) => ({
  bids: (await q(() => http.query("bids:listAllProjectBids", { projectId: projId }))).map((b) => ({ id: b._id, sub: b.subcontractorName, awarded: b.isAwarded, rev: b.revisionNumber, base: b.baseBidAmount })),
  agreements: (await q(() => http.query("agreements:listAgreements", { projectId: projId }))).map((a) => ({ id: a._id, num: a.agreementNumber, status: a.status, bid: a.bidId, sub: a.subcontractorName, sum: a.contractSum })),
});

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const mutations = [];
  page.on("response", (res) => {
    const u = res.url();
    if (u.includes("/api/mutation") || u.includes("convex.cloud")) {
      if (res.status() >= 400) mutations.push({ url: u.slice(0, 140), status: res.status() });
    }
  });
  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await dismissTour(page);
    await selectProject(page, TITLE);
    await delay(2500);
    await dismissTour(page);
    await clickTab(page, "04:");
    await delay(2200);
    await dismissTour(page);

    const projects = await q(() => http.query("projects:listProjects", {}));
    const proj = projects.find((p) => p.title === TITLE);
    R.before = await snap(proj._id);
    L("before: " + JSON.stringify(R.before));

    // Award Apex while AU has an EXECUTED agreement
    await page.evaluate(() => window.scrollTo(0, 0));
    R.awardOther = await realClickInCard(page, "Apex Electric", "Award Subcontract & Generate AIA A401");
    await delay(6000);
    R.awardOtherToast = await getToast(page);
    R.viewerOpen = await page.evaluate(() => document.body.innerText.includes("AIA Document A401"));
    await shot(page, "fix4-qa1-lc2-01-award-other.png", { full: true });
    let s = await snap(proj._id);
    R.afterAwardOther = s;
    R.nonSuperseded = s.agreements.filter((a) => a.status !== "superseded").length;
    R.executedTouched = s.agreements.filter((a) => a.num === "A401-2026-2600-2606").map((a) => a.status);
    L("afterAwardOther: " + JSON.stringify(R.afterAwardOther));

    // close viewer if any
    const cv = await findButton(page, "Close Viewer", { exact: true });
    if (cv) { await realClick(page, cv); await delay(800); }

    // Delete the executed bid via card delete (title "Delete proposal")
    const delHandle = await page.evaluateHandle((ct) => {
      const btns = [...document.querySelectorAll('button[title="Delete proposal"]')];
      for (const b of btns) {
        let p = b.parentElement;
        for (let i = 0; i < 8 && p; i++) {
          const it = p.innerText || "";
          if (it.includes(ct) && it.length < 3500) return b;
          if (p.tagName === "MAIN" || p.tagName === "BODY") break;
          p = p.parentElement;
        }
      }
      return null;
    }, "AU");
    const delEl = delHandle.asElement();
    R.deleteButtonFound = !!delEl;
    if (delEl) {
      R.deleteClick = await realClick(page, { handle: delEl, meta: { title: "Delete proposal" } });
      const dlg = await waitForText(page, "Delete proposal?", 6000);
      R.deleteDialog = dlg;
      if (dlg) {
        R.deleteConfirm = await clickConfirm(page, "Delete proposal");
        await delay(3500);
        R.deleteToast = await getToast(page);
        R.dialogStillOpen = await page.evaluate(() => document.body.innerText.includes("Delete proposal?"));
      }
    }
    s = await snap(proj._id);
    R.afterDelete = { bidCount: s.bids.length, bids: s.bids, agreements: s.agreements };

    // Which bid is flagged awarded? Compare with UI header KPI
    const header = await page.evaluate(() => document.body.innerText.match(/Subcontracts: (\d+)\/(\d+) Awarded/)?.[0] || null);
    R.headerKpi = header;

    // Try to revise the executed agreement's bid (AU) while it still has executed agreement
    // (open ingest, paste, select Beacon, submit)
    const openBtn = await findButton(page, "Ingest Quote / PDF");
    if (openBtn) {
      await realClick(page, openBtn);
      await waitForText(page, "Direct Quote / PDF Bid Ingestion", 10000);
      await delay(300);
      const area = await findHandles(page, "textarea", (m) => m.ph.includes("Paste raw text"), null);
      if (area[0]) {
        const bx = await area[0].handle.boundingBox();
        await page.mouse.click(bx.x + bx.width / 2, bx.y + 30);
        await page.keyboard.type("PROPOSAL AND QUOTATION\nBase Bid Price: $1,050,000.00\nSCOPE INCLUSIONS (100% COMPLETE):\n- All scope INCLUDED\nLead time: 8 weeks.\nInsurance: Fully compliant ACORD 25 with $5M Umbrella.");
      }
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
      let outcome = "timeout", errText = null;
      for (let i = 0; i < 90; i++) {
        await delay(1500);
        const st = await page.evaluate(() => {
          const t = document.body.innerText;
          return { modal: t.includes("Direct Quote / PDF Bid Ingestion"), err: (t.match(/Bid ingestion failed:([^\n]{0,300})/) || [])[1] || null };
        });
        if (st.err) { outcome = "error"; errText = st.err.trim(); break; }
        if (!st.modal) { outcome = "closed"; break; }
      }
      R.reviseAttempt = { outcome, errText };
      await delay(2000);
      s = await snap(proj._id);
      R.afterRevise = s;
    }

    R.failedHttp = mutations.slice(0, 20);
    R.consoleErrors = diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 220)).slice(0, 15);
    R.pageErrors = diag.pageErrors.slice(0, 8);
    R.consoleWarnings = diag.consoleLogs.filter((l) => l.type === "warning").map((l) => l.text.slice(0, 180)).slice(0, 10);
    await shot(page, "fix4-qa1-lc2-02-final.png", { full: true });
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    await shot(page, "fix4-qa1-lc2-error.png", { full: true }).catch(() => {});
  } finally {
    await browser.close();
    writeJson("fix4-qa1-executed-award-other.json", R);
    writeLog("fix4-qa1-executed-award-other.log", log);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 16000));
};
run();