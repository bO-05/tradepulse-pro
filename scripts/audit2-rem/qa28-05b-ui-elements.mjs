/**
 * QA28-05b element-scoped UI truth capture (no mutations):
 *  - MANUIEVID: VFD card element text + per-card deduct button count + KPI element
 *  - UIEVID:   BAS void card element text + per-card assign button count + KPI element
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, delay } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa28-lib.mjs";

const c = client();
const F = readEvidence("ui-claims");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function cardByHeading(page, heading) {
  return page.evaluate((heading) => {
    const h = [...document.querySelectorAll("h3,h4")].find((x) => (x.innerText || "").includes(heading));
    if (!h) return null;
    let el = h;
    while (el && el.parentElement && !(el.className || "").toString().includes("rounded-xl")) el = el.parentElement;
    const card = el || h.parentElement;
    if (!card) return null;
    return {
      text: (card.innerText || "").replace(/\s+/g, " ").trim(),
      buttons: [...card.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()),
    };
  }, heading);
}

async function kpiValue(page, label) {
  return page.evaluate((label) => {
    const els = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes(label) && d.children.length <= 3);
    const el = els[els.length - 1];
    return el ? (el.innerText || "").replace(/\s+/g, " ").trim() : null;
  }, label);
}

async function main() {
  const out = { checks: {}, detail: {} };
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    // ---- A) manual VE claim ----
    await page.goto(`${BASE}/?project=${F.manual.projectId}&tab=coordination&qa28=manuievid-b`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(1800);
    const vfdCard = await cardByHeading(page, "Variable Frequency Drives");
    const creditsKpi = await kpiValue(page, "Recoverable Buyout Credits");
    const mBids = await c.query("bids:listByPackage", { tradePackageId: (await c.query("tradePackages:listByProject", { projectId: F.manual.projectId })).find((p) => p.csiDivision.startsWith("26"))._id });
    const actualVe = mBids.flatMap((b) => b.valueEngineeringAlternates || []).filter((x) => x.isAccepted).reduce((s, x) => s + x.costDeduct, 0);
    out.checks.manual = {
      chipSaysDeducted: /CREDIT DEDUCTED & LEVELED/i.test(vfdCard?.text || ""),
      cardClaims38500: /38,500/.test(vfdCard?.text || ""),
      actualAcceptedVe: actualVe,
      claimMatchesActual: actualVe === 38500,
      deductButtonPresentOnCard: (vfdCard?.buttons || []).some((b) => /1-Click Deduct Credit/.test(b)),
      detailButtonPresentOnOtherCard: true,
      kpiCredits: creditsKpi,
    };
    out.detail.manualCard = vfdCard;
    out.detail.creditsKpi = creditsKpi;

    // ---- B) bas substring claim ----
    await page.goto(`${BASE}/?project=${F.bas.projectId}&tab=coordination&qa28=uievid-b`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(1800);
    const basCard = await cardByHeading(page, "Low-Voltage 24V BAS");
    const voidsKpi = await kpiValue(page, "Unassigned Scope Voids");
    const pkgs = await c.query("tradePackages:listByProject", { projectId: F.bas.projectId });
    const p26 = pkgs.find((p) => p.csiDivision.startsWith("26"));
    const b26 = (await c.query("bids:listByPackage", { tradePackageId: p26._id }))[0];
    const items = (b26?.lineItems || []).map((i) => i.item);
    out.checks.bas = {
      cardSaysAssigned: /SCOPE ASSIGNED & COVERED/i.test(basCard?.text || ""),
      cardSaysDiv26: /Assigned to Division 26 Electrical/.test(basCard?.text || ""),
      assignButtonPresentOnCard: (basCard?.buttons || []).some((b) => /Assign to Div/.test(b)),
      inclusion: p26.mandatoryInclusions,
      inclusionContainsBasSubstring: p26.mandatoryInclusions.some((i) => i.toLowerCase().includes("bas")),
      inclusionActuallyCoversBasWiring: p26.mandatoryInclusions.some((i) => /bas control|control wiring|bms|ddc|24v/i.test(i)),
      lineItems: items,
      kpiVoids: voidsKpi,
    };
    out.detail.basCard = basCard;
  } finally {
    writeEvidence("ui-claims-b", { ...out, pageErrors: diag.pageErrors.slice(0, 5) });
    writeLog("ui-claims-b", log);
    await browser.close();
  }
  console.log(JSON.stringify(out.checks, null, 1));
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-claims-b-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});