/** QA19-09c: UI "Run Forensic Clash Scan" on a clash-free project. */
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, clickTab, shot } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa19-lib.mjs";

const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${JSON.stringify(detail)}`);
};

async function main() {
  const c = client();
  const clashesBefore = await c.query("coordination:detectCrossTradeClashes", { projectId: F.live.id });

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${F.live.id}&tab=coordination&qa19=scan`, { waitUntil: "domcontentloaded", timeout: 90000 });
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
    b.click();
    return { ok: true };
  });
  say(`scan click: ${JSON.stringify(click)}`);
  let bannerText = null;
  const scanTrace = [];
  for (let i = 0; i < 120 && !bannerText; i++) {
    await delay(500);
    const snap = await page.evaluate(() => {
      const byClass = [...document.querySelectorAll("div")].find((d) =>
        String(d.className || "").includes("bg-emerald-950/40")
      );
      const candidate = byClass
        ? (byClass.textContent || "").replace(/\s+/g, " ").trim()
        : [...document.querySelectorAll("div")]
            .map((d) => (d.textContent || "").replace(/\s+/g, " ").trim())
            .filter((t) => t.length > 80 && t.length < 60000)
            .find((t) => /doubleBuys|Variable Frequency Drives|redundantAmount/i.test(t) && !/Redundant Double-Buys \$0/.test(t));
      const toasts = [...document.querySelectorAll('[role="status"]')].map((e) => (e.textContent || "").trim());
      const scanning = document.body.innerText.includes("Scanning Cross-Trade Specs");
      return { candidate: candidate || null, toasts, scanning };
    });
    if (snap.candidate || snap.toasts.length || i % 10 === 0) {
      scanTrace.push({ i, ...snap, candidate: (snap.candidate || "").slice(0, 160) });
    }
    bannerText = snap.candidate;
  }
  if (scanTrace.length) say(`scan trace: ${JSON.stringify(scanTrace.slice(-6))}`);
  const ui = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      scanBanner: null,
      credits: (() => {
        const i = t.indexOf("Recoverable Buyout Credits");
        return i >= 0 ? t.slice(i, i + 40).replace(/\s+/g, " ") : null;
      })(),
      doubleBuyKpi: (() => {
        const i = t.indexOf("Redundant Double-Buys");
        return i >= 0 ? t.slice(i, i + 60).replace(/\s+/g, " ") : null;
      })(),
    };
  });
  ui.scanBanner = bannerText;
  say(`ui: ${JSON.stringify(ui).slice(0, 1200)}`);
  await shot(page, "fix4-qa19-scan-clash-free.png");

  const clashesAfter = await c.query("coordination:detectCrossTradeClashes", { projectId: F.live.id });
  const bannerClaims = /redundantAmount|doubleBuys|"VFD/i.test(ui.scanBanner || "");
  record("A19-scan-ui.no-structured-clash-change", (clashesAfter?.doubleBuys || []).length === 0, {
    doubleBuysBefore: (clashesBefore?.doubleBuys || []).length,
    doubleBuysAfter: (clashesAfter?.doubleBuys || []).length,
  });
  record(
    "A19-scan-ui.banner-does-not-assert-clashes",
    !bannerClaims,
    {
      click,
      scanBannerHead: (ui.scanBanner || "").slice(0, 600),
      kpi: ui.doubleBuyKpi,
      credits: ui.credits,
      note: "A static, project-agnostic LLM prompt returns invented double-buy JSON on a project with no Division 23 package; the KPI cards still read $0.",
    }
  );
  const out = { click, ui, clashesBefore, clashesAfter, results, pageErrors: diag.pageErrors.slice(0, 3) };
  writeEvidence("scan-ui", out);
  writeLog("scan-ui", log);
  await browser.close();
  console.log(`results: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("scan-ui-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});