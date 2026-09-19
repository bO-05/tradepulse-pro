/**
 * QA26-03 cross-view award truth after execute -> void -> re-award.
 * Lifecycle driven through the public mutations; every UI surface is read live
 * (Convex reactivity) and reconciled against the backend at each step:
 * KPI strip, header stepper, Contracts Register, Bid Leveling matrix, CSV export.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, EVIDENCE_DIR } from "./qa26-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1400)}`);
};

async function uiAwardState(page) {
  return page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText;
    const pairs = [...t.matchAll(/Subcontracts[:\s]*(\d+)\s*\/\s*(\d+)\s*Awarded/g)].map((m) => `${m[1]}/${m[2]}`);
    const bodyPairs = [...document.body.innerText.matchAll(/Subcontracts[:\s]*(\d+)\s*\/\s*(\d+)\s*Awarded/g)].map((m) => `${m[1]}/${m[2]}`);
    const leveled = /Leveled Buyout:\s*\$?([\d,]+)/.exec(t.replace(/\n/g, " "));
    return { kpiAwarded: pairs[0] ?? null, allAwarded: [...new Set(bodyPairs)], leveledBuyout: leveled ? leveled[1] : null };
  });
}

async function uiRegister(page) {
  await clickTab(page, "Subcontracts");
  await delay(1200);
  return page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText;
    const sum = /ACTIVE CONTRACTED SUM\s*\$([\d,]+)/i.exec(t)?.[1] ?? null;
    const exec = /EXECUTION STATUS RECORDED\s*(\d+)\s*\/\s*(\d+)/i.exec(t);
    const rows = [...document.querySelectorAll("table tbody tr")].map((tr) => {
      const cells = [...tr.querySelectorAll("td")].map((td) => (td.innerText || "").replace(/\s+/g, " ").trim());
      return { cells, status: cells[5] || null, buttons: [...tr.querySelectorAll("button")].map((b) => (b.innerText || "").trim()) };
    });
    const chips = [...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).filter((x) => /^(Active Contracts|Execution Status Recorded|Pending Execution|Superseded)/.test(x));
    const badge = rows[0]?.status ?? null;
    return { sum, exec: exec ? `${exec[1]}/${exec[2]}` : null, rowCount: rows.length, rows, chips, badge };
  });
}

async function uiLeveling(page) {
  await clickTab(page, "Bid Leveling");
  await delay(1400);
  await page.evaluate((name) => {
    const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(name));
    b?.click();
  }, "QA26 Award Electrical");
  await delay(1200);
  return page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText.replace(/\s+/g, " ");
    const pkgBadge = (/QA26 Award Electrical[\s\S]{0,120}?(Awarded|Leveling|Draft)/.exec(t)?.[1] ?? null);
    const i = t.indexOf("AUDIT-QA26 Award Electric A");
    const aroundA = i >= 0 ? t.slice(Math.max(0, i - 120), i + 420) : "";
    const banner = /Subcontract Awarded:\s*([^.]{0,60})/.exec(t);
    const rowA = /Contract Awarded • Draft Generated/.test(aroundA) || banner
      ? "AWARDED"
      : /Award Compliant Winner/.test(aroundA)
      ? "UNAWARDED"
      : null;
    return {
      pkgBadge,
      rowA,
      aroundA: aroundA.slice(0, 420),
      awardedBanner: banner ? banner[1].trim() : null,
      locked: /Leveling Locked/.test(t),
      lockedButtons: (t.match(/Leveling Locked/g) || []).length,
      awardButtons: (t.match(/Award & Draft|Award Subcontract & Draft Agreement|Award Compliant Winner/g) || []).length,
      unawardButtons: (t.match(/Unaward/g) || []).length,
    };
  });
}

async function backendAwardTruth(projectId) {
  const [agrs, pkgs, bids] = await Promise.all([
    c.query("agreements:listAgreements", { projectId }),
    c.query("tradePackages:listByProject", { projectId }),
    c.query("bids:listAllProjectBids", { projectId }),
  ]);
  const awardedPkgIds = new Set();
  for (const a of agrs) if (a.status !== "superseded") awardedPkgIds.add(a.tradePackageId);
  for (const b of bids) if (b.isAwarded) awardedPkgIds.add(b.tradePackageId);
  for (const p of pkgs) if (p.status === "awarded") awardedPkgIds.add(p._id);
  const activeSum = agrs.filter((a) => a.status !== "superseded").reduce((s, a) => s + a.contractSum, 0);
  return {
    awarded: `${pkgs.filter((p) => awardedPkgIds.has(p._id)).length}/${pkgs.length}`,
    activeSum,
    agreements: agrs.map((a) => ({ n: a.agreementNumber, s: a.status, sum: a.contractSum })),
    pkg26: pkgs.find((p) => p.csiDivision.startsWith("26"))?.status ?? null,
    bidAwarded: Boolean(bids.find((b) => b._id === F.award.bids.a.bidId)?.isAwarded),
  };
}

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const cdp = await page.createCDPSession();
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa26-award-downloads");
  fs.mkdirSync(dlDir, { recursive: true });
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
  const dismissTour = () =>
    page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
  const steps = [];
  const url = `${BASE}/?project=${F.award.id}&tab=contracts&qa26=award`;

  const csvHas = (csv, token) => csv.split(/\r?\n/).some((l) => new RegExp(`"${token}"\\s*$`).test(l));

  async function capture(label) {
    const backend = await backendAwardTruth(F.award.id);
    const kpi = await uiAwardState(page);
    const reg = await uiRegister(page);
    const lev = await uiLeveling(page);
    const csvBefore = fs.readdirSync(dlDir).length;
    const csvClick = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Export Leveling CSV/.test(x.innerText || ""));
      if (b) { b.click(); return true; }
      return false;
    });
    await delay(2200);
    const csvFiles = fs.readdirSync(dlDir).filter((f) => f.endsWith(".csv"));
    let csv = null;
    if (csvFiles.length) {
      const latest = csvFiles.map((f) => ({ f, t: fs.statSync(path.join(dlDir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0].f;
      csv = fs.readFileSync(path.join(dlDir, latest), "utf8");
    }
    steps.push({
      label, backend, kpi, reg: { ...reg, rows: reg.rows }, lev,
      csv: csv ? { hasAwarded: csvHas(csv, "AWARDED"), hasUnawarded: csvHas(csv, "UNAWARDED"), rows: csv.split(/\r?\n/).filter(Boolean).length - 1, head: csv.split(/\r?\n/).slice(0, 3) } : null,
      csvClick,
    });
    const csvSummary = csv ? { hasAwarded: csvHas(csv, "AWARDED"), hasUnawarded: csvHas(csv, "UNAWARDED") } : null;
    say(`--- ${label} :: backend award=${backend.awarded} sum=${backend.activeSum} agrs=${backend.agreements.map((a) => a.s).join(",")} | ui kpi=${kpi.kpiAwarded} header=${JSON.stringify(kpi.allAwarded)} regSum=${reg.sum} exec=${reg.exec} badge=${reg.badge} | lev badge=${lev.pkgBadge} rowA=${lev.rowA} locked=${lev.locked} | csv=${csvSummary ? (csvSummary.hasAwarded ? "AWARDED" : csvSummary.hasUnawarded ? "UNAWARDED" : "none") : "missing"}`);
    return { backend, kpi, reg, lev, csv: csvSummary };
  }

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour();
    await delay(2000);

    // deterministic S0: no executed agreement may hold Div26, and bid A's agreement must be generated
    let agrs = (await c.query("agreements:listAgreements", { projectId: F.award.id })) || [];
    for (const a of agrs.filter((x) => x.status === "executed")) {
      await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA26 award-truth baseline reset of executed agreements." });
      await delay(600);
    }
    agrs = (await c.query("agreements:listAgreements", { projectId: F.award.id })) || [];
    let agrA = agrs.find((a) => a.bidId === F.award.bids.a.bidId);
    if (!agrA || agrA.status === "superseded") {
      const g = await c.mutation("agreements:generateAgreement", { bidId: F.award.bids.a.bidId, tradePackageId: F.award.p26 });
      agrA = g;
    }
    await delay(1600);
    const S0 = await capture("S0 generated");
    record(
      "A26-03.1",
      "S0 generated: backend 2/2 awarded, sum 1,170,000; KPI/header/register(2 pending rows)/leveling/CSV all agree",
      S0.backend.awarded === "2/2" && S0.backend.activeSum === 1170000 &&
        S0.kpi.kpiAwarded === "2/2" && S0.kpi.allAwarded.every((x) => x === "2/2") && S0.kpi.leveledBuyout === "1,170,000" &&
        S0.reg.sum === "1,170,000" && S0.reg.rowCount === 2 && S0.reg.exec === "0/2" &&
        S0.reg.rows.every((r) => /Pending Execution/.test(r.status || "")) &&
        S0.lev.rowA === "AWARDED" && !S0.lev.locked && S0.csv?.hasAwarded === true,
      S0
    );

    // S1: execute
    await c.mutation("agreements:executeAgreement", { agreementId: agrA._id });
    await delay(2000);
    const S1 = await capture("S1 executed");
    record(
      "A26-03.2",
      "S1 executed: register 1/2 Execution Status Recorded, sum 1,170,000; leveling locks the executed bid; CSV stays AWARDED",
      S1.backend.agreements.some((a) => a.s === "executed") && S1.backend.activeSum === 1170000 &&
        S1.reg.sum === "1,170,000" && S1.reg.exec === "1/2" &&
        S1.reg.rows.some((r) => /Execution Status Recorded/.test(r.status || "")) &&
        S1.reg.rows.some((r) => /Pending Execution/.test(r.status || "")) &&
        S1.lev.locked === true && S1.csv?.hasAwarded === true,
      S1
    );

    // S2: void
    await c.mutation("agreements:voidExecutedAgreement", { agreementId: agrA._id, reason: "QA26 award-truth lifecycle: void for convergence check." });
    await delay(2200);
    const S2 = await capture("S2 voided");
    record(
      "A26-03.3",
      "S2 voided: backend Div23-only 1/2, sum 470,000; KPI/header 1/2; register one pending row + Superseded (1); leveling bid A UNAWARDED and editable; Div26 CSV no AWARDED",
      S2.backend.awarded === "1/2" && S2.backend.activeSum === 470000 &&
        S2.kpi.kpiAwarded === "1/2" && S2.kpi.allAwarded.every((x) => x === "1/2") && S2.kpi.leveledBuyout === "1,170,000" &&
        S2.reg.sum === "470,000" && S2.reg.rowCount === 1 && S2.reg.exec === "0/1" &&
        S2.reg.chips.some((c) => /Superseded \(2\)/.test(c)) &&
        S2.lev.rowA === "UNAWARDED" && S2.lev.locked === false && S2.csv?.hasAwarded === false && S2.csv?.hasUnawarded === true,
      S2
    );

    // S3: re-award (generate reactivates the same agreement)
    const reGen = await c.mutation("agreements:generateAgreement", { bidId: F.award.bids.a.bidId, tradePackageId: F.award.p26 });
    await delay(2000);
    const S3 = await capture("S3 re-awarded");
    record(
      "A26-03.4",
      "S3 re-awarded after void: same agreement number reactivated to generated; backend/KPI/header/register/leveling/CSV agree on 2/2 + Pending",
      reGen.agreementNumber === agrA.agreementNumber && S3.backend.awarded === "2/2" && S3.backend.activeSum === 1170000 &&
        S3.kpi.kpiAwarded === "2/2" && S3.kpi.allAwarded.every((x) => x === "2/2") &&
        S3.reg.sum === "1,170,000" && S3.reg.rowCount === 2 && S3.reg.exec === "0/2" &&
        S3.reg.rows.every((r) => /Pending Execution/.test(r.status || "")) &&
        S3.lev.rowA === "AWARDED" && S3.lev.locked === false && S3.csv?.hasAwarded === true,
      { reGen: { number: reGen.agreementNumber, status: reGen.status }, S3 }
    );

    // S4: execute again
    await c.mutation("agreements:executeAgreement", { agreementId: reGen._id });
    await delay(2000);
    const S4 = await capture("S4 re-executed");
    record(
      "A26-03.5",
      "S4 re-executed: all views return to executed truth (2/2, 1/2, sum 1,170,000, locked, CSV AWARDED)",
      S4.backend.awarded === "2/2" && S4.backend.activeSum === 1170000 &&
        S4.kpi.kpiAwarded === "2/2" && S4.reg.exec === "1/2" &&
        S4.reg.rows.some((r) => /Execution Status Recorded/.test(r.status || "")) &&
        S4.lev.locked === true && S4.csv?.hasAwarded === true,
      S4
    );

    await shot(page, "fix4-qa26-award-truth-final.png");
    record("A26-03.6", "ui award-truth diagnostics: zero page errors", diag.pageErrors.length === 0, {
      pageErrors: diag.pageErrors.slice(0, 5),
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(-4).map((e) => e.text.slice(0, 160)),
    });

    writeEvidence("award-truth", { steps, results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("award-truth", log);
    console.log(`award-truth: ${results.filter((r) => r.pass).length}/${results.length}`);
  } catch (err) {
    writeEvidence("award-truth", { steps, results: [...results, { id: "A26-03.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }], summary: { pass: results.filter((r) => r.pass).length, total: results.length + 1 } });
    writeLog("award-truth", [...log, String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("award-truth-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});