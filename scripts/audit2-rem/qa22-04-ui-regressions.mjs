/**
 * QA22-04 UI regressions: CSV formula neutralization (CSV fixture), clash-scan
 * guard toast (SCAN fixture), addendum disabled gate (0 RFIs), local-day deadline
 * min + create (Honolulu TZ), KPI budget-fallback caption reconcile (STATE),
 * WCAG AA contrast on live action controls.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, EVIDENCE_DIR } from "./qa22-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1100)}`);
};

async function clickText(page, needle, exact = false) {
  return page.evaluate(
    ({ needle, exact }) => {
      const v = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => {
        const t = (x.innerText || "").replace(/\s+/g, " ").trim();
        return v(x) && (exact ? t === needle : t.includes(needle));
      });
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim(), disabled: b.disabled };
    },
    { needle, exact }
  );
}

function parseRgb(s) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function lum(rgb) {
  const a = rgb.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function contrast(a, b) {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.emulateTimezone("Pacific/Honolulu");
  const cdp = await page.createCDPSession();
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa22-ui-downloads");
  fs.mkdirSync(dlDir, { recursive: true });
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
  const dismissTour = () =>
    page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });

  try {
    // ---------- A. CSV injection neutralization ----------
    await page.goto(`${BASE}/?project=${F.csv.id}&tab=leveling&qa22=csv`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour();
    await delay(1500);
    const dlBefore = fs.readdirSync(dlDir).filter((f) => f.endsWith(".csv")).length;
    const csvClick = await clickText(page, "Export Leveling CSV");
    await delay(2600);
    const files = fs.readdirSync(dlDir).filter((f) => f.endsWith(".csv"));
    const newest = files.map((f) => ({ f, t: fs.statSync(path.join(dlDir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
    const csv = newest ? fs.readFileSync(path.join(dlDir, newest), "utf8") : "";
    const lines = csv.split("\r\n").filter(Boolean);
    const formulaLine = lines.find((l) => /Journey|1\+1|SUM/.test(l) || /'=1\+1|'@SUM/.test(l));
    const rawAtStart = lines.some((l) => /(^|,)"?[=+@]-?/.test(l) && !/"?\'/.test(l) && /=1\+1|@SUM/.test(l));
    const neutralized = /"'=1\+1"/.test(csv) && /"'@SUM\(1\+1\)"/.test(csv);
    record(
      "A22-04.1",
      "CSV injection: formula-prefixed bidder names are apostrophe-neutralized in the exported file",
      csvClick.ok && csv.length > 0 && neutralized && !rawAtStart,
      { csvClick, newest, neutralized, rawAtStart, sample: formulaLine || null, head: lines.slice(0, 2) }
    );

    // ---------- B. addendum disabled gate (0 RFIs) ----------
    await clickTab(page, "Pre-Bid Q&A");
    await delay(1500);
    const addendumGate = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Addendum/i.test(x.innerText || ""));
      const hint = document.body.innerText.match(/Certify at least one RFI[^\n]*/);
      return b ? { text: (b.innerText || "").replace(/\s+/g, " ").trim(), disabled: b.disabled, title: b.getAttribute("title") } : { missing: true };
    });
    record(
      "A22-04.2",
      "FIX-51: addendum control disabled with 0 certified RFIs and carries the certification hint",
      !addendumGate.missing && addendumGate.disabled === true && /Certify at least one RFI/i.test(addendumGate.title || ""),
      addendumGate
    );

    // ---------- C. clash scan guard UI (SCAN fixture, Div26 only) ----------
    await page.goto(`${BASE}/?project=${F.scan.id}&tab=coordination&qa22=scan`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour();
    await delay(1500);
    const scanClick = await clickText(page, "Run Forensic Clash Scan");
    let scanUi = null;
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      scanUi = await page.evaluate(() => ({
        toasts: [...document.querySelectorAll('[role="status"]')].map((e) => (e.innerText || "").trim()).filter(Boolean),
        body: (document.querySelector("main") || document.body).innerText,
      }));
      if (scanUi.toasts.length || /needs both a Division 26/i.test(scanUi.body)) break;
    }
    const fabricated = /50,500|38,500|2 duplicate equipment|invented/i.test(`${scanUi?.toasts.join(" ")} ${scanUi?.body.match(/.{0,160}needs both a Division 26.{0,160}/)?.[0] || ""}`);
    const honest = /needs both a Division 26 \(Electrical\) and a Division 23 \(HVAC\)/i.test(`${scanUi?.toasts.join(" ")} ${scanUi?.body}`);
    await shot(page, "fix4-qa22-scan-guard.png");
    record(
      "A22-04.3",
      "FIX-50 UI: clash scan on a Div26-only project refuses truthfully; no fabricated clash totals anywhere on screen",
      scanClick.ok && honest && !fabricated,
      { scanClick, toasts: scanUi?.toasts, honest, fabricated, bodySnippet: (scanUi?.body.match(/.{0,120}(needs both|scan complete|double-buy).{0,160}/i) || [null])[0] }
    );

    // ---------- D. contrast on live action controls ----------
    const contrastTargets = [];
    const pushContrast = async (label) => {
      const row = await page.evaluate((label) => {
        const v = (e) => e.getBoundingClientRect().width > 1;
        const b = [...document.querySelectorAll("button, a")].find((x) => v(x) && (x.innerText || "").replace(/\s+/g, " ").trim() === label && !x.disabled);
        if (!b) return null;
        const cs = getComputedStyle(b);
        return { label, bg: cs.backgroundColor, color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight };
      }, label);
      if (row) {
        const bg = parseRgb(row.bg), fg = parseRgb(row.color);
        contrastTargets.push({ ...row, ratio: bg && fg ? Number(contrast(bg, fg).toFixed(2)) : null });
      }
    };
    await clickTab(page, "Bid Leveling");
    await delay(1600);
    for (const label of ["Ingest Quote / PDF", "Export Leveling CSV", "Award Compliant Winner", "Unaward", "Adjust Leveling"]) await pushContrast(label);
    await clickTab(page, "Discovery");
    await delay(1500);
    for (const label of ["Add Contractor Manually", "Invite to Bid"]) await pushContrast(label);
    await clickTab(page, "Scope Clash");
    await delay(1400);
    for (const label of ["Run Forensic Clash Scan"]) await pushContrast(label);
    const small = contrastTargets.filter((r) => parseFloat(r.fontSize) < 18.66 && r.ratio !== null);
    record(
      "A22-04.4",
      "WCAG AA: measured live action controls (small text) meet >= 4.5 contrast",
      small.length >= 4 && small.every((r) => r.ratio >= 4.5),
      { measured: contrastTargets }
    );

    // ---------- E. local-day deadline min + create (Honolulu UTC-10) ----------
    await page.goto(`${BASE}/?project=${F.csv.id}&tab=packages&qa22=deadline`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour();
    await delay(1200);
    const deadlineBtn = await clickText(page, "Create Trade Package");
    await delay(900);
    const deadlineUi = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].filter((x) => x.getBoundingClientRect().width > 1).pop();
      const input = d ? d.querySelector('input[aria-label="Bid deadline"]') : null;
      return {
        open: Boolean(d),
        min: input?.min ?? null,
        browserLocal: new Date().toLocaleDateString("en-CA"),
        utc: new Date().toISOString().slice(0, 10),
        offset: new Date().getTimezoneOffset(),
      };
    });
    let deadlineCreate = null;
    const existingDl = ((await c.query("tradePackages:listByProject", { projectId: F.csv.id })) || []).find((p) => p.tradeName === "QA22 Deadline Local Day");
    if (existingDl) {
      await page.keyboard.press("Escape");
      deadlineCreate = { skippedExisting: true, createdDeadline: existingDl.bidDeadline, createdId: existingDl._id };
    } else if (deadlineUi.open && deadlineUi.min) {
      const setVal = async (sel, value, tag = "input") =>
        page.evaluate(({ sel, value, tag }) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const proto = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }, { sel, value, tag });
      await setVal('input[aria-label="CSI division number"]', "09 00 00");
      await setVal('input[aria-label="Trade package name"]', "QA22 Deadline Local Day");
      await setVal('input[aria-label="Budget estimate in dollars"]', "150000");
      await setVal('textarea[aria-label="Scope summary"]', "QA22 local-day deadline control package.", "textarea");
      await setVal('input[aria-label="Bid deadline"]', deadlineUi.min);
      const submit = await clickText(page, "Create Package");
      await delay(2500);
      const pkgs = await c.query("tradePackages:listByProject", { projectId: F.csv.id });
      const created = (pkgs || []).find((p) => p.tradeName === "QA22 Deadline Local Day");
      deadlineCreate = { submit, createdDeadline: created?.bidDeadline ?? null, createdId: created?._id ?? null, error: await page.evaluate(() => document.querySelector('[role="alert"]')?.innerText || null) };
    }
    record(
      "A22-04.5",
      "deadline local-day: date min equals browser-local today (not UTC); backend accepts local-today deadline with slack",
      deadlineBtn.ok && deadlineUi.open && deadlineUi.min === deadlineUi.browserLocal && deadlineUi.min !== deadlineUi.utc &&
        deadlineCreate?.createdDeadline === deadlineUi.min,
      { deadlineBtn, deadlineUi, deadlineCreate }
    );

    // ---------- F. KPI budget-fallback reconcile on STATE ----------
    await page.goto(`${BASE}/?project=${F.state.id}&tab=leveling&qa22=kpi`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour();
    await delay(1800);
    const kpiText = await page.evaluate(() => (document.querySelector("main")?.innerText || "").split("\n").slice(0, 30).join("\n"));
    const [pkgs2, bids2] = await Promise.all([
      c.query("tradePackages:listByProject", { projectId: F.state.id }),
      c.query("bids:listAllProjectBids", { projectId: F.state.id }),
    ]);
    let expectedLeveled = 0;
    let onBudget = 0;
    for (const pk of pkgs2) {
      const pb = bids2.filter((b) => b.tradePackageId === pk._id);
      if (!pb.length) {
        expectedLeveled += pk.budgetEstimate || 0;
        onBudget++;
      } else {
        expectedLeveled += Math.min(...pb.map((b) => b.leveledTotalCost));
      }
    }
    const uiLeveled = /Leveled Buyout:\s*\$?([\d,]+)/.exec(kpiText.replace(/\n/g, " "))?.[1];
    const caption = /\((\d+)\/(\d+) pkgs on budget estimates\)/.exec(kpiText.replace(/\n/g, " "));
    const projects = (await c.query("projects:listProjects", {})) || [];
    const stateProj = projects.find((p) => p._id === F.state.id);
    const expectedVariance = (stateProj?.estBudget || 0) - expectedLeveled;
    const uiVariance = /Variance:\s*([+\-$][\d,]+)/.exec(kpiText.replace(/\n/g, " "))?.[1];
    record(
      "A22-04.6",
      "F2: KPI leveled buyout and budget-fallback caption reconcile with backend (budget estimates counted honestly)",
      Number(String(uiLeveled).replace(/,/g, "")) === expectedLeveled &&
        (!caption || Number(caption[1]) === onBudget),
      { uiLeveled, expectedLeveled, uiVariance, expectedVariance, caption: caption ? `${caption[1]}/${caption[2]}` : null, onBudget, pkgs: pkgs2.length }
    );

    record("A22-04.7", "ui regression diagnostics", diag.pageErrors.length === 0, {
      pageErrors: diag.pageErrors.slice(0, 6).map((x) => x.slice(0, 200)),
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(-6).map((e) => e.text.slice(0, 200)),
    });
  } catch (err) {
    record("A22-04.ERR", "ui regressions aborted", false, { error: String(err?.stack ?? err) });
  } finally {
    writeEvidence("ui-regressions", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("ui-regressions", log);
    await browser.close();
    console.log(`ui regressions: ${results.filter((r) => r.pass).length}/${results.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-regressions-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});