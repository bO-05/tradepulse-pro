/**
 * QA23-03 A21-02 (live UI, AUDIT-QA23-VOID):
 *  void an execution from the open Contracts viewer -> viewer flips to
 *  "Superseded - read-only", no Void button, no Record External Execution button;
 *  backend agreement superseded. Closing and reopening the viewer shows the same.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, projectSnapshot } from "./qa23-lib.mjs";

const F = readEvidence("01-fixtures");
const V = F.void;
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1100)}`);
};

async function dismissTour(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(600);
}

function viewerState(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).find((x) => /A401-style Subcontract Draft/.test(x.innerText || ""));
    if (!d) return { open: false };
    const t = d.innerText || "";
    const buttons = [...d.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim());
    return {
      open: true,
      badgeExecuted: /Execution Status Recorded/i.test(t),
      badgeSuperseded: /Superseded/i.test(t),
      badgeReadOnly: /read-only/i.test(t),
      badgePending: /Generated \/ Pending Execution/i.test(t),
      executedBanner: /Execution recorded in TradePulse/i.test(t),
      hasVoidButton: buttons.some((b) => b === "Void execution record"),
      hasRecordButton: buttons.some((b) => b === "Record External Execution"),
      buttons: buttons.slice(0, 16),
    };
  });
}

async function openViewer(page) {
  const click = await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    let b = [...document.querySelectorAll("button")].filter(vis).find((x) => (x.textContent || "").trim() === "Inspect Draft");
    return { ok: Boolean(b) };
  });
  if (!click.ok) {
    await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].filter(vis).find((x) => /^Superseded/.test((x.textContent || "").trim()));
      b?.click();
    });
    await delay(900);
  }
  await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const b = [...document.querySelectorAll("button")].filter(vis).find((x) => (x.textContent || "").trim() === "Inspect Draft");
    b?.scrollIntoView({ block: "center" });
    b?.click();
  });
  for (let i = 0; i < 30; i++) {
    const s = await viewerState(page);
    if (s.open) return s;
    await delay(250);
  }
  return viewerState(page);
}

async function main() {
  const c = client();
  // Re-arm: make the script re-runnable even after a previous void.
  const preSnap = await projectSnapshot(c, V.id);
  const preAgr = preSnap.agreements.find((a) => a._id === V.agreementId);
  if (preAgr && preAgr.status !== "executed") {
    const rearmed = await c.mutation("agreements:generateAgreement", { bidId: V.bids.alpha, tradePackageId: V.packageId });
    const rearmedId = rearmed?._id ?? V.agreementId;
    await c.mutation("agreements:executeAgreement", { agreementId: rearmedId });
    say(`re-armed agreement ${rearmedId} to executed before the void pass`);
  }
  const backendBefore = await projectSnapshot(c, V.id);
  const agrBefore = backendBefore.agreements.find((a) => a._id === V.agreementId);
  say(`backend pre-void: agreement=${agrBefore?.status} awarded=${backendBefore.bids.find((b) => b._id === V.bids.alpha)?.isAwarded}`);

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  await page.goto(`${BASE}/?project=${V.id}&tab=contracts&qa23=a21-02`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await dismissTour(page);
  await delay(2200);

  // ---------- pre-state: executed viewer with Void offered ----------
  const open1 = await openViewer(page);
  await shot(page, "fix4-qa23-void-viewer-executed.png");
  record(
    "A21-02.1",
    "pre-void: open viewer shows Execution Status Recorded + Void execution record",
    open1.open && open1.badgeExecuted && open1.executedBanner && open1.hasVoidButton && !open1.hasRecordButton,
    open1
  );

  // ---------- void from the open viewer ----------
  const voidClick = await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).find((x) => /A401-style Subcontract Draft/.test(x.innerText || ""));
    const b = d ? [...d.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Void execution record") : null;
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
  await delay(700);
  const voidDlg = await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const d = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
    if (!d) return { open: false };
    return {
      open: true,
      title: (d.querySelector("h2") || {}).innerText || "",
      confirm: [...d.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).find((x) => x === "Void execution record") || null,
    };
  });
  const t0 = Date.now();
  const voidConfirm = await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const d = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
    if (!d) return false;
    const b = [...d.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Void execution record");
    if (!b) return false;
    b.click();
    return true;
  });

  let postVoid = null;
  for (let i = 0; i < 120; i++) {
    await delay(120);
    const s = await viewerState(page);
    if (s.open && s.badgeSuperseded && !s.hasVoidButton) { postVoid = s; break; }
  }
  postVoid = postVoid || (await viewerState(page));
  const elapsedMs = Date.now() - t0;
  const backendAfter = await projectSnapshot(c, V.id);
  const agrAfter = backendAfter.agreements.find((a) => a._id === V.agreementId);
  const awardedAfter = backendAfter.bids.filter((b) => b.isAwarded).length;
  const pkgAfter = backendAfter.packages.find((p) => p._id === V.packageId)?.status;
  await delay(600);
  await shot(page, "fix4-qa23-void-viewer-superseded.png");

  record(
    "A21-02.2",
    "after void from the open viewer: Superseded read-only badge, no Void, no Record External Execution, backend superseded",
    voidClick.ok && voidDlg.open && voidConfirm &&
      Boolean(postVoid?.open) && postVoid.badgeSuperseded && postVoid.badgeReadOnly &&
      !postVoid.badgeExecuted && !postVoid.badgePending && !postVoid.executedBanner &&
      !postVoid.hasVoidButton && !postVoid.hasRecordButton &&
      agrAfter?.status === "superseded" && awardedAfter === 0 && pkgAfter === "leveling",
    { voidDlg, postVoid, elapsedMs, agreementStatus: agrAfter?.status, packageStatus: pkgAfter, awardedBids: awardedAfter }
  );

  // ---------- close + reopen: same read-only state ----------
  await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).find((x) => /A401-style Subcontract Draft/.test(x.innerText || ""));
    const b = d ? [...d.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Close Viewer") : null;
    b?.click();
  });
  await delay(900);
  const closed = await viewerState(page);
  const open2 = await openViewer(page);
  await shot(page, "fix4-qa23-void-viewer-reopened.png");
  record(
    "A21-02.3",
    "close + reopen: same Superseded read-only state; no Void and no Record External Execution",
    closed.open === false && open2.open && open2.badgeSuperseded && open2.badgeReadOnly &&
      !open2.badgePending && !open2.hasVoidButton && !open2.hasRecordButton,
    { closed, open2 }
  );

  // ---------- register-level state truth ----------
  const register = await page.evaluate(() => {
    const main = document.querySelector("main") || document.body;
    const metricEls = [...main.querySelectorAll("span")]
      .map((s) => (s.textContent || "").trim())
      .filter((t) => /^\d+\s*\/\s*\d+$/.test(t));
    return {
      executionMetric: metricEls[0] || null,
      executedLabelPresent: main.innerText.includes("Execution Status Recorded"),
      supersededFilterOffered: [...document.querySelectorAll("button")].some((b) => /^Superseded \(\d+\)/.test((b.textContent || "").trim())),
    };
  });
  record(
    "A21-02.4",
    "register reconciles: 0/N execution statuses after the void and a Superseded filter/N count appears",
    register.executionMetric && /^0\s*\/\s*\d+$/.test(register.executionMetric) && register.supersededFilterOffered,
    register
  );

  const out = {
    results,
    pageErrors: diag.pageErrors.slice(0, 8),
    consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 240)).slice(-8),
    summary: { pass: results.filter((r) => r.pass).length, total: results.length },
  };
  writeEvidence("03-a2102-ui", out);
  writeLog("03-a2102-ui", log);
  await browser.close();
  console.log(`a2102 ui: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("03-a2102-ui-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});