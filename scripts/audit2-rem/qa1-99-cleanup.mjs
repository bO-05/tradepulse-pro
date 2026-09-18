import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, writeLog, delay,
} from "./lib.mjs";
import {
  findButton, findHandles, realClick, clickConfirm, selectProject, projectOptionState, clickTab,
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
  const diag = attachDiagnostics(page);
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await dismissTour(page);
    const projects0 = await q(() => http.query("projects:listProjects", {}));
    const proj = projects0.find((p) => p.title === TITLE);
    R.beforeCleanup = {
      projects: projects0.map((p) => p.title),
      fixtureExists: !!proj,
    };
    if (!proj) { R.done = "already gone"; throw new Error("fixture project not found"); }
    const pkgs0 = await q(() => http.query("tradePackages:listByProject", { projectId: proj._id }));
    const pkg = pkgs0.find((p) => p.tradeName === PKG_NAME);
    R.beforeCleanup.packageCount = pkgs0.length;
    R.beforeCleanup.contractors = pkg ? (await q(() => http.query("contractors:listByPackage", { tradePackageId: pkg._id }))).length : 0;
    R.beforeCleanup.bids = (await q(() => http.query("bids:listAllProjectBids", { projectId: proj._id }))).length;
    R.beforeCleanup.agreements = (await q(() => http.query("agreements:listAgreements", { projectId: proj._id }))).length;

    await selectProject(page, TITLE);
    await delay(2500);
    await dismissTour(page);
    await clickTab(page, "01:");
    await delay(1500);
    await dismissTour(page);

    // 1) Delete package with bids via UI
    const delBtn = await page.evaluateHandle((name) => {
      const btns = [...document.querySelectorAll('button[title="Delete Trade Package"]')];
      for (const b of btns) {
        let el = b.parentElement;
        for (let i = 0; i < 8 && el; i++) {
          if ((el.innerText || "").includes(name) && (el.innerText || "").length < 2600) return b;
          if (el.tagName === "MAIN" || el.tagName === "BODY") break;
          el = el.parentElement;
        }
      }
      return btns[0] || null;
    }, PKG_NAME);
    const delEl = delBtn.asElement();
    R.packageDeleteFound = !!delEl;
    if (delEl) {
      R.packageDeleteClick = await realClick(page, { handle: delEl, meta: { title: "Delete Trade Package" } });
      const dlg = await waitForText(page, "Delete trade package?", 6000);
      R.packageDeleteDialog = dlg;
      await shot(page, "fix4-qa1-clean-01-confirm-package.png");
      if (dlg) {
        R.packageDeleteConfirm = await clickConfirm(page, "Delete package");
        await delay(4000);
        R.packageDeleteToast = await getToast(page);
      }
    }
    const pkgsAfter = await q(() => http.query("tradePackages:listByProject", { projectId: proj._id }));
    const bidsAfter = await q(() => http.query("bids:listAllProjectBids", { projectId: proj._id }));
    const agrsAfter = await q(() => http.query("agreements:listAgreements", { projectId: proj._id }));
    R.afterPackageDelete = { packages: pkgsAfter.length, bids: bidsAfter.length, agreements: agrsAfter.length };

    // 2) Delete the fixture project via UI
    const deleteProjBtn = await findHandles(page, "button", (m) => m.title === "Delete custom project", null);
    R.projectDeleteFound = deleteProjBtn.length;
    if (deleteProjBtn[0]) {
      await realClick(page, deleteProjBtn[0]);
      const dlg = await waitForText(page, "Delete project?", 6000);
      R.projectDeleteDialog = dlg;
      if (dlg) {
        R.projectDeleteConfirm = await clickConfirm(page, "Delete project");
        await delay(5000);
        R.projectDeleteToast = await getToast(page);
      }
    }
    R.projectsAfter = (await q(() => http.query("projects:listProjects", {}))).map((p) => p.title);
    R.fixtureGone = !R.projectsAfter.includes(TITLE);
    R.selectorAfter = await projectOptionState(page);
    await shot(page, "fix4-qa1-clean-02-after-delete.png", { full: true });

    // 3) Final integrity check: demo + foreign projects untouched
    const projects = await q(() => http.query("projects:listProjects", {}));
    const demo = projects.find((p) => p.isDemoProject);
    const demoBids = await q(() => http.query("bids:listAllProjectBids", { projectId: demo._id }));
    const demoPkgs = await q(() => http.query("tradePackages:listByProject", { projectId: demo._id }));
    const demoAgrs = await q(() => http.query("agreements:listAgreements", { projectId: demo._id }));
    R.demoIntegrity = {
      title: demo.title,
      budget: demo.estBudget,
      packages: demoPkgs.map((p) => ({ name: p.tradeName, budget: p.budgetEstimate, status: p.status })),
      bids: demoBids.map((b) => ({ sub: b.subcontractorName, base: b.baseBidAmount, awarded: b.isAwarded })),
      agreements: demoAgrs.map((a) => ({ num: a.agreementNumber, status: a.status, sum: a.contractSum })),
    };
    const foreign = projects.filter((p) => p.title.startsWith("AUDIT-5-") || p.title === "GC-AUDIT Riverside Medical Tower");
    R.foreignProjects = [];
    for (const f of foreign) {
      R.foreignProjects.push({
        title: f.title,
        packages: (await q(() => http.query("tradePackages:listByProject", { projectId: f._id }))).length,
        bids: (await q(() => http.query("bids:listAllProjectBids", { projectId: f._id }))).length,
      });
    }
    R.otherProjects = projects.filter((p) => p.title.startsWith("AUDIT-QA3") || (p.title.startsWith("AUDIT-QA1") && p.title !== TITLE)).map((p) => p.title);

    R.consoleErrors = diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 150)).slice(0, 8);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    await shot(page, "fix4-qa1-clean-error.png", { full: true }).catch(() => {});
  } finally {
    await browser.close();
    writeJson("fix4-qa1-cleanup.json", R);
    writeLog("fix4-qa1-cleanup.log", log);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 12000));
};
run();