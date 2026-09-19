import { launchBrowser, attachDiagnostics, waitForAppReady, delay, clickTab, shot } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog, client } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
await page.goto(`${BASE}/?project=${fx.live.id}&tab=coordination&qa18=tour`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitForAppReady(page, 60000);
await delay(1200);

const findAction = () =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Advance to Subcontract Execution"));
    return b ? { found: true, text: (b.textContent || "").replace(/\s+/g, " ").trim() } : { found: false };
  });

let action = await findAction();
if (!action.found) {
  const toggle = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Toggle Investor Demo Tour"));
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
  say(`toggle tour: ${JSON.stringify(toggle)}`);
  await delay(1200);
  action = await findAction();
}
say(`action button: ${JSON.stringify(action)}`);

const coordState = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /Clashes|Clear/.test(x.textContent || "") && /Scope Clash/.test(x.textContent || ""));
  return { clashBadge: b ? (b.textContent || "").replace(/\s+/g, " ").trim() : null };
});
say(`coordination state: ${JSON.stringify(coordState)}`);

const c = client();
const logsBefore = (await c.query("auditLogs:listRecentLogs", { projectId: fx.live.id, limit: 200 })) || [];

if (action.found) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Advance to Subcontract Execution"));
    b.click();
  });
  await delay(3500);
}
const toasts = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((e) => (e.textContent || "").trim()));
const logsAfter = (await c.query("auditLogs:listRecentLogs", { projectId: fx.live.id, limit: 200 })) || [];
const newLogs = logsAfter.filter((l) => !logsBefore.some((b) => b._id === l._id)).map((l) => l.title);
const deductions = logsAfter.filter((l) => /deduct/i.test(l.title + " " + (l.description || ""))).map((l) => l.title);
say(`toasts: ${JSON.stringify(toasts)}`);
say(`new logs: ${JSON.stringify(newLogs)}`);
say(`deduction logs: ${JSON.stringify(deductions)}`);
out.tourAction = { action, coordState, toasts, newLogs, deductions };
await shot(page, "fix4-qa18-copy-tour-toast.png");
out.pageErrors = diag.pageErrors.slice(0, 5);
writeEvidence("copy-tour", out);
writeLog("copy-tour", log);
await browser.close();
console.log("done");
