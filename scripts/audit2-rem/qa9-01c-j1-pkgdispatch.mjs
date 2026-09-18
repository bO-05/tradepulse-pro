/**
 * QA9 J1c: tab navigation reliability + dispatch WITH contractors on J1 fixture.
 * Evidence: evidence/fix4-qa9-j1c-*.json
 */
import { client, launchBrowser, attachDiagnostics, diagnosticsSummary, waitForAppReady, delay, selectProjectByTitle, clickByText, shot, writeEvidence, FIXTURE_TAG } from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J1-ESTIMATOR`;
const MANUAL_TRADE = "Specialties & Signage QA9";
const log = []; const problems = [];
const step = (s) => { log.push(s); console.log("STEP:", s); };

const proj = (await c.query("projects:listProjects", {})).find((p) => p.title === PROJECT);
const manualPkg = (await c.query("tradePackages:listByProject", { projectId: proj._id })).find((p) => p.tradeName === MANUAL_TRADE);

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
const result = { journey: "J1c", steps: log, data: {} };

async function toastNow(timeout = 9000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await page.evaluate(() => { const el = document.querySelector('[role="status"]'); return el ? el.innerText.trim() : null; });
    if (t) return t;
    await delay(150);
  }
  return null;
}

async function activeViewHints() {
  return page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    return {
      hasDispatch: btns.some((b) => (b.getAttribute("title") || "").includes("Dispatch RFQ")),
      hasDiscover: btns.some((b) => (b.textContent || "").includes("Discover Trade Contractors")),
      hasInvite: btns.some((b) => (b.textContent || "").includes("Invite to Bid")),
      mainHeading: (document.querySelector("main")?.innerText || "").split("\n").slice(0, 3).join(" | "),
    };
  });
}

try {
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, PROJECT);
  await delay(1200);
  await clickByText(page, "Advance to Contractor Discovery", { exact: false }).catch(() => {});
  await delay(1000);
  result.data.onDiscovery = await activeViewHints();

  const tabClick = await clickByText(page, "CSI Scoping", { exact: false });
  result.data.tabClick = tabClick;
  let switched = null;
  try {
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => (b.getAttribute("title") || "").includes("Dispatch RFQ")), { timeout: 8000 });
    switched = true;
  } catch { switched = false; }
  result.data.tabSwitchWorked = switched;
  step(`tab back to packages worked=${switched} click=${JSON.stringify(tabClick)}`);
  if (!switched) {
    problems.push({ id: "A9-15", sev: "Medium", title: "Packages tab click did not render packages view from Discovery", detail: JSON.stringify(await activeViewHints()) });
    await shot(page, "fix4-qa9-j1c-tab-fail.png");
    await page.keyboard.press("Digit1");
    try { await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => (b.getAttribute("title") || "").includes("Dispatch RFQ")), { timeout: 8000 }); switched = true; } catch {}
    result.data.keyboardShortcutWorked = switched;
  }
  await shot(page, "fix4-qa9-j1c-packages.png");

  const dispatch = await page.evaluate((ct) => {
    const buttons = [...document.querySelectorAll("button")].filter((b) => (b.getAttribute("title") || "").includes("Dispatch RFQ"));
    for (const b of buttons) {
      let node = b;
      for (let i = 0; i < 8 && node; i++) {
        if ((node.textContent || "").includes(ct)) {
          b.scrollIntoView({ block: "center" });
          const r = b.getBoundingClientRect();
          return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        node = node.parentElement;
      }
    }
    return { ok: false };
  }, MANUAL_TRADE);
  result.data.dispatchFound = dispatch;
  if (dispatch.ok) {
    await page.mouse.click(dispatch.x, dispatch.y);
    const toast = await toastNow(15000);
    result.data.dispatchToast = toast;
    step(`dispatch-with toast=${JSON.stringify(toast)}`);
    await delay(1500);
  }
  const pkgNow = (await c.query("tradePackages:listByProject", { projectId: proj._id })).find((p) => p._id === manualPkg._id);
  const ctrs = (await c.query("contractors:listByProject", { projectId: proj._id })).filter((x) => x.tradePackageId === manualPkg._id);
  result.data.statusAfter = pkgNow?.status;
  result.data.contractorStatuses = ctrs.map((x) => `${x.companyName}:${x.rfqStatus}`);
  step(`status after dispatch=${pkgNow?.status}; contractors=${result.data.contractorStatuses.join(",")}`);
  if (pkgNow?.status === "draft") problems.push({ id: "A9-16", sev: "Medium", title: "Dispatch with 2 contractors left package in draft", detail: JSON.stringify(result.data) });
  if (result.data.dispatchToast && /failed|error/i.test(result.data.dispatchToast) && ctrs.some((x) => x.rfqStatus !== "invited")) {
    problems.push({ id: "A9-17", sev: "Medium", title: "Dispatch failed despite eligible contractors", detail: result.data.dispatchToast });
  }
  await shot(page, "fix4-qa9-j1c-dispatched.png");
  result.console = diagnosticsSummary(diag);
} catch (err) {
  problems.push({ id: "A9-90", sev: "High", title: "J1c crashed: " + (err?.message ?? String(err)).split("\n")[0] });
} finally {
  result.findings = problems;
  result.verdict = problems.some((p) => p.sev === "High") ? "blocked" : problems.length ? "complete-with-issues" : "complete";
  writeEvidence("j1c-estimator", result);
  await browser.close();
}
console.log(`J1c verdict=${result.verdict} findings=${problems.length}`);