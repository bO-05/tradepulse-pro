/**
 * QA21-03: UI "Run Forensic Clash Scan" behavior (A19-02):
 *  - NOHVAC (only Div 26, no Div 23)  -> prerequisite message, no invented amounts
 *  - NOBIDS (both packages, no bids)  -> prerequisite message, no invented amounts
 *  - FULL   (both packages, 1 bid ea) -> computed summary matching detectCrossTradeClashes
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, sleep } from "./qa21-lib.mjs";

const F = readEvidence("01-fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 900)}`);
};

// Static benchmark figures that must NOT appear on a project with no priced evidence.
const BENCHMARK_ONLY = /38,500|12,000|28,000|18,500|VFD|Variable Frequency|disconnect switch|BAS control|smoke detector/i;
const usd = (n) => `$${n.toLocaleString("en-US")}`;
const usdTokens = (text) => (String(text || "").match(/\$[\d,]+/g) || []).slice().sort();

async function expectedFullMessage(c, projectId) {
  const detected = await c.query("coordination:detectCrossTradeClashes", { projectId });
  const buys = (detected?.doubleBuys || []).filter((d) => d.status === "detected");
  const voids = (detected?.scopeVoids || []).filter((v) => v.status === "open");
  const buyAmount = buys.reduce((s, d) => s + (d.redundantAmount || 0), 0);
  const voidAmount = voids.reduce((s, v) => s + (v.estimatedVoidCost || 0), 0);
  return {
    expected:
      buys.length + voids.length === 0
        ? "Cross-trade scan complete: no double-buys or scope voids detected between Division 26 and Division 23."
        : `Cross-trade scan complete: ${buys.length} double-buy item(s) worth ${usd(buyAmount)} and ${voids.length} open scope void(s) worth ${usd(voidAmount)}.`,
    counts: { buys: buys.length, voids: voids.length, buyAmount, voidAmount },
    detected,
  };
}

async function runScanCase(browser, c, { id, title, projectId, expect }) {
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const out = { id, title, projectId };
  await page.goto(`${BASE}/?project=${projectId}&tab=coordination&qa21=${id}`, {
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
  await delay(1500);

  const click = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Run Forensic Clash Scan"));
    if (!b) return { ok: false };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, disabled: b.disabled };
  });
  out.click = click;

  let banner = null;
  let scanningSeen = false;
  const started = Date.now();
  for (let i = 0; i < 600 && !banner; i++) {
    await delay(300);
    const snap = await page.evaluate(() => {
      const d = [...document.querySelectorAll("div")].find((x) =>
        String(x.className || "").includes("bg-emerald-950/40")
      );
      return {
        banner: d ? (d.textContent || "").replace(/\s+/g, " ").trim() : null,
        scanning: document.body.innerText.includes("Scanning Cross-Trade Specs"),
      };
    });
    if (snap.scanning) scanningSeen = true;
    banner = snap.banner;
    if (id !== "FULL" && i > 60 && !banner) break;
  }
  out.banner = banner;
  out.scanningSeen = scanningSeen;
  out.elapsedMs = Date.now() - started;
  out.toasts = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((e) => (e.textContent || "").trim()));
  out.pageErrors = diag.pageErrors.slice(0, 5);
  await shot(page, `fix4-qa21-scan-${id.toLowerCase()}.png`);
  await page.close();
  return out;
}

async function main() {
  const c = client();
  const { browser } = await launchBrowser(1440, 950);
  const cases = [];

  // ---- NOHVAC ----
  const nohvac = await runScanCase(browser, c, {
    id: "NOHVAC", title: F.nohvac.title, projectId: F.nohvac.id,
  });
  cases.push(nohvac);
  record("A19-02.nohvac-banner", "no-HVAC project shows prerequisite, no invented amounts", /needs both a Division 26 \(Electrical\) and a Division 23 \(HVAC\)/i.test(nohvac.banner || "") && !BENCHMARK_ONLY.test(nohvac.banner || "") && usdTokens(nohvac.banner).length === 0, nohvac);
  record("A19-02.nohvac-no-false-toast", "no-HVAC scan does not toast an AI completion", !(nohvac.toasts || []).some((t) => /completed/i.test(t)), { toasts: nohvac.toasts });

  // ---- NOBIDS ----
  const nobids = await runScanCase(browser, c, {
    id: "NOBIDS", title: F.nobids.title, projectId: F.nobids.id,
  });
  cases.push(nobids);
  record("A19-02.nobids-banner", "no-bid project shows priced-proposal prerequisite, no invented amounts", /at least one priced proposal in both Division 26 and Division 23/i.test(nobids.banner || "") && !BENCHMARK_ONLY.test(nobids.banner || "") && usdTokens(nobids.banner).length === 0, nobids);

  // ---- FULL ----
  const full = await runScanCase(browser, c, {
    id: "FULL", title: F.full.title, projectId: F.full.id,
  });
  cases.push(full);
  const exp = await expectedFullMessage(c, F.full.id);
  record(
    "A19-02.full-banner-matches-engine",
    "both-bids scan summary equals detectCrossTradeClashes-derived counts/amounts",
    full.banner === exp.expected,
    { banner: full.banner, expected: exp.expected, counts: exp.counts, elapsedMs: full.elapsedMs, toasts: full.toasts }
  );
  record("A19-02.full-no-invented", "both-bids banner dollar amounts are exactly the engine-computed pair", JSON.stringify(usdTokens(full.banner)) === JSON.stringify([usd(exp.counts.buyAmount), usd(exp.counts.voidAmount)].sort()), { tokens: usdTokens(full.banner), expectedTokens: [usd(exp.counts.buyAmount), usd(exp.counts.voidAmount)] });

  const out = { cases, results, expectedFull: exp, summary: { pass: results.filter((r) => r.pass).length, total: results.length } };
  writeEvidence("03-scan-ui", out);
  writeLog("03-scan-ui", log);
  await browser.close();
  console.log(`scan ui: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("03-scan-ui-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});