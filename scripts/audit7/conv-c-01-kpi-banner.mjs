/**
 * CONV-C 01 (audit-6 checks 1+2): demo headline claims in the KPI band and the
 * public-demo banner visibility at load and across every tab.
 * Read-only: no mutation is invoked, no dispatch is clicked.
 */
import fs from "node:fs";
import path from "node:path";
import { openApp, clickTab, selectProject, q, writeEvidence, delay, clickText } from "./lib.mjs";

const CLAIMS = {
  budget: "$4,250,000",
  leveledBuyout: "$3,918,500",
  variance: "+$331,500",
  variancePct: "7.8%",
  gaps: "+$186,000",
  award: "1/3",
};

const out = { startedAt: new Date().toISOString(), claims: CLAIMS };
const { browser, page } = await openApp(1440, 900);
try {
  const projects = (await q("projects:listProjects", {})) || [];
  const demo = projects.find((p) => /The Domain Tower B/i.test(p.title));
  out.demoProject = demo ? { _id: demo._id, title: demo.title, estBudget: demo.estBudget } : null;
  if (!demo) throw new Error("demo project not found");

  await selectProject(page, demo._id);
  await delay(2000);
  const shotDir = path.join(process.cwd(), "evidence");
  fs.mkdirSync(shotDir, { recursive: true });

  // --- Check 2: banner at load ---
  out.bannerInitial = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="note"]')].find((x) => x.getBoundingClientRect().width > 1);
    return el ? { text: (el.textContent || "").trim(), visible: true } : { text: null, visible: false };
  });

  // --- Check 1a: compact strip before expanding (default state) ---
  out.compactStrip = await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find(
      (d) => d.innerText && /baseline:/i.test(d.innerText) && /subcontracts:/i.test(d.innerText)
    );
    return el ? el.innerText.replace(/\n+/g, " | ") : null;
  });

  // --- Check 1b: expand the 6-card KPI view ---
  out.expand = await clickText(page, "Expand 6-Card KPI View");
  await delay(900);
  out.expanded = await page.evaluate(() => {
    const label = [...document.querySelectorAll("div,span")].find(
      (d) => d.innerText && /commercial procurement financial baseline/i.test(d.innerText)
    );
    const dash = label ? label.closest("div.bg-slate-900\\/90, div[class*='bg-slate-900']") || label.parentElement : null;
    if (!dash) return { dashboardText: null, cards: [], labelText: label ? label.innerText : null };
    const grid = dash.querySelector(".grid") || dash;
    const cards = [...grid.children].map((c) => c.innerText.replace(/\n+/g, " | "));
    return { dashboardText: dash.innerText.replace(/\n+/g, " | "), cards, labelText: label.innerText };
  });
  await page.screenshot({ path: path.join(shotDir, "fix6-conv-c-01-kpi.png") });
  await page.evaluate(() => window.scrollTo(0, 0));

  // --- Check 2: banner survives navigation across every tab ---
  const tabs = [
    ["CSI Scoping", "01:"],
    ["Discovery", "02:"],
    ["Pre-Bid Q&A", "03:"],
    ["Bid Leveling", "04:"],
    ["Scope Clash", "05:"],
    ["Subcontracts", "06:"],
    ["Live Activity Audit", null],
    ["Evals & Architecture", null],
  ];
  const bannerByTab = [];
  for (const [label] of tabs) {
    const ok = await clickTab(page, label);
    await delay(1600);
    const banner = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="note"]')].find((x) => x.getBoundingClientRect().width > 1);
      return el ? (el.textContent || "").trim() : null;
    });
    bannerByTab.push({ tab: label, clicked: ok, banner });
  }
  out.bannerByTab = bannerByTab;
  out.bannerPersistsAllTabs = bannerByTab.every(
    (b) => b.banner && b.banner.includes("Public shared demo") && b.banner.includes("visible to anyone with this URL")
  );

  // Claim matching on the expanded dashboard text
  const allText = (out.expanded?.dashboardText || "") + "\n" + (out.compactStrip || "");
  out.claimMatches = {
    budget: allText.includes(CLAIMS.budget),
    leveledBuyout: allText.includes(CLAIMS.leveledBuyout),
    variance: allText.includes(CLAIMS.variance),
    variancePct: allText.includes(CLAIMS.variancePct),
    gaps: allText.includes(CLAIMS.gaps),
    awardSlash: allText.includes(CLAIMS.award),
  };

  // Backend cross-check of the derived values
  const pkgs = (await q("tradePackages:listByProject", { projectId: demo._id })) || [];
  const bids = (await q("bids:listAllProjectBids", { projectId: demo._id })) || [];
  const agreements = (await q("agreements:listAgreements", { projectId: demo._id })) || [];
  const effective = (pb) => {
    const awarded = pb.find((b) => b.isAwarded);
    return awarded || [...pb].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost)[0];
  };
  let buyout = 0;
  for (const p of pkgs) {
    const pb = bids.filter((b) => b.tradePackageId === p._id);
    buyout += pb.length ? effective(pb)?.leveledTotalCost || 0 : p.budgetEstimate || 0;
  }
  out.backend = {
    estBudget: demo.estBudget,
    computedBuyout: buyout,
    variance: (demo.estBudget || 0) - buyout,
    nonSupersededAgreements: agreements.filter((a) => a.status !== "superseded" && a.status !== "voided").length,
    packageCount: pkgs.length,
  };
} catch (err) {
  out.error = String(err?.stack ?? err);
} finally {
  await browser.close();
}
writeEvidence("fix6-conv-c-01-kpi-banner.json", out);
console.log(JSON.stringify({ bannerInitial: out.bannerInitial, bannerPersistsAllTabs: out.bannerPersistsAllTabs, compactStrip: out.compactStrip, cards: out.expanded?.cards, claimMatches: out.claimMatches, backend: out.backend, error: out.error }, null, 1));