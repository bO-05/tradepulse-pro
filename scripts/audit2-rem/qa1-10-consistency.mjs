import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, writeLog, delay,
} from "./lib.mjs";
import { findButton, findHandles, realClick, clickTab, dismissTour, getToast } from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const BASE = "https://brainy-skunk-440.convex.site/";
const R = { startedAt: new Date().toISOString() };
const log = [];
const L = (m) => { log.push(`[${new Date().toISOString()}] ${m}`); console.log(m); };
const q = async (fn, tries = 6) => { let last; for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; await delay(1500); } } throw last; };

const calc = (bid) => {
  const ex = (bid.identifiedExclusions || []).reduce((s, x) => (x.isWaived ? s : s + (x.costImpact || 0)), 0);
  return { base: bid.baseBidAmount, leveled: bid.leveledTotalCost, uplift: bid.leveledTotalCost - bid.baseBidAmount, ex };
};

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await dismissTour(page);

    const projects = await q(() => http.query("projects:listProjects", {}));
    const demo = projects.find((p) => p.isDemoProject);
    R.demoProjectId = demo._id;
    const pkgs = await q(() => http.query("tradePackages:listByProject", { projectId: demo._id }));
    const bids = await q(() => http.query("bids:listAllProjectBids", { projectId: demo._id }));
    const agrs = await q(() => http.query("agreements:listAgreements", { projectId: demo._id }));

    // computeProcurementMetrics mirror (src/leveling.ts)
    let totalLeveledBuyout = 0, packagesWithBids = 0, packagesUsingBudget = 0;
    const deceptiveIds = new Set();
    for (const pkg of pkgs) {
      const pkgBids = bids.filter((b) => b.tradePackageId === pkg._id);
      if (pkgBids.length === 0) { totalLeveledBuyout += pkg.budgetEstimate; packagesUsingBudget++; continue; }
      packagesWithBids++;
      const lowest = [...pkgBids].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost)[0];
      for (const b of pkgBids) {
        if (b._id !== lowest._id && b.baseBidAmount < lowest.baseBidAmount && b.leveledTotalCost > lowest.leveledTotalCost) deceptiveIds.add(b._id);
      }
      const awarded = pkgBids.find((b) => b.isAwarded);
      const effective = awarded || lowest;
      totalLeveledBuyout += effective.leveledTotalCost;
    }
    let gaps = 0;
    for (const id of deceptiveIds) {
      const b = bids.find((x) => x._id === id);
      gaps += b.leveledTotalCost - b.baseBidAmount;
    }
    const awardedPkgIds = new Set();
    for (const a of agrs) if (a.status !== "superseded") awardedPkgIds.add(a.tradePackageId);
    for (const b of bids) if (b.isAwarded) awardedPkgIds.add(b.tradePackageId);
    for (const p of pkgs) if (p.status === "awarded") awardedPkgIds.add(p._id);
    R.backend = {
      totalBudget: demo.estBudget,
      totalLeveledBuyout,
      variance: demo.estBudget - totalLeveledBuyout,
      variancePct: ((demo.estBudget - totalLeveledBuyout) / demo.estBudget) * 100,
      packagesWithBids,
      packagesUsingBudget,
      deceptiveIds: [...deceptiveIds],
      deceptiveNames: [...deceptiveIds].map((id) => bids.find((b) => b._id === id).subcontractorName),
      gaps,
      awardedPackages: pkgs.filter((p) => awardedPkgIds.has(p._id)).length,
      totalPackages: pkgs.length,
      agreementSums: agrs.filter((a) => a.status !== "superseded").map((a) => ({ num: a.agreementNumber, sum: a.contractSum, status: a.status })),
    };
    L("backend " + JSON.stringify(R.backend));

    // Demo is default active project on fresh load (localStorage may hold fixture; set demo via UI selector)
    await page.evaluate((id) => {
      const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      sel.value = id; sel.dispatchEvent(new Event("change", { bubbles: true }));
    }, demo._id);
    await delay(2500);
    await dismissTour(page);

    // Compact KPI strip
    const compact = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        baseline: (t.match(/BASELINE:[\s\S]{0,220}/) || [])[0] || null,
        leveled: (t.match(/Leveled Buyout: \$([\d,]+)/) || [])[1] || null,
        leveledShort: (t.match(/Leveled Buyout: \$[\d,]+ ?\(([^)]+)\)/) || [])[1] || null,
        variance: (t.match(/Variance: ([+-])\$([\d,]+)/) || []).slice(1),
        deceptive: (t.match(/(\d+) Deceptive Bid/) || [])[1] || null,
        gaps: (t.match(/Gaps Exposed: \+?\$([\d,]+)/) || [])[1] || null,
        awards: (t.match(/Subcontracts: (\d+)\/(\d+) Awarded/) || []).slice(1),
        pkgs: (t.match(/(\d+) Pkgs/) || [])[1] || null,
        subs: (t.match(/(\d+) Subs/) || [])[1] || null,
        rfis: (t.match(/(\d+) RFIs/) || [])[1] || null,
        bids: (t.match(/(\d+) Bids/) || [])[1] || null,
        clashes: (t.match(/(\d+) Clashes/) || [])[1] || null,
      };
    });
    R.compact = compact;
    await shot(page, "fix4-qa1-cs-01-compact-kpi.png");

    // Expanded 6-card KPI view
    const expand = await findButton(page, "Expand 6-Card KPI View");
    R.expandClick = expand ? await realClick(page, expand) : { ok: false };
    await delay(900);
    R.expanded = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        leveledCard: (t.match(/Leveled Buyout\n([^\n]*)\n\$([\d,]+)/) || []).slice(1),
        varianceCard: (t.match(/(Variance vs Budget|Budget vs Scope Estimate)\n([^\n]*)\n([^\n]*)\n([^\n]*)/) || []).slice(0, 5),
        deceptiveCard: (t.match(/Deceptive Bids Flagged\n([^\n]*)\n([^\n]*)/) || []).slice(1),
        gapsCard: (t.match(/Hidden Gaps Exposed\n([^\n]*)\n([^\n]*)/) || []).slice(1),
        awardsCard: (t.match(/Subcontract Awards\n([^\n]*)\n([^\n]*)/) || []).slice(1),
        full: t.slice(0, 700),
      };
    });
    await shot(page, "fix4-qa1-cs-02-expanded-kpi.png");
    R.expandedRestored = await realClick(page, (await findButton(page, "Collapse")) || (await findButton(page, "Expand 6-Card KPI View"))).catch(() => null);

    // Contracts tab numbers
    await clickTab(page, "06:");
    await delay(2000);
    await dismissTour(page);
    R.contractsUI = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        activeSum: (t.match(/ACTIVE CONTRACTED SUM\s*\$?([\d,]+)/) || [])[1] || null,
        lds: (t.match(/LDs: \$([\d,]+)\/day/) || [])[1] || null,
        awardCount: (t.match(/(\d+) of (\d+) awarded/) || []).slice(1),
        agent: (t.match(/(A401-2026-[\d-]+)/g) || []).slice(0, 4),
      };
    });
    await shot(page, "fix4-qa1-cs-03-contracts.png", { full: true });

    // Tour scene numbers
    const tourBtn = await findButton(page, "Demo Tour");
    if (tourBtn) await realClick(page, tourBtn);
    await delay(800);
    R.tour = {};
    for (const step of ["01:", "02:", "03:", "04:", "05:", "06:"]) {
      const b = await findHandles(page, "button", (m, a) => m.title.startsWith(a), step);
      if (b[0]) { await realClick(page, b[0]); await delay(1000); }
      R.tour[step] = await page.evaluate(() => {
        const t = document.body.innerText;
        const m = t.match(/Cue:"?([^\n]{0,260})/);
        const k = t.match(/Key Metric[^\n]*\n?([^\n]{0,120})/);
        return { cue: m ? m[1] : null, metric: k ? k[1] : null };
      });
    }
    await shot(page, "fix4-qa1-cs-04-tour.png", { full: true });
    await dismissTour(page);

    // CTA inventory per tab (visible buttons with strong styling)
    R.ctas = {};
    for (const tab of ["packages", "discovery", "qna", "leveling", "coordination", "contracts"]) {
      await clickTab(page, tab === "packages" ? "01:" : tab === "discovery" ? "02:" : tab === "qna" ? "03:" : tab === "leveling" ? "04:" : tab === "coordination" ? "05:" : "06:");
      await delay(1700);
      await dismissTour(page);
      R.ctas[tab] = await page.evaluate(() => {
        const strong = [];
        for (const b of [...document.querySelectorAll("button")]) {
          const r = b.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const cls = b.className || "";
          if (/bg-emerald-6|bg-gradient-to-r|bg-amber-5/.test(String(cls))) strong.push((b.textContent || "").trim().slice(0, 80));
        }
        return strong;
      });
      await shot(page, `fix4-qa1-cs-05-cta-${tab}.png`);
    }

    // clipped-control reachability at 375 on contracts + diagnostics
    R.clipReach = {};
    for (const tab of ["contracts", "diagnostics"]) {
      await page.setViewport({ width: 375, height: 800, deviceScaleFactor: 1 });
      await delay(600);
      R.clipReach[tab] = await page.evaluate(() => {
        const out = [];
        for (const b of document.querySelectorAll("button")) {
          const r = b.getBoundingClientRect();
          if (!(r.width > 0 && r.height > 0)) continue;
          if (r.right <= window.innerWidth + 3 && r.left >= -3) continue;
          let p = b.parentElement; let scroller = null;
          while (p && p !== document.body) {
            const st = getComputedStyle(p);
            if ((st.overflowX === "auto" || st.overflowX === "scroll") && p.scrollWidth > p.clientWidth) { scroller = p.className.slice(0, 60); break; }
            if (st.overflowX === "hidden" && p.scrollWidth > p.clientWidth) { scroller = "overflow-hidden:" + p.className.slice(0, 50); break; }
            p = p.parentElement;
          }
          out.push({ label: (b.textContent || b.getAttribute("title") || "").trim().slice(0, 36), left: Math.round(r.left), right: Math.round(r.right), scroller });
        }
        return out.slice(0, 6);
      });
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      await delay(400);
    }

    R.consoleErrors = diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 160)).slice(0, 10);
    R.pageErrors = diag.pageErrors.slice(0, 5);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    await shot(page, "fix4-qa1-cs-error.png", { full: true }).catch(() => {});
  } finally {
    await browser.close();
    writeJson("fix4-qa1-consistency.json", R);
    writeLog("fix4-qa1-consistency.log", log);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 16000));
};
run();