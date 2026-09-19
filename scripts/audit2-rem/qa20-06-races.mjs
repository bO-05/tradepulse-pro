/**
 * QA20-06 races: real double-click on Void confirm, Reset Demo cancel safety,
 * Print double-click popup count.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, sleep } from "./qa20-lib.mjs";

const F = readEvidence("fixtures");
const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const J = F.journey;
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 800)}`);
};

async function stateNow() {
  const agrs = (await c.query("agreements:listAgreements", { projectId: J.id })) || [];
  const bids = (await c.query("bids:listAllProjectBids", { projectId: J.id })) || [];
  const pkg = await c.query("tradePackages:getPackage", { tradePackageId: J.packageId });
  return {
    agreements: agrs.filter((a) => a.tradePackageId === J.packageId).map((a) => ({ id: a._id, num: a.agreementNumber, status: a.status })),
    awarded: bids.filter((b) => b.tradePackageId === J.packageId && b.isAwarded).length,
    pkg: pkg.status,
  };
}
async function dialogState(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const ds = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis);
    const top = ds[ds.length - 1] || null;
    return top ? { open: true, title: (top.querySelector("h2") || {}).innerText || "", alert: top.querySelector('[role="alert"]')?.innerText || null, busy: top.getAttribute("aria-busy"), buttons: [...top.querySelectorAll("button")].map((b) => ({ t: (b.innerText || "").trim(), disabled: b.disabled })) } : { open: false };
  });
}
async function realDblClick(page, selectorFn) {
  const box = await page.evaluate(selectorFn);
  if (!box) return null;
  await page.mouse.click(box.x, box.y, { clickCount: 2, delay: 40 });
  return box;
}

async function main() {
  // ensure executed state (from a11y run) then race the void confirm
  const pre = await stateNow();
  const executed = pre.agreements.find((a) => a.status === "executed");
  if (!executed) {
    const gen = await c.mutation("agreements:generateAgreement", { bidId: F.journey.bids.a.bidId, tradePackageId: J.packageId });
    await c.mutation("agreements:executeAgreement", { agreementId: gen._id });
  }
  const p0 = await stateNow();
  const voidLogsBefore = ((await c.query("auditLogs:listRecentLogs", { projectId: J.id, limit: 500 })) || []).filter((l) => l.title.startsWith("Executed Subcontract Voided")).length;

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  let popups = 0;
  page.on("popup", () => popups++);
  await page.goto(`${BASE}/?project=${J.id}&tab=contracts&qa20=races`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
    b?.click();
  });
  await delay(1300);

  // open viewer
  for (let i = 0; i < 10; i++) {
    const ok = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Inspect Draft/.test(x.innerText || ""));
      if (!b) return false;
      b.click();
      return true;
    });
    if (ok) break;
    await delay(900);
  }
  await delay(1200);
  // open void confirm
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Void execution record/.test(x.innerText || ""));
    b?.click();
  });
  await delay(900);
  const dlg0 = await dialogState(page);
  const dbl = await realDblClick(page, () => {
    const ds = [...document.querySelectorAll('[role="alertdialog"]')].filter((d) => d.getBoundingClientRect().width > 1);
    const top = ds[ds.length - 1];
    if (!top) return null;
    const b = [...top.querySelectorAll("button")].find((x) => /Void execution record/.test(x.innerText || ""));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: b.disabled };
  });
  await sleep(3500);
  const dlgAfter = await dialogState(page);
  const p1 = await stateNow();
  const voidLogsAfter = ((await c.query("auditLogs:listRecentLogs", { projectId: J.id, limit: 500 })) || []).filter((l) => l.title.startsWith("Executed Subcontract Voided")).length;
  await shot(page, "fix4-qa20-race-void-dblclick.png");
  const voidSucceeded = p1.agreements.every((a) => a.status !== "executed") && p1.pkg === "leveling";
  record(
    "A20-06.1",
    "double-click Void confirm: one void, success reflected, no residual error dialog",
    dlg0.open && voidSucceeded && voidLogsAfter - voidLogsBefore === 1 && !(dlgAfter.open && dlgAfter.alert),
    { dlg0: { title: dlg0.title }, dbl, after: dlgAfter, states: { pre: p0, post: p1 }, voidLogs: voidLogsAfter - voidLogsBefore, voidSucceeded }
  );

  // Reset Demo cancel safety (demo must not change)
  const demoBefore = ((await c.query("tradePackages:listByProject", { projectId: "jx7emzjxc9q9ckdrb0pnjd90zd8ejz06" })) || []).length;
  const dockOpen = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Judge Dock|Open Demo Simulation/.test(x.innerText || ""));
    if (!b) return false;
    b.click();
    return true;
  });
  await delay(900);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Reset Demo Data/.test(x.innerText || ""));
    b?.click();
  });
  await delay(800);
  const resetDlg = await dialogState(page);
  const cancelled = await page.evaluate(() => {
    const ds = [...document.querySelectorAll('[role="alertdialog"]')].filter((d) => d.getBoundingClientRect().width > 1);
    const top = ds[ds.length - 1];
    const b = top && [...top.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Cancel");
    if (!b) return false;
    b.click();
    return true;
  });
  await delay(1200);
  const resetDlgAfter = await dialogState(page);
  const demoAfter = ((await c.query("tradePackages:listByProject", { projectId: "jx7emzjxc9q9ckdrb0pnjd90zd8ejz06" })) || []).length;
  await shot(page, "fix4-qa20-race-reset-cancel.png");
  record(
    "A20-06.2",
    "Reset Demo cancel is inert (demo unchanged, dialog closes)",
    dockOpen && resetDlg.open && cancelled && !resetDlgAfter.open && demoBefore === demoAfter,
    { resetDlg: resetDlg.title, resetDlgAfter: resetDlgAfter.open, demoBefore, demoAfter }
  );
  await page.keyboard.press("Escape");
  await delay(600);

  // Print double-click popup count (re-award first to get a generated agreement)
  const regen = await c.mutation("agreements:generateAgreement", { bidId: F.journey.bids.a.bidId, tradePackageId: J.packageId });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAppReady(page, 60000);
  await delay(1800);
  for (let i = 0; i < 10; i++) {
    const ok = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Inspect Draft/.test(x.innerText || ""));
      if (!b) return false;
      b.click();
      return true;
    });
    if (ok) break;
    await delay(900);
  }
  await delay(1500);
  popups = 0;
  const printBox = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /Subcontract Draft/.test(x.innerText || ""));
    const b = d && [...d.querySelectorAll("button")].find((x) => /Print/.test(x.innerText || ""));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (printBox) {
    await page.mouse.click(printBox.x, printBox.y, { clickCount: 2, delay: 40 });
  }
  await delay(2500);
  const popupCount = popups;
  record("A20-06.3", "Print double-click opens at most one print window", popupCount <= 1, { popupCount, printBox, regen: regen.agreementNumber });
  if (popupCount > 1) say(`note: ${popupCount} print windows opened on double-click (Low)`);

  writeEvidence("races", { results, popupCount, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("races", log);
  await browser.close();
  console.log(`races: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("races-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});