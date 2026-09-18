import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  selectProjectByTitle,
  getSelectorState,
  writeJson,
  writeLog,
  delay,
} from "./lib.mjs";

const log = [];
const say = (s) => { console.log(s); log.push(s); };
const out = { steps: {}, timestamp: new Date().toISOString() };
const { browser } = await launchBrowser();
const page = await browser.newPage();
const diag = attachDiagnostics(page);

const body = async () => (await page.evaluate(() => document.body.innerText)).replace(/\r/g, "");
async function clickText(text, opts = {}) {
  return page.evaluate((needle, exact, nth) => {
    const els = [...document.querySelectorAll("button, [role=tab]")];
    const matches = els.filter((b) => { const t = (b.textContent || "").trim(); return exact ? t === needle : t.includes(needle); });
    const m = matches[nth || 0];
    if (!m) return { ok: false, count: matches.length };
    m.scrollIntoView({ block: "center" }); m.click();
    return { ok: true, count: matches.length, text: (m.textContent || "").trim().slice(0, 90) };
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
async function closeDialogs() {
  await page.keyboard.press("Escape");
  await delay(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button, [role="presentation"] button')].find((x) => /cancel|close|dismiss|close viewer/i.test((x.textContent || "").trim()));
    if (b) b.click();
  });
  await delay(400);
}

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, "Domain Tower B");
  await delay(1200);
  await closeTour();
  out.steps.selector = (await getSelectorState(page)).selectedText;

  // KPI compact band exact text
  out.steps.kpiCompact = (await body()).split("Expand 6-Card KPI View")[0].split("BASELINE:").join("BASELINE:").slice(-700);

  // LEVELING: switch to Div 22 (Draft, no bids) => empty state
  await tab("leveling");
  const div22 = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("22 00 00"));
    if (b) { b.click(); return true; } return false;
  });
  await delay(900);
  out.steps.div22Clicked = div22;
  out.steps.div22Empty = (await body()).split("Real-Time Forensic Bid Leveling Matrix")[1]?.slice(0, 2500) || "";
  out.steps.selectorAfterDiv22 = (await getSelectorState(page)).selectedText;
  await shot(page, "fix4-qa4-empty-leveling-div22.png", { full: true });
  // back to Div 26 and open Alterman adjust
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("26 00 00"));
    if (b) b.click();
  });
  await delay(800);
  await clickText("Adjust Leveling", { nth: 1 });
  await delay(800);
  out.steps.adjustAltermanVisible = await page.evaluate(() => document.body.innerText.includes("Forensic Leveling Adjustments"));
  out.steps.adjustAltermanText = (await body()).split("Forensic Leveling Adjustments")[1]?.slice(0, 2200) || "";
  await shot(page, "fix4-qa4-modal-adjust-alterman.png", { full: false });
  await clickText("Cancel");
  await delay(400);

  // QNA: click Issue Legal Addendum (errors before any write when nothing certified)
  await tab("qna");
  const addendum = await clickText("Issue Legal Addendum");
  await delay(900);
  out.steps.addendumClick = addendum;
  out.steps.addendumResult = (await body()).split("Subcontractor RFIs Require PM Certification")[1]?.slice(0, 1200) || "";
  await shot(page, "fix4-qa4-addendum-gate-error.png", { full: true });

  // CONTRACTS: open Record External Execution confirm (read-only, cancel)
  await tab("contracts");
  const rec = await clickText("Record Execution Status");
  if (!rec.ok) await clickText("Record External Execution");
  await delay(700);
  out.steps.recordConfirmText = (await body()).split("Record external execution?")[1]?.slice(0, 600) || "";
  await shot(page, "fix4-qa4-record-execution-confirm.png", { full: false });
  await closeDialogs();

  // DISCOVERY: invited list aging fields
  await tab("discovery");
  await clickText("Invited (2)");
  await delay(600);
  out.steps.invitedCards = (await body()).split("Trade Directory (2 of 4)")[1]?.slice(0, 2000) || "";
  await shot(page, "fix4-qa4-discovery-invited.png", { full: true });
  await clickText("All (4)");

  out.diag = { consoleErrors: diag.consoleLogs.filter((m) => m.type === "error").map((m) => m.text.slice(0, 150)), pageErrors: diag.pageErrors.slice(0, 5) };
} catch (e) {
  out.error = String(e.stack || e);
} finally {
  writeJson("fix4-qa4-final.json", out);
  writeLog("fix4-qa4-final-log.txt", log);
  await browser.close();
}