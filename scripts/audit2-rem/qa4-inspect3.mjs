import fs from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  selectProjectByTitle,
  writeJson,
  writeLog,
  delay,
  REPO_ROOT,
} from "./lib.mjs";

const log = [];
const say = (s) => { console.log(s); log.push(s); };
const downloadsDir = path.join(REPO_ROOT, "evidence", "fix4-qa4-downloads");
const out = { steps: {}, timestamp: new Date().toISOString() };
const { browser } = await launchBrowser();
const page = await browser.newPage();
const diag = attachDiagnostics(page);
const cdp = await page.createCDPSession();
await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadsDir, eventsEnabled: true });

const body = async () => (await page.evaluate(() => document.body.innerText)).replace(/\r/g, "");
async function clickText(text, opts = {}) {
  return page.evaluate((needle, exact, nth) => {
    const els = [...document.querySelectorAll("button, [role=tab]")];
    const matches = els.filter((b) => { const t = (b.textContent || "").trim(); return exact ? t === needle : t.includes(needle); });
    const m = matches[nth || 0];
    if (!m) return { ok: false, count: matches.length };
    m.scrollIntoView({ block: "center" }); m.click();
    return { ok: true, count: matches.length, text: (m.textContent || "").trim().slice(0, 80) };
  }, text, !!opts.exact, opts.nth || 0);
}
async function tab(name) {
  const map = { packages: "01: CSI Scoping", discovery: "02: Discovery", qna: "03: Pre-Bid Q&A", leveling: "04: Bid Leveling", coordination: "05: Scope Clash", contracts: "06: Subcontracts", audit: "Live Activity Audit", diagnostics: "Evals & Architecture" };
  const r = await page.evaluate((needle) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(needle));
    if (!b) return { ok: false }; b.click(); return { ok: true };
  }, map[name]);
  await delay(900); return r;
}
async function closeTour() {
  const c = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => ["Close Demo Tour", "Close Teleprompter"].includes(x.getAttribute("title") || "") || (x.textContent || "").trim() === "Dismiss");
    if (b) { b.click(); return true; } return false;
  });
  await delay(400); return c;
}

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, "Domain Tower B");
  await delay(1000);
  await closeTour();

  // Per-trade contractor counts (corroborate audit "12 trade contractors")
  await tab("discovery");
  const tradeCounts = {};
  for (const div of ["26 00 00", "23 00 00", "22 00 00"]) {
    await clickText(div);
    await delay(700);
    const t = await body();
    const m = t.match(/Trade Directory \((\d+) of (\d+)\)/);
    const subs = [...t.matchAll(/^([A-Z][^\n]{2,60}?(?:Inc\.|LLC|Corp\.|Co\.|LP|Ltd\.?))$/gm)].map((x) => x[1]);
    tradeCounts[div] = { directory: m ? m[0] : null, subs: subs.slice(0, 12) };
  }
  out.steps.tradeCounts = tradeCounts;

  // Contracts viewer + A401 contract text + download
  await tab("contracts");
  await clickText("Inspect AIA A401");
  await delay(900);
  out.steps.a401ModalVisible = await page.evaluate(() => document.body.innerText.includes("AIA Document A401™ Subcontract Agreement"));
  out.steps.a401ContractText = await page.evaluate(() => {
    const pre = [...document.querySelectorAll("pre")].map((p) => p.innerText).join("\n=====\n");
    return pre.replace(/\r/g, "");
  });
  out.steps.a401Buttons = await page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b) => ({ t: (b.textContent || "").trim().slice(0, 60), title: b.getAttribute("title") || "", disabled: b.disabled })).filter((b) => b.title || /close viewer|record external|download|print|copy/i.test(b.t))
  );
  await shot(page, "fix4-qa4-modal-a401-viewer.png", { full: false });
  const dlBefore = fs.readdirSync(downloadsDir).length;
  out.steps.a401DownloadClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Download subcontract agreement text file"));
    if (!b) return { ok: false }; b.click(); return { ok: true };
  });
  await delay(2000);
  out.steps.a401DownloadFiles = fs.readdirSync(downloadsDir).slice(dlBefore);
  await clickText("Close Viewer");
  await delay(500);

  // Leveling Adjust modal
  await tab("leveling");
  await clickText("Adjust Leveling", { nth: 0 });
  await delay(800);
  out.steps.adjustVisible = await page.evaluate(() => document.body.innerText.includes("Forensic Leveling Adjustments"));
  out.steps.adjustText = (await body()).split("Forensic Leveling Adjustments")[1]?.split("TradePulse Pro •")[0]?.slice(0, 4500) || "";
  await shot(page, "fix4-qa4-modal-adjust-leveling.png", { full: false });
  await clickText("Cancel");
  await delay(400);

  // Audit tab
  await tab("audit");
  out.steps.auditText = (await body()).split("Live Reactive Activity Audit Stream")[1]?.slice(0, 4500) || (await body()).slice(0, 3000);
  await shot(page, "fix4-qa4-tab-audit2.png", { full: true });

  // Diagnostics traces button state
  await tab("diagnostics");
  out.steps.tracesBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Download Traces JSON"));
    return b ? { disabled: b.disabled, title: b.getAttribute("title") || "" } : null;
  });
  out.diag = { consoleErrors: diag.consoleLogs.filter((m) => m.type === "error").map((m) => m.text.slice(0, 200)), pageErrors: diag.pageErrors.slice(0, 8) };
} catch (e) {
  out.error = String(e.stack || e);
} finally {
  writeJson("fix4-qa4-inspect3.json", out);
  writeLog("fix4-qa4-inspect3-log.txt", log);
  await browser.close();
}