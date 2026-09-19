/** QA22-03d: focused RFQ dispatch retry for AUDIT-QA22 Journey Probe (scoped card). */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab } from "./lib.mjs";
import { client, writeEvidence, writeLog, sleep } from "./qa22-lib.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1000)}`);
};
async function poll(fn, predicate, timeoutMs = 90000, stepMs = 2000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) { last = await fn(); if (predicate(last)) return last; await sleep(stepMs); }
  return last;
}

const projects = (await c.query("projects:listProjects", {})) || [];
const p = projects.find((x) => x.title === "AUDIT-QA22-JOURNEY");
if (!p) throw new Error("journey project missing");
const packages = await c.query("tradePackages:listByProject", { projectId: p._id });
const pkg = packages.find((x) => x.csiDivision === "01 00 00");
const ctrs = await c.query("contractors:listByPackage", { tradePackageId: pkg._id });
const probe = ctrs.find((x) => x.companyName === "AUDIT-QA22 Journey Probe");
record("A22-03d.0", "probe contractor exists", Boolean(probe), { id: probe?._id, status: probe?.rfqStatus });

const { browser } = await launchBrowser(1500, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
await page.goto(`${BASE}/?project=${p._id}&tab=discovery&qa22=dispatch`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitForAppReady(page, 60000);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
  b?.click();
});
await delay(1500);
await page.evaluate((name) => {
  const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(name));
  b?.click();
}, pkg.tradeName);
await delay(1200);

// add a fresh contractor so an Invite to Bid control is present
const addBtn = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /Add Contractor Manually/i.test(x.innerText || ""));
  if (!b) return false;
  b.click();
  return true;
});
await delay(900);
const typeInto = async (selector, text) => {
  const el = await page.$(selector);
  if (!el) return false;
  await el.click();
  await page.keyboard.type(text, { delay: 3 });
  return true;
};
await typeInto('input[placeholder*="Rosendin"]', "AUDIT-QA22 Journey Dispatch");
await typeInto('input[placeholder*="estimating@rosendin"]', "estimating@qa22-dispatch.invalid");
await typeInto('input[placeholder*="TECL"]', "HI-QA22-DP4");
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /Add to Directory/i.test(x.innerText || ""));
  b?.click();
});
await delay(2500);
const fresh = (await c.query("contractors:listByPackage", { tradePackageId: pkg._id })).find((x) => x.companyName === "AUDIT-QA22 Journey Dispatch");
say(`fresh contractor=${fresh?._id} status=${fresh?.rfqStatus} (addBtn=${addBtn})`);

const click = await page.evaluate((name) => {
  const v = (e) => e.getBoundingClientRect().width > 1;
  const btns = [...document.querySelectorAll("button")].filter((b) => v(b) && /Invite to Bid|Dispatch RFQ/i.test(b.innerText || ""));
  for (const b of btns) {
    let el = b;
    for (let i = 0; i < 10 && el; i++) {
      if ((el.innerText || "").includes(name)) { b.click(); return { ok: true, text: (b.innerText || "").trim(), depth: i }; }
      el = el.parentElement;
    }
  }
  return { ok: false, candidates: btns.map((x) => (x.innerText || "").trim()) };
}, "Journey Dispatch");

const t0 = Date.now();
let toasts = [];
let pageErr = null;
for (let i = 0; i < 90; i++) {
  await delay(1000);
  const snap = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((e) => (e.innerText || "").trim()).filter(Boolean));
  if (snap.length) toasts = snap;
  if (diag.pageErrors.length) { pageErr = diag.pageErrors[diag.pageErrors.length - 1]; }
  const st = await c.query("contractors:listByPackage", { tradePackageId: pkg._id });
  const now = (st || []).find((x) => x._id === fresh?._id);
  if (now?.rfqStatus === "invited" || now?.dispatchedAt) break;
  if (pageErr && i > 20) break;
}
const final = await poll(
  () => c.query("contractors:listByPackage", { tradePackageId: pkg._id }).then((cs) => (cs || []).find((x) => x._id === fresh?._id)),
  () => true, 1000, 500
);
await shot(page, "fix4-qa22-dispatch-retry.png");
record(
  "A22-03d.1",
  "dispatch: either invited or an explicit visible error (no silent no-op)",
  click.ok && (final?.rfqStatus === "invited" || /error|failed|unable|try again|connection|limit/i.test(`${toasts.join(" ")} ${pageErr || ""}`)),
  { click, durationMs: Date.now() - t0, rfqStatus: final?.rfqStatus, dispatchedAt: final?.dispatchedAt ?? null, toasts, pageErr: pageErr ? pageErr.slice(0, 220) : null }
);
writeEvidence("dispatch-retry", { results, diag: { pageErrors: diag.pageErrors.slice(-4).map((x) => x.slice(0, 220)) } });
writeLog("dispatch-retry", log);
await browser.close();
console.log(`dispatch retry: ${results.filter((r) => r.pass).length}/${results.length}`);