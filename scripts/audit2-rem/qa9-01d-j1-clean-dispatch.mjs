/**
 * QA9 J1d: clean UI dispatch on a fresh package with one contractor.
 * Evidence: evidence/fix4-qa9-j1d-*.json
 */
import { client, launchBrowser, attachDiagnostics, diagnosticsSummary, waitForAppReady, delay, selectProjectByTitle, clickByText, shot, writeEvidence, FIXTURE_TAG } from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J1-ESTIMATOR`;
const p = (await c.query("projects:listProjects", {})).find((x) => x.title === PROJECT);
const problems = []; const log = [];
const step = (s) => { log.push(s); console.log("STEP:", s); };

const existing = (await c.query("tradePackages:listByProject", { projectId: p._id })).find((x) => x.tradeName === "QA9 Equipment Test");
const pkgId = existing?._id || await c.mutation("tradePackages:createTradePackage", {
  projectId: p._id, csiDivision: "11 00 00", tradeName: "QA9 Equipment Test", budgetEstimate: 250000,
  scopeSummary: "Kitchen and laundry equipment for QA9.", mandatoryInclusions: ["Equipment startup"],
  bidDeadline: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
});
let ctr = (await c.query("contractors:listByProject", { projectId: p._id })).find((x) => x.tradePackageId === pkgId);
if (!ctr) {
  await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId, companyName: "QA9 Summit Equipment", contactEmail: "bids@qa9-summit.test",
    phone: "(208) 555-0301", licenseNumber: "ID-QA9-2001", licenseStatus: "Active & Verified",
    sourceUrl: "https://qa9-summit.test", rfqStatus: "discovered",
  });
  ctr = (await c.query("contractors:listByProject", { projectId: p._id })).find((x) => x.tradePackageId === pkgId);
}
console.log("fixture pkg", pkgId, "ctr", ctr?._id, ctr?.rfqStatus);

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
const result = { journey: "J1d", data: {}, steps: log };

async function toastNow(timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await page.evaluate(() => { const el = document.querySelector('[role="status"]'); return el ? el.innerText.trim() : null; });
    if (t) return t;
    await delay(150);
  }
  return null;
}

try {
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, PROJECT);
  await delay(1400);
  await page.keyboard.press("Digit1");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => (b.getAttribute("title") || "").includes("Dispatch RFQ")), { timeout: 10000 });
  const hit = await page.evaluate((ct) => {
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
  }, "QA9 Equipment Test");
  result.data.hit = hit;
  if (hit.ok) {
    await page.mouse.click(hit.x, hit.y);
    result.data.toast = await toastNow(15000);
    step(`toast=${JSON.stringify(result.data.toast)}`);
  }
  await delay(1500);
  const pkgNow = (await c.query("tradePackages:listByProject", { projectId: p._id })).find((x) => x._id === pkgId);
  const cNow = (await c.query("contractors:listByProject", { projectId: p._id })).filter((x) => x.tradePackageId === pkgId);
  result.data.statusAfter = pkgNow?.status;
  result.data.contractorsAfter = cNow.map((x) => `${x.companyName}:${x.rfqStatus}`);
  step(`status=${pkgNow?.status} ctrs=${result.data.contractorsAfter.join(",")}`);
  if (pkgNow?.status !== "rfqs_dispatched") problems.push({ id: "A9-18", sev: "Medium", title: "UI dispatch did not move package to rfqs_dispatched", detail: JSON.stringify(result.data) });
  if (!result.data.contractorsAfter.some((s) => s.endsWith(":invited"))) problems.push({ id: "A9-19", sev: "Medium", title: "UI dispatch did not mark eligible contractor invited", detail: JSON.stringify(result.data) });
  await shot(page, "fix4-qa9-j1d-dispatch.png");
  result.console = diagnosticsSummary(diag);
} catch (err) {
  problems.push({ id: "A9-90", sev: "High", title: "J1d crashed: " + (err?.message ?? String(err)).split("\n")[0] });
} finally {
  result.findings = problems;
  result.verdict = problems.some((x) => x.sev === "High") ? "blocked" : problems.length ? "complete-with-issues" : "complete";
  writeEvidence("j1d-estimator", result);
  await browser.close();
}
console.log(`J1d verdict=${result.verdict} findings=${problems.length}`);