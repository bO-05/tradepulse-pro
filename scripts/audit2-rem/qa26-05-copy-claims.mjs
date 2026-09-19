/**
 * QA26-05 copy-claim reconciliation across tabs after the round-10 fixes:
 *  - Coordination numbers vs persisted detect totals
 *  - KPI/header vs backend procurement truth
 *  - Contracts register status labels vs agreements
 *  - Activity Audit wording vs actual agreement status (candidate A26-01)
 */
import { launchBrowser, waitForAppReady, shot, delay, clickTab } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa26-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};

async function tabText(page) {
  return page.evaluate(() => (document.querySelector("main") || document.body).innerText);
}

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const dismissTour = () =>
    page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
  try {
    await page.goto(`${BASE}/?project=${F.award.id}&tab=coordination&qa26=copy`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour();
    await delay(2000);

    const d = await c.query("coordination:detectCrossTradeClashes", { projectId: F.award.id });
    const buyTotal = d.doubleBuys.reduce((s, x) => s + (x.redundantAmount || 0), 0);
    const voidTotal = d.scopeVoids.reduce((s, x) => s + (x.estimatedVoidCost || 0), 0);

    await clickTab(page, "Scope Clash");
    await delay(1800);
    const coord = await tabText(page);
    const coordNorm = coord.replace(/\s+/g, " ");
    const coordNums = {
      buys: /\$([\d,]+)\s*(\d+) equipment items priced by both trades/i.exec(coordNorm) ?? null,
      voids: /\$([\d,]+)\s*(\d+) critical gaps excluded by both trades/i.exec(coordNorm) ?? null,
      credits: /Recoverable Buyout Credits[\s\S]{0,40}?\$([\d,]+)/.exec(coordNorm) ?? null,
      awaiting: /(\d+)\s+(?:items?|clash(?:es)?)\s+awaiting resolution/i.exec(coordNorm) ?? null,
    };
    const coordOk =
      coordNums.buys && Number(coordNums.buys[1].replace(/,/g, "")) === buyTotal && Number(coordNums.buys[2]) === d.doubleBuys.length &&
      coordNums.voids && Number(coordNums.voids[1].replace(/,/g, "")) === voidTotal && Number(coordNums.voids[2]) === d.scopeVoids.length &&
      coordNums.credits && coordNums.credits[1] === "0";
    record(
      "A26-05.1",
      "Scope Clash tab numbers reconcile with persisted detect totals (no claim inflation)",
      Boolean(coordOk),
      { backend: { buys: d.doubleBuys.length, buyTotal, voids: d.scopeVoids.length, voidTotal, credits: 0 }, ui: coordNums, snippet: coordNorm.slice(0, 300) }
    );
    await shot(page, "fix4-qa26-copy-coordination.png");

    const kpi = await page.evaluate(() => (document.querySelector("main")?.innerText || "").split("\n").slice(0, 8).join(" "));
    const kpiLeveled = /Leveled Buyout:\s*\$?([\d,]+)/.exec(kpi)?.[1] ?? null;
    const kpiAward = /Subcontracts:\s*(\d+)\/(\d+)\s*Awarded/.exec(kpi);
    record(
      "A26-05.2",
      "KPI strip leveled buyout equals effective-bid sum; Subcontracts counts equal backend award truth",
      kpiLeveled === "1,170,000" && kpiAward && `${kpiAward[1]}/${kpiAward[2]}` === "2/2",
      { kpi, kpiLeveled, kpiAward: kpiAward ? `${kpiAward[1]}/${kpiAward[2]}` : null }
    );

    await clickTab(page, "Subcontracts");
    await delay(1500);
    const reg = await page.evaluate(() => {
      const t = document.body.innerText;
      const sum = /ACTIVE CONTRACTED SUM\s*\$([\d,]+)/i.exec(t)?.[1] ?? null;
      const rows = [...document.querySelectorAll("table tbody tr")].map((tr) => {
        const cells = [...tr.querySelectorAll("td")].map((td) => (td.innerText || "").replace(/\s+/g, " ").trim());
        return { n: cells[0], name: cells[1], status: cells[5] };
      });
      return { sum, rows };
    });
    record(
      "A26-05.3",
      "Contracts register sum/statuses agree with agreements (generated = Pending Execution)",
      reg.sum === "1,170,000" && reg.rows.some((r) => r.status?.includes("Pending Execution")) && reg.rows.some((r) => r.status?.includes("Execution Status Recorded")),
      reg
    );

    await clickTab(page, "Live Activity Audit");
    await delay(2200);
    const audit = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("div")].filter((d) => /AIA A401 Subcontract Agreement Awarded/.test(d.innerText || ""));
      const text = (document.querySelector("main") || document.body).innerText;
      const idx = text.indexOf("Executed subcontract agreement");
      return {
        hasExecutedClaim: idx >= 0,
        context: idx >= 0 ? text.slice(Math.max(0, idx - 320), idx + 220).replace(/\n/g, " | ") : null,
        awardTitles: (text.match(/AIA A401 Subcontract Agreement Awarded: [^\n]+/g) || []).slice(0, 4),
        cardCount: cards.length,
      };
    });
    const agrs = (await c.query("agreements:listAgreements", { projectId: F.award.id })) || [];
    const genD = agrs.find((a) => a.bidId === F.award.bids.d.bidId);
    const contradictions = agrs
      .filter((a) => a.status === "generated")
      .map((a) => ({ number: a.agreementNumber, status: a.status, auditClaimsExecuted: audit.context?.includes(a.agreementNumber) ?? false }));
    record(
      "A26-05.4",
      "Activity Audit shows 'Executed subcontract agreement ...' for an agreement the register still lists as Pending Execution (candidate A26-01)",
      audit.hasExecutedClaim && audit.awardTitles.length >= 1 && genD?.status === "generated" && contradictions.some((x) => x.auditClaimsExecuted),
      { audit, generatedAgreements: contradictions, note: "The audit row is written at award/generation time; execution is recorded separately later." }
    );
    await shot(page, "fix4-qa26-copy-audit-executed-claim.png");

    writeEvidence("copy-claims", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("copy-claims", log);
    console.log(`copy-claims: ${results.filter((r) => r.pass).length}/${results.length}`);
  } catch (err) {
    writeEvidence("copy-claims", { results: [...results, { id: "A26-05.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }], summary: { pass: results.filter((r) => r.pass).length, total: results.length + 1 } });
    writeLog("copy-claims", log);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("copy-claims-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});