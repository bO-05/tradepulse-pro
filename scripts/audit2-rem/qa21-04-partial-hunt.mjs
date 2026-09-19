/**
 * QA21-04 HUNT A21-01: partial-priced project UI exposure.
 * STAGED has a Div 26 bid and a Div 23 package with ZERO proposals. The scan
 * action refuses, but the Coordination KPI/clash cards are fed by
 * detectCrossTradeClashes, which still returns the static benchmark set.
 * NOHVAC (no Div 23 package at all) is the control: engine empty, KPIs $0.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa21-lib.mjs";

const F = readEvidence("01-fixtures");
const S = readEvidence("02-scan-backend");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1000)}`);
};

async function kpi(page) {
  return page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText;
    const grab = (label) => {
      const i = t.indexOf(label);
      return i >= 0 ? t.slice(i, i + 80).replace(/\s+/g, " ") : null;
    };
    return {
      doubleBuyKpi: grab("Redundant Double-Buys"),
      voidKpi: grab("Unassigned Scope Voids"),
      hasVfdCard: /Variable Frequency Drives \(VFDs\)/i.test(t),
      hasDisconnectCard: /Disconnect Switches/i.test(t),
      hasBasVoidCard: /BAS Control/i.test(t),
      bodyHead: t.replace(/\s+/g, " ").slice(0, 600),
    };
  });
}

async function openAndScan(page, projectId, tag) {
  await page.goto(`${BASE}/?project=${projectId}&tab=coordination&qa21=${tag}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(2000);
  const before = await kpi(page);
  const click = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Run Forensic Clash Scan"));
    if (!b) return { ok: false };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true };
  });
  let banner = null;
  for (let i = 0; i < 40 && !banner; i++) {
    await delay(300);
    banner = await page.evaluate(() => {
      const d = [...document.querySelectorAll("div")].find((x) => String(x.className || "").includes("bg-emerald-950/40"));
      return d ? (d.textContent || "").replace(/\s+/g, " ").trim() : null;
    });
  }
  return { before, click, banner };
}

async function main() {
  const c = client();
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  // ---- Control: NOHVAC (no Div 23 package) => engine empty, KPIs $0 ----
  const nohvac = await openAndScan(page, F.nohvac.id, "partial-control");
  const nohvacDetect = await c.query("coordination:detectCrossTradeClashes", { projectId: F.nohvac.id });
  record(
    "A19-02.nohvac-ui-no-invented",
    "control: no-Div-23 project shows no clash cards and $0 KPIs",
    (nohvacDetect?.doubleBuys || []).length === 0 &&
      !nohvac.before.hasVfdCard &&
      !nohvac.before.hasDisconnectCard &&
      /Redundant Double-Buys\s*\$0/.test(nohvac.before.doubleBuyKpi || "") &&
      /Unassigned Scope Voids\s*\$0/.test(nohvac.before.voidKpi || "") &&
      /needs both a Division 26/i.test(nohvac.banner || ""),
    { detect: { buys: (nohvacDetect?.doubleBuys || []).length, voids: (nohvacDetect?.scopeVoids || []).length }, banner: nohvac.banner, before: nohvac.before }
  );

  // ---- HUNT: STAGED (Div 26 bid only, Div 23 zero bids) ----
  const staged = await openAndScan(page, S.staged.id, "partial-hunt");
  const stagedDetect = await c.query("coordination:detectCrossTradeClashes", { projectId: S.staged.id });
  await shot(page, "fix4-qa21-partial-hunt.png");
  const uiClaims = /Redundant Double-Buys\s*\$50,500/.test(staged.before.doubleBuyKpi || "") ||
    /Unassigned Scope Voids\s*\$46,500/.test(staged.before.voidKpi || "") ||
    staged.before.hasVfdCard || staged.before.hasDisconnectCard;
  record(
    "A21-01.partial-ui-benchmark-claims",
    "HUNT: one-sided priced project shows benchmark clash cards/KPIs while the scan itself refuses",
    !uiClaims,
    {
      stagedProjectId: S.staged.id,
      hvacProposals: 0,
      elecProposals: 1,
      kpi: { doubleBuys: staged.before.doubleBuyKpi, voids: staged.before.voidKpi },
      clashCards: { vfd: staged.before.hasVfdCard, disconnect: staged.before.hasDisconnectCard, basVoid: staged.before.hasBasVoidCard },
      scanBanner: staged.banner,
      engineClaims: {
        buys: (stagedDetect?.doubleBuys || []).filter((d) => d.status === "detected").map((d) => ({ id: d.id, amount: d.redundantAmount })),
        voids: (stagedDetect?.scopeVoids || []).filter((v) => v.status === "open").map((v) => ({ id: v.id, amount: v.estimatedVoidCost })),
      },
      note: "The scan banner correctly refuses (analyzed:false) but the KPI/cards above it still assert $50,500 redundant double-buys and $46,500 scope voids with zero HVAC proposals.",
    }
  );

  const out = { results, pageErrors: diag.pageErrors.slice(0, 5), summary: { pass: results.filter((r) => r.pass).length, total: results.length } };
  writeEvidence("04-partial-hunt", out);
  writeLog("04-partial-hunt", log);
  await browser.close();
  console.log(`partial hunt: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("04-partial-hunt-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});