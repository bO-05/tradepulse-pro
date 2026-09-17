// QA-12 precise demo UI-vs-backend consistency probe (per-active-package semantics).
import {
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  delay,
  BASE_URL,
  writeLog,
  getSelectorState,
} from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const URL_ = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const backend = new ConvexHttpClient(URL_);

const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 900) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "…" : s;
};

async function run() {
  const { browser } = await launchBrowser();
  const summary = { at: new Date().toISOString() };
  try {
    ev("=== QA-12 DEMO CONSISTENCY PROBE ===");
    ev(`UTC: ${new Date().toISOString()}`);
    const demo = await backend.query("projects:getDemoProject", {});
    const pkgs = await backend.query("tradePackages:listByProject", { projectId: demo._id });
    const perPkg = {};
    for (const p of pkgs) {
      const contractors = await backend.query("contractors:listByPackage", { tradePackageId: p._id });
      const bids = await backend.query("bids:listByPackage", { tradePackageId: p._id });
      const convos = await backend.query("rfq:listConversations", { tradePackageId: p._id });
      perPkg[p._id] = { csi: p.csiDivision, status: p.status, contractors: contractors.length, bids: bids.length, conversations: convos.length };
    }
    const ags = await backend.query("agreements:listAgreements", { projectId: demo._id });
    const clash = await backend.query("coordination:detectCrossTradeClashes", { projectId: demo._id });
    const backendState = {
      packages: pkgs.map((p) => p.csiDivision),
      perPkg,
      agreements: ags.map((a) => ({ num: a.agreementNumber, status: a.status })),
      clashCount: (clash?.doubleBuys?.length ?? 0) + (clash?.scopeVoids?.length ?? 0),
      awardedPackages: pkgs.filter((p) => p.status === "awarded").length,
    };
    ev(`backend state: ${J(backendState, 1200)}`);

    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    const d = attachDiagnostics(page);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2600);
    const sel = await getSelectorState(page);
    ev(`landing selected: "${sel?.selectedText}"`);
    const ui = await page.evaluate(() => {
      const header = document.querySelector("header");
      const main = document.querySelector("main");
      const ht = header ? header.innerText.replace(/\s+/g, " ") : "";
      const mt = main ? main.innerText.replace(/\s+/g, " ") : "";
      const one = (re) => {
        const m = ht.match(re);
        return m ? m[0] : null;
      };
      const num = (re) => {
        const m = ht.match(re);
        return m ? Number(m[1]) : null;
      };
      const activeStage = (() => {
        const s = document.querySelector('select[aria-label="Navigate procurement stage"]');
        return s ? s.value : null;
      })();
      const pkgCsi = (mt.match(/CSI \d{2} \d{2} \d{2}/) || [null])[0];
      return {
        pkgBadge: num(/(\d+)\s*Pkgs?/),
        subsBadge: num(/(\d+)\s*Subs?/),
        rfiBadge: num(/(\d+)\s*RFIs?/),
        bidBadge: num(/(\d+)\s*Bids?/),
        awardBadge: num(/(\d+)\s*Award/),
        clashText: one(/\d+\s*Clashes?|Clear/),
        kpiBuyout: (mt.match(/Buyout:\s*\d+\/\d+\s*Awarded/) || [null])[0],
        activeStage,
        pkgCsi,
      };
    });
    ev(`UI badges: ${J(ui, 800)}`);
    await shot(page, "remediation-qa12-18-demo-consistency.png");

    // active package = the one shown in CSI chip on the default stage
    let activePkg = null;
    if (ui.pkgCsi) {
      const csi = ui.pkgCsi.replace("CSI ", "");
      activePkg = Object.entries(perPkg).find(([, v]) => v.csi === csi)?.[1] ?? null;
    }
    const checks = {
      pkgBadge: ui.pkgBadge === pkgs.length,
      kpiAward: ui.kpiBuyout === `Buyout: ${backendState.awardedPackages}/${pkgs.length} Awarded`,
      clashBadge: ui.clashText === `${backendState.clashCount} Clashes` || (backendState.clashCount === 0 && ui.clashText === "Clear"),
      subsBadgeActivePkg: activePkg ? ui.subsBadge === activePkg.contractors : null,
      bidBadgeActivePkg: activePkg ? ui.bidBadge === activePkg.bids : null,
      rfiBadgeActivePkg: activePkg ? ui.rfiBadge === activePkg.conversations : null,
      awardBadge: ui.awardBadge === backendState.agreements.length,
    };
    ev(`active package: ${J(activePkg)}`);
    ev(`checks: ${J(checks)}`);
    summary.platform = { backendState, ui, activePkg, checks, landing: sel?.selectedText };

    const diag = {
      consoleErrors: d.consoleLogs.filter((l) => l.type === "error").map((l) => l.text),
      consoleWarnings: d.consoleLogs.filter((l) => l.type === "warning").map((l) => l.text),
      pageErrors: d.pageErrors,
      failedRequests: d.failedRequests,
    };
    ev(`diag: ${J(diag, 400)}`);
    summary.diag = diag;

    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa12-demo-consistency.json"), JSON.stringify(summary, null, 2), "utf8");
    writeLog("remediation-qa12-demo-consistency.txt", LOG);
    await browser.close();
    console.log("Wrote evidence.");
  } catch (e) {
    writeLog("remediation-qa12-demo-consistency.txt", LOG.concat([`FATAL: ${e?.stack || e}`]));
    await browser.close();
    process.exit(1);
  }
}

run();