import { ConvexHttpClient } from "convex/browser";
import { launchBrowser, attachDiagnostics, waitForAppReady, selectProjectByTitle, writeJson,
  writeLog, shot, delay, clickButtonByText, bodyText } from "./lib.mjs";

const c = new ConvexHttpClient(process.env.REM_CONVEX_URL || "https://brainy-skunk-440.convex.cloud");
const DEMO_TITLE = "The Domain Tower B - Commercial MEP";

// ---------- Independent recomputation (hand-rolled, does NOT import src/leveling.ts) ----------
function normBreakdown(bid) {
  const exclusions = (bid.identifiedExclusions || []).reduce((s, e) => (e.isWaived ? s : s + (e.costImpact || 0)), 0);
  const veAccepted = (bid.valueEngineeringAlternates || []).reduce((s, a) => (a.isAccepted ? s + (a.costDeduct || 0) : s), 0);
  const lead = bid.leadTimePenalty || 0;
  const coi = bid.coiPenalty || 0;
  return { exclusions, lead, coi, veAccepted, totalUplift: exclusions + lead + coi - veAccepted };
}
function deceptiveIds(pkgBids) {
  const lowest = [...pkgBids].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost)[0];
  if (!lowest) return [];
  return pkgBids
    .filter((b) => b._id !== lowest._id && b.baseBidAmount < lowest.baseBidAmount && b.leveledTotalCost > lowest.leveledTotalCost)
    .map((b) => b._id);
}
function independentMetrics(project, packages, bids, agreements) {
  const totalBudget = project?.estBudget || 0;
  let totalLeveledBuyout = 0;
  let packagesWithBids = 0;
  let packagesUsingBudget = 0;
  const deceptive = new Set();
  let awardedCount = 0;
  for (const pkg of packages) {
    const pb = bids.filter((b) => b.tradePackageId === pkg._id);
    if (pb.length === 0) {
      totalLeveledBuyout += pkg.budgetEstimate || 0;
      packagesUsingBudget++;
      continue;
    }
    packagesWithBids++;
    for (const id of deceptiveIds(pb)) deceptive.add(id);
    const awarded = pb.find((b) => b.isAwarded);
    const effective = awarded || [...pb].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost)[0];
    totalLeveledBuyout += effective.leveledTotalCost;
  }
  if (bids.length === 0 && packages.length === 0) totalLeveledBuyout = totalBudget;
  const variance = totalBudget - totalLeveledBuyout;
  const variancePercent = totalBudget > 0 ? (variance / totalBudget) * 100 : 0;
  let gapsCaught = 0;
  for (const id of deceptive) {
    const b = bids.find((x) => x._id === id);
    if (b) gapsCaught += normBreakdown(b).totalUplift;
  }
  const awardedPkgIds = new Set();
  for (const a of agreements) if (a.status !== "superseded") awardedPkgIds.add(a.tradePackageId);
  for (const b of bids) if (b.isAwarded) awardedPkgIds.add(b.tradePackageId);
  for (const p of packages) if (p.status === "awarded") awardedPkgIds.add(p._id);
  awardedCount = packages.filter((p) => awardedPkgIds.has(p._id)).length;
  const activeAgreementSum = agreements.filter((a) => a.status !== "superseded").reduce((s, a) => s + (a.contractSum || 0), 0);
  const effectiveBidAll = (() => {
    const sorted = [...bids].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost);
    const aw = sorted.find((b) => b.isAwarded);
    return aw || sorted[0] || null;
  })();
  const runnerUp = bids.length > 1 ? [...bids].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost).find((b) => b._id !== effectiveBidAll?._id) : null;
  return {
    totalBudget, totalLeveledBuyout, packagesWithBids, packagesUsingBudget,
    variance, variancePercent, isSavings: variance >= 0,
    deceptiveBidIds: [...deceptive], deceptiveBidsCount: deceptive.size, gapsCaught,
    awardedPackages: awardedCount, totalPackages: packages.length,
    buyoutProgressPercent: packages.length > 0 ? (awardedCount / packages.length) * 100 : 0,
    contractsRegisterActiveSum: activeAgreementSum,
    effectiveBidName: effectiveBidAll?.subcontractorName, effectiveBidCost: effectiveBidAll?.leveledTotalCost,
    runnerUpName: runnerUp?.subcontractorName, runnerUpBaseCost: runnerUp?.baseBidAmount, runnerUpCost: runnerUp?.leveledTotalCost,
  };
}

const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;

const run = async () => {
  const out = { startedAt: new Date().toISOString(), backend: {}, expected: {}, ui: {}, checks: [] };
  const projects = await c.query("projects:listProjects", {});
  const demo = projects.find((p) => p.title === DEMO_TITLE);
  const packages = await c.query("tradePackages:listByProject", { projectId: demo._id });
  const bids = await c.query("bids:listAllProjectBids", { projectId: demo._id });
  const agreements = await c.query("agreements:listAgreements", { projectId: demo._id });
  out.expected = independentMetrics(demo, packages, bids, agreements);
  out.backend = { demoId: demo._id, estBudget: demo.estBudget, packages: packages.length, bids: bids.length, agreements: agreements.length };

  const { browser } = await launchBrowser(1440, 1400);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto(process.env.REM_BASE_URL || "https://brainy-skunk-440.convex.site", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await selectProjectByTitle(page, "Domain Tower B");
    await delay(1500);

    // ---- 1. Compact KPI strip
    out.ui.compactText = await page.evaluate(() => {
      const m = document.body.innerText.match(/BASELINE:[\s\S]{0,800}?Expand 6-Card KPI View/);
      return m ? m[0].replace(/\s+/g, " ") : null;
    });
    await shot(page, "fix4-qa3-01-compact-strip.png");

    // ---- 2. Header stepper badge
    out.ui.headerText = await page.evaluate(() => document.querySelector("header")?.innerText || null);
    const awardedBadge = out.ui.headerText?.match(/(\d+\/\d+ Awarded)/);
    out.ui.headerAwardedBadge = awardedBadge ? awardedBadge[1] : null;

    // ---- 3. Expanded 6 cards
    await clickButtonByText(page, "Expand 6-Card KPI View");
    await delay(800);
    out.ui.expandedGrid = await page.evaluate(() => {
      const cands = [...document.querySelectorAll("div")].filter(
        (d) => (d.textContent || "").includes("Commercial Procurement Financial Baseline") && (d.textContent || "").includes("Subcontract Awards")
      );
      if (!cands.length) return null;
      const el = cands.reduce((a, b) => ((a.textContent || "").length <= (b.textContent || "").length ? a : b));
      return (el.innerText || "").replace(/\s+/g, " ");
    });
    await shot(page, "fix4-qa3-01-expanded-6cards.png");

    // ---- 4. Contracts register
    await clickButtonByText(page, "Subcontracts");
    await delay(1500);
    out.ui.contractsRegister = await page.evaluate(() => {
      const t = document.body.innerText;
      const sum = t.match(/ACTIVE CONTRACTED SUM\s*\$([\d,]+)/i);
      const exec = t.match(/EXECUTION STATUS RECORDED\s*(\d+)\s*\/\s*(\d+)/i);
      const tableSum = t.match(/\$([\d,]+)/g);
      return { activeContractedSum: sum ? sum[1] : null, execution: exec ? `${exec[1]}/${exec[2]}` : null, allMoneyOnPage: tableSum ? tableSum.slice(0, 12) : [] };
    });
    await shot(page, "fix4-qa3-01-contracts-register.png");

    // ---- 5. Demo tour metrics (scene 04 leveling, scene 06 contracts)
    const sceneMetric = async (pillTitlePrefix) => {
      const pill = await page.evaluate((prefix) => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(prefix));
        if (!b) return false;
        b.click();
        return true;
      }, pillTitlePrefix);
      if (!pill) return { pill: false };
      await delay(900);
      return page.evaluate(() => {
        const span = [...document.querySelectorAll("span")].find((s) => (s.getAttribute("title") || "").startsWith("Figures in this cue"));
        const cue = [...document.querySelectorAll("span")].find((s) => (s.textContent || "").includes("Cue:"));
        const scene = [...document.querySelectorAll("span")].find((s) => (s.textContent || "").includes("Scene 0"));
        return { pill: true, keyMetric: span ? span.textContent.trim() : null, cue: cue ? cue.textContent.trim().slice(0, 500) : null, sceneTag: scene ? scene.textContent.trim() : null };
      });
    };
    out.ui.tourScene04 = await sceneMetric("04:");
    await shot(page, "fix4-qa3-01-tour-scene04.png");
    out.ui.tourScene06 = await sceneMetric("06:");
    await shot(page, "fix4-qa3-01-tour-scene06.png");
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
  } finally {
    out.diag = { pageErrors: diag.pageErrors, consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 10) };
    await browser.close();
  }

  // ---------- Reconciliation ----------
  const E = out.expected; const U = out.ui;
  const compact = U.compactText || "";
  const card = (label) => U.expandedGrid || "";
  const ck = (id, surface, actual, expected, note = "") => {
    const ok = actual !== null && actual !== undefined && String(actual).replace(/\s+/g, " ").includes(String(expected));
    out.checks.push({ id, surface, expected: String(expected), actual: actual === null || actual === undefined ? null : String(actual), ok, note });
    return ok;
  };
  ck("D1", "KPI strip budget", compact, money(E.totalBudget));
  ck("D2", "KPI strip buyout", compact, money(E.totalLeveledBuyout));
  ck("D3", "KPI strip variance", compact, money(E.variance));
  ck("D4", "KPI strip deceptive", compact, `${E.deceptiveBidsCount} Deceptive Bid`);
  ck("D5", "KPI strip gaps", compact, `Gaps Exposed: +${money(E.gapsCaught)}`);
  ck("D6", "KPI strip awards", compact, `${E.awardedPackages}/${E.totalPackages} Awarded`);
  ck("D7", "Expanded card Total Budget", card("Total Budget"), money(E.totalBudget));
  ck("D8", "Expanded card Leveled Buyout", card("Leveled Buyout"), money(E.totalLeveledBuyout));
  ck("D9", "Expanded card Variance", card("Variance vs Budget"), money(E.variance));
  ck("D10", "Expanded card Deceptive", card("Deceptive Bids Flagged"), `${E.deceptiveBidsCount} proposals`);
  ck("D11", "Expanded card Gaps", card("Hidden Gaps Exposed"), `+${money(E.gapsCaught)}`);
  ck("D12", "Expanded card Awards", card("Subcontract Awards"), `${E.awardedPackages} of ${E.totalPackages}`);
  ck("D13", "Header stepper badge", U.headerAwardedBadge, `${E.awardedPackages}/${E.totalPackages} Awarded`);
  ck("D14", "Contracts register sum", U.contractsRegister?.activeContractedSum, E.contractsRegisterActiveSum.toLocaleString("en-US"));
  ck("D14b", "Contracts register execution", U.contractsRegister?.execution, `0/${agreements.filter((a) => a.status !== "superseded").length}`);
  ck("D15", "Tour scene04 metric variance", U.tourScene04?.keyMetric, `${money(E.variance)} True Variance vs Budget`);
  ck("D16", "Tour scene04 deceptive count", U.tourScene04?.keyMetric, `${E.deceptiveBidsCount} Deceptive Bid`);
  ck("D17", "Tour scene06 metric contract sum", U.tourScene06?.keyMetric, `${money(E.contractsRegisterActiveSum)} Subcontract`);
  ck("D18", "Tour scene06 award line", U.tourScene06?.cue, `${E.awardedPackages} of ${E.totalPackages} package`);

  // independent formula recap
  out.formula = {
    note: "Leveled = base + unwaived exclusions + leadPenalty + coiPenalty - acceptedVEDeduct; Buyout = sum(effective leveled per package, budget if no bids); Variance = estBudget - buyout",
    bids: out.expected.deceptiveBidIds,
    gapsCaughtBreakdown: out.expected.deceptiveBidIds.map((id) => {
      const b = bids.find((x) => x._id === id);
      return { id, name: b.subcontractorName, ...normBreakdown(b) };
    }),
    buyoutComponents: packages.map((p) => {
      const pb = bids.filter((b) => b.tradePackageId === p._id);
      const awarded = pb.find((b) => b.isAwarded);
      const eff = awarded || [...pb].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost)[0] || null;
      return { pkg: p.csiDivision, effective: eff ? { name: eff.subcontractorName, leveled: eff.leveledTotalCost } : null, fallbackBudget: eff ? null : p.budgetEstimate };
    }),
  };

  const file = writeJson("fix4-qa3-01-derived.json", out);
  const allOk = out.checks.every((x) => x.ok);
  writeLog("fix4-qa3-01-derived.log", [
    `formula: ${out.formula.note}`,
    `budget=${E.totalBudget} buyout=${E.totalLeveledBuyout} variance=${E.variance} (${E.variancePercent.toFixed(2)}%) deceptive=${E.deceptiveBidsCount} gaps=${E.gapsCaught} awarded=${E.awardedPackages}/${E.totalPackages} contractSum=${E.contractsRegisterActiveSum}`,
    ...out.checks.map((x) => `${x.ok ? "PASS" : "FAIL"} ${x.id} ${x.surface}: expected=${x.expected} actual=${x.actual}`),
  ]);
  console.log("evidence:", file);
  console.log(JSON.stringify({ allOk, expected: E, checks: out.checks }, null, 2));
  if (out.error) console.log("ERROR", out.error);
};

run().catch((e) => { console.error("ERR", e && e.stack ? e.stack : e); process.exit(1); });