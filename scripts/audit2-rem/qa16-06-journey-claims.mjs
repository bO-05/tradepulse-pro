import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickButtonByText, setInputValue } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, sleep, EVIDENCE_DIR } from "./qa16-lib.mjs";

const fx = readEvidence("fixtures");
const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = { steps: [] };
const step = (name, value) => { results.steps.push({ name, ...value }); say(`[${name}] ${JSON.stringify(value).slice(0, 400)}`); };

const JOURNEY_TITLE = "AUDIT-QA16-JOURNEY";

function expectedMetrics(project, pkgs, bidsOnPkg) {
  let total = 0;
  let usingBudget = 0;
  let deceptive = [];
  let gaps = 0;
  for (const pkg of pkgs) {
    const bids = bidsOnPkg.filter((b) => b.tradePackageId === pkg._id);
    if (!bids.length) { total += pkg.budgetEstimate || 0; usingBudget++; continue; }
    const lowestLeveled = [...bids].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost)[0];
    const lowestBase = [...bids].sort((a, b) => a.baseBidAmount - b.baseBidAmount)[0];
    for (const b of bids) {
      if (b._id !== lowestLeveled._id && b.baseBidAmount < lowestLeveled.baseBidAmount && b.leveledTotalCost > lowestLeveled.leveledTotalCost) {
        deceptive.push(b._id);
      }
    }
    total += lowestLeveled.leveledTotalCost;
  }
  for (const id of deceptive) {
    const b = bidsOnPkg.find((x) => x._id === id);
    if (b) {
      const ex = (b.identifiedExclusions || []).reduce((s, x) => s + (x.isWaived ? 0 : x.costImpact || 0), 0);
      const ve = (b.valueEngineeringAlternates || []).reduce((s, x) => s + (x.isAccepted ? x.costDeduct || 0 : 0), 0);
      gaps += ex + (b.leadTimePenalty || 0) + (b.coiPenalty || 0) - ve;
    }
  }
  return { totalBudget: project.estBudget || 0, totalLeveledBuyout: total, variance: (project.estBudget || 0) - total, deceptive: deceptive.length, gaps, usingBudget };
}

const kpiText = (page) => page.evaluate(() => (document.querySelector("main")?.innerText || "").split("\n").slice(0, 30).join("\n"));

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const cdp = await page.createCDPSession();
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa16-downloads");
  fs.mkdirSync(dlDir, { recursive: true });
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
  await page.evaluateOnNewDocument(() => {
    window.__qa16LongTasks = [];
    window.__qa16Cls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (e.duration > 50) window.__qa16LongTasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
      }).observe({ entryTypes: ["longtask"] });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__qa16Cls += e.value;
      }).observe({ entryTypes: ["layout-shift"] });
    } catch {}
  });

  const dismissTour = () => page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
    b?.click();
  });

  try {
    // ---------- CLAIMS on existing fixtures (EDGE + A) ----------
    for (const [label, pid] of [["EDGE", fx.projectEdge.id], ["A", fx.projectA.id]]) {
      await page.goto(`https://brainy-skunk-440.convex.site/?project=${pid}&tab=leveling&qa16=claims-${label}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForAppReady(page);
      await dismissTour();
      await delay(900);
      const [proj, pkgs, bids, agrs] = await Promise.all([
        c.query("projects:getProject", { projectId: pid }),
        c.query("tradePackages:listByProject", { projectId: pid }),
        c.query("bids:listAllProjectBids", { projectId: pid }),
        c.query("agreements:listAgreements", { projectId: pid }),
      ]);
      const exp = expectedMetrics(proj, pkgs, bids);
      const text = await kpiText(page);
      const kpi = {
        budget: /Budget:\s*\$?([\d,]+)/.exec(text)?.[1] || null,
        leveled: /Leveled Buyout:\s*\$?([\d,]+)/.exec(text)?.[1] || null,
        variance: /Variance:\s*([+\-$][\d,]+)/.exec(text)?.[1] || null,
        gaps: /Gaps Exposed:\s*\+?\$?([\d,]+)/.exec(text)?.[1] || null,
      };
      const awarded = pkgs.filter((p) => p.status === "awarded" || bids.some((b) => b.tradePackageId === p._id && b.isAwarded) || agrs.some((a) => a.tradePackageId === p._id && a.status !== "superseded")).length;
      step(`claims-${label}`, {
        expected: { budget: exp.totalBudget, leveled: exp.totalLeveledBuyout, variance: exp.variance, gaps: exp.gaps, awarded, total: pkgs.length, deceptive: exp.deceptive },
        ui: kpi,
        matches: {
          budget: Number(String(kpi.budget).replace(/,/g, "")) === exp.totalBudget,
          leveled: Number(String(kpi.leveled).replace(/,/g, "")) === exp.totalLeveledBuyout,
        },
        agreementStatuses: agrs.map((a) => a.status),
      });
    }

    // ---------- FULL JOURNEY on a brand-new project, Tokyo TZ ----------
    await page.emulateTimezone("Asia/Tokyo");
    await page.goto("https://brainy-skunk-440.convex.site/?tab=packages&qa16=journey", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await dismissTour();
    const perfT0 = Date.now();
    await page.evaluate(() => {
      window.localStorage.removeItem("tradepulse.selectedProjectId");
      window.localStorage.removeItem("tradepulse.selectedPackageId");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    step("cold-load", { timeToAppReadyMs: Date.now() - perfT0, nav: await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      return n ? { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null;
    }) });

    // create project via UI
    const opened = await clickButtonByText(page, "New Project");
    await delay(600);
    await setInputValue(page, 'input[aria-label="Project title"]', JOURNEY_TITLE);
    await setInputValue(page, 'input[aria-label="Project location"]', "Tokyo, Japan");
    await setInputValue(page, 'input[aria-label="Project type"]', "Data Center / Mission Critical");
    await setInputValue(page, 'input[aria-label="General contractor or contracting entity"]', "AUDIT-QA16 Tokyo GC");
    await setInputValue(page, 'input[aria-label="Estimated budget in dollars"]', "4200000");
    await setInputValue(page, 'input[aria-label="Target completion duration in weeks"]', "60");
    const specArea = await page.evaluate(() => {
      const t = document.querySelector('textarea[placeholder*="Outline high-level trade scopes"]');
      if (!t) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(t, "Division 26 electrical distribution, Division 23 HVAC mechanical, Division 22 plumbing, Division 09 drywall.");
      t.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    });
    const createClick = await clickButtonByText(page, "Create Commercial Project");
    await delay(4000);
    const created = await page.evaluate(() => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      return { value: s?.value, text: s?.options[s.selectedIndex]?.textContent?.trim() };
    });
    step("journey-create", { opened, specArea, createClick, created });
    await shot(page, "fix4-qa16-journey-created.png");

    // auto-scope via UI
    const auto = await clickButtonByText(page, "AI Spec Breakdown");
    await delay(700);
    const sample = await clickButtonByText(page, "Load 4-Trade MEP Sample");
    await delay(300);
    const gen = await clickButtonByText(page, "Auto-Generate Trade Packages");
    let genState = null;
    for (let i = 0; i < 60; i++) {
      await delay(2000);
      genState = await page.evaluate(() => {
        const t = document.body.innerText;
        const ok = /packages? (created|generated|scoped)|Auto-scoped|inboxes provisioned/i.test(t);
        const err = /Specification breakdown failed|Auto-scoping failed|failed:/i.test(t);
        return { ok, err, snippet: (t.match(/.{0,80}(created|failed|scoped).{0,80}/i) || [null])[0] };
      });
      if (genState.ok || genState.err) break;
      if (i % 5 === 4) {
        const pk = await c.query("tradePackages:listByProject", { projectId: created.value });
        if ((pk || []).length > 0) { genState.packagesSeen = pk.length; break; }
      }
    }
    const jPkgs = (await c.query("tradePackages:listByProject", { projectId: created.value })) || [];
    step("journey-autoscope", { auto, sample, gen, genState, packages: jPkgs.map((p) => ({ csi: p.csiDivision, name: p.tradeName, budget: p.budgetEstimate })) });
    await shot(page, "fix4-qa16-journey-autoscope.png");

    let journeyPkg = jPkgs[0] || null;
    let journeyBidInfo = null;
    if (journeyPkg) {
      const c1 = await c.mutation("contractors:createContractor", {
        tradePackageId: journeyPkg._id, companyName: "AUDIT-QA16 Journey Clean Co", contactEmail: "qa16.j1@qa16.invalid",
        phone: "+81 3 5555 0101", licenseNumber: "JP-QA16-1", licenseStatus: "Active / Verified (QA16)", sourceUrl: "https://qa16.example.invalid/j1", rfqStatus: "invited",
      });
      const c2 = await c.mutation("contractors:createContractor", {
        tradePackageId: journeyPkg._id, companyName: "AUDIT-QA16 Journey Deceptive Co", contactEmail: "qa16.j2@qa16.invalid",
        phone: "+81 3 5555 0102", licenseNumber: "JP-QA16-2", licenseStatus: "Active / Verified (QA16)", sourceUrl: "https://qa16.example.invalid/j2", rfqStatus: "invited",
      });
      const clean = await c.mutation("bids:submitDirectBid", {
        tradePackageId: journeyPkg._id, contractorId: c1, subcontractorName: "AUDIT-QA16 Journey Clean Co",
        baseBidAmount: 1_200_000, lineItems: [{ item: "Full scope", unit: "LS", quantity: 1, unitCost: 1_200_000, totalCost: 1_200_000 }],
        longLeadEquipmentWeeks: 8, coiComplianceStatus: "compliant",
      });
      const deceptive = await c.mutation("bids:submitDirectBid", {
        tradePackageId: journeyPkg._id, contractorId: c2, subcontractorName: "AUDIT-QA16 Journey Deceptive Co",
        baseBidAmount: 900_000, lineItems: [{ item: "Base only", unit: "LS", quantity: 1, unitCost: 900_000, totalCost: 900_000 }],
        identifiedExclusions: [{ description: "QA16 omitted switchgear", costImpact: 400_000, severity: "high" }],
        longLeadEquipmentWeeks: 8, coiComplianceStatus: "compliant",
      });
      journeyBidInfo = { clean: clean.bidId, deceptive: deceptive.bidId };
      await delay(1500);
    }
    step("journey-bids", journeyBidInfo || { skipped: true });

    // leveling claims + CSV
    if (journeyPkg) {
      await clickButtonByText(page, "Bid Leveling");
      await delay(900);
      const text = await kpiText(page);
      const [proj, pkgs, bids] = await Promise.all([
        c.query("projects:getProject", { projectId: created.value }),
        c.query("tradePackages:listByProject", { projectId: created.value }),
        c.query("bids:listAllProjectBids", { projectId: created.value }),
      ]);
      const exp = expectedMetrics(proj, pkgs, bids);
      const ui = {
        leveled: /Leveled Buyout:\s*\$?([\d,]+)/.exec(text)?.[1] || null,
        variance: /Variance:\s*([+\-$][\d,]+)/.exec(text)?.[1] || null,
        gaps: /Gaps Exposed:\s*\+?\$?([\d,]+)/.exec(text)?.[1] || null,
        deceptiveFlag: /Deceptive Low Bid/i.test(text),
      };
      step("journey-claims", { expected: exp, ui, matches: {
        leveled: Number(String(ui.leveled).replace(/,/g, "")) === exp.totalLeveledBuyout,
        gaps: Number(String(ui.gaps).replace(/,/g, "")) === exp.gaps,
        deceptive: ui.deceptiveFlag === (exp.deceptive > 0),
      } });
      const beforeFiles = fs.readdirSync(dlDir).length;
      const csvClick = await clickButtonByText(page, "Export Leveling CSV");
      await delay(1500);
      const files = fs.readdirSync(dlDir).filter((f) => f.endsWith(".csv"));
      const newest = files.sort((a, b) => fs.statSync(path.join(dlDir, b)).mtimeMs - fs.statSync(path.join(dlDir, a)).mtimeMs)[0];
      const csv = newest ? fs.readFileSync(path.join(dlDir, newest), "utf8") : "";
      step("journey-csv", { csvClick, newFiles: fs.readdirSync(dlDir).length - beforeFiles, newest, hasClean: csv.includes("Journey Clean Co"), hasDeceptive: csv.includes("Journey Deceptive Co"), rows: csv.split("\r\n").length - 2 });
      await shot(page, "fix4-qa16-journey-leveling.png", { full: true });
    }

    // award with a same-tick double click (harshest race) then a 120ms double mouse click
    if (journeyPkg) {
      const before = (await c.query("agreements:listAgreements", { projectId: created.value })).length;
      const dbl = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Award Compliant Winner"));
        if (!b) return { ok: false };
        b.click(); b.click();
        return { ok: true, disabledAfter: b.disabled };
      });
      await delay(2500);
      const after = await c.query("agreements:listAgreements", { projectId: created.value });
      const logs = await c.query("auditLogs:listRecentLogs", { projectId: created.value, limit: 200 });
      const awardTitles = logs.filter((l) => /Awarded|Re-Awarded|Re-Awarded/.test(l.title)).map((l) => l.title);
      step("journey-award-double", { before, after: after.length, statuses: after.map((a) => a.status), awardLogTitles: awardTitles, dbl });
      await shot(page, "fix4-qa16-journey-award.png");
    }

    // execute via UI
    if (journeyPkg) {
      await delay(500);
      await clickButtonByText(page, "Subcontracts");
      await delay(900);
      const rec = await clickButtonByText(page, "Record Execution Status");
      await delay(500);
      const confirm = await clickButtonByText(page, "Record execution", { exact: true });
      await delay(2200);
      const agrs = await c.query("agreements:listAgreements", { projectId: created.value });
      step("journey-execute", { rec, confirm, statuses: agrs.map((a) => ({ n: a.agreementNumber, s: a.status })) });
      await shot(page, "fix4-qa16-journey-contracts.png");
    }

    // audit stream claims
    {
      await clickButtonByText(page, "Live Activity Audit");
      await delay(1100);
      const auditText = await page.evaluate(() => (document.querySelector("main")?.innerText || "").slice(0, 20000));
      const logs = (await c.query("auditLogs:listRecentLogs", { projectId: created.value, limit: 500 })) || [];
      const titles = logs.map((l) => l.title);
      const missing = titles.filter((t) => !auditText.includes(t.slice(0, 40))).slice(0, 5);
      step("journey-audit", { backendLogCount: titles.length, missingFromUi: missing, uiHasFakeExample: /example\.com|fake/i.test(auditText) });
    }

    const perf = await page.evaluate(() => ({ longTasks: window.__qa16LongTasks || [], cls: window.__qa16Cls || 0 }));
    step("perf", { longTaskCount: perf.longTasks.length, worst: perf.longTasks.sort((a, b) => b.dur - a.dur).slice(0, 5), cls: Math.round(perf.cls * 10000) / 10000, pageErrors: diag.pageErrors.length, consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").length });
  } finally {
    await browser.close();
  }

  writeEvidence("journey-claims", results);
  writeLog("journey-claims", log);
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  writeLog("journey-claims-crash", [String(e && e.stack ? e.stack : e)]);
  process.exit(1);
});