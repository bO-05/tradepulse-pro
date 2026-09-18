import fs from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  waitForAppReady,
  getSelectorState,
  selectProjectByTitle,
  writeJson,
  writeLog,
  delay,
  REPO_ROOT,
} from "./lib.mjs";

const log = [];
const say = (s) => { console.log(s); log.push(s); };
const downloadsDir = path.join(REPO_ROOT, "evidence", "fix4-qa4-downloads");
fs.mkdirSync(downloadsDir, { recursive: true });
const out = { steps: {}, timestamp: new Date().toISOString() };
const { browser } = await launchBrowser();
const page = await browser.newPage();
const diag = attachDiagnostics(page);
const cdp = await page.createCDPSession();
await cdp.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: downloadsDir, eventsEnabled: true });
const dlEvents = [];
cdp.on("Browser.downloadWillBegin", (e) => dlEvents.push({ kind: "begin", suggestedFilename: e.suggestedFilename, url: String(e.url).slice(0, 80) }));
cdp.on("Browser.downloadProgress", (e) => { if (e.state !== "inProgress") dlEvents.push({ kind: e.state, guid: e.guid }); });

const body = async () => (await page.evaluate(() => document.body.innerText)).replace(/\r/g, "");
const selState = () => getSelectorState(page);
async function clickText(text, opts = {}) {
  return page.evaluate((needle, exact, nth) => {
    const els = [...document.querySelectorAll("button, [role=tab]")];
    const matches = els.filter((b) => { const t = (b.textContent || "").trim(); return exact ? t === needle : t.includes(needle); });
    const m = matches[nth || 0];
    if (!m) return { ok: false, count: matches.length };
    m.scrollIntoView({ block: "center" }); m.click();
    return { ok: true, count: matches.length };
  }, text, !!opts.exact, opts.nth || 0);
}
async function tab(name) {
  const map = { packages: "01: CSI Scoping", discovery: "02: Discovery", qna: "03: Pre-Bid Q&A", leveling: "04: Bid Leveling", coordination: "05: Scope Clash", contracts: "06: Subcontracts", audit: "Live Activity Audit", diagnostics: "Evals & Architecture" };
  await page.evaluate((needle) => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(needle)); if (b) b.click(); }, map[name]);
  await delay(900);
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
  out.steps.selectorBeforePick = await selState();
  await selectProjectByTitle(page, "Domain Tower B");
  await delay(1200);
  await closeTour();
  const s1 = await selState();
  out.steps.selectorAfterPick = s1.selectedText;
  say(`SELECTED: ${s1.selectedText}`);

  // Current state snapshot
  await tab("packages");
  const pkgText = await body();
  out.steps.packageCount = (pkgText.match(/Div \d{2} 00 00/g) || []).length;
  await tab("qna");
  const qnaText = await body();
  out.steps.rfiBadge = (qnaText.match(/(\d+) RFIs/g) || []).slice(0, 2);
  await tab("contracts");
  const conText = await body();
  out.steps.contractRows = (conText.match(/A401-\d{4}-\d{4}-\d{5}/g) || []);
  const s2 = await selState();
  say(`SELECTED BEFORE A401: ${s2.selectedText}`);

  await clickText("Inspect AIA A401");
  await delay(900);
  const pre = await page.evaluate(() => [...document.querySelectorAll("pre")].map((p) => p.innerText).join("\n"));
  fs.writeFileSync(path.join(REPO_ROOT, "evidence", "fix4-qa4-a401-contract-text.txt"), pre, "utf8");
  out.steps.a401TextLength = pre.length;
  out.steps.selectorWithModal = (await selState()).selectedText;

  const before = fs.readdirSync(downloadsDir).length;
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Download subcontract agreement text file"));
    if (b) b.click();
  });
  await delay(2500);
  out.steps.downloadEvents = dlEvents;
  out.steps.downloadFiles = fs.readdirSync(downloadsDir).slice(before);
  out.steps.selectorAfterDownload = (await selState()).selectedText;
  out.steps.diag = { consoleErrors: diag.consoleLogs.filter((m) => m.type === "error").map((m) => m.text.slice(0, 200)), pageErrors: diag.pageErrors.slice(0, 5) };
} catch (e) {
  out.error = String(e.stack || e);
} finally {
  writeJson("fix4-qa4-verify-state.json", out);
  writeLog("fix4-qa4-verify-state-log.txt", log);
  await browser.close();
}