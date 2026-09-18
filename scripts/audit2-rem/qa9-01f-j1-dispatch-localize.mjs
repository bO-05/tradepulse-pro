/**
 * QA9 J1f: decisive dispatch failure localization (pre vs post mutation).
 * Evidence: evidence/fix4-qa9-j1f-*.json
 */
import { client, launchBrowser, waitForAppReady, delay, selectProjectByTitle, writeEvidence, shot, FIXTURE_TAG } from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J1-ESTIMATOR`;
const p = (await c.query("projects:listProjects", {})).find((x) => x.title === PROJECT);
const pkg = await c.mutation("tradePackages:createTradePackage", {
  projectId: p._id, csiDivision: "13 00 00", tradeName: "QA9 Special Construction", budgetEstimate: 220000,
  scopeSummary: "Special construction probe.", mandatoryInclusions: ["Coordination"],
  bidDeadline: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
});
await c.mutation("contractors:createContractor", {
  tradePackageId: pkg, companyName: "QA9 Apex Special", contactEmail: "bids@qa9-apex.test",
  phone: "(208) 555-0501", licenseNumber: "ID-QA9-4001", licenseStatus: "Active & Verified",
  sourceUrl: "https://qa9-apex.test", rfqStatus: "discovered",
});

async function logsForPkg() {
  const logs = await c.query("auditLogs:listRecentLogs", { projectId: p._id, limit: 300 });
  return logs.filter((l) => l.tradePackageId === pkg).map((l) => `${new Date(l.timestamp).toISOString()} ${l.title}`);
}

const result = { journey: "J1f", data: { pkgId: pkg, timeline: [] } };
result.data.logsBefore = await logsForPkg();

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
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
  }, "QA9 Special Construction");
  result.data.hit = hit;
  result.data.clickAt = new Date().toISOString();
  if (hit.ok) {
    await page.mouse.click(hit.x, hit.y);
    await delay(8000);
  }
  result.data.afterUiToast = await page.evaluate(() => { const el = document.querySelector('[role="status"]'); return el ? el.innerText.trim() : null; });
  result.data.logsAfterUi = await logsForPkg();
  const afterUi = await c.query("tradePackages:getPackage", { tradePackageId: pkg });
  result.data.statusAfterUi = afterUi.status;

  // Direct HTTP action on same package for comparison
  result.data.directAt = new Date().toISOString();
  let direct = null;
  try { direct = await c.raw.action("rfqActions:dispatchRfqsWithNotification", { tradePackageId: pkg }); } catch (e) { direct = { error: String(e?.message ?? e) }; }
  result.data.directResult = direct;
  result.data.logsAfterDirect = await logsForPkg();
  const afterDirect = await c.query("tradePackages:getPackage", { tradePackageId: pkg });
  result.data.statusAfterDirect = afterDirect.status;
  await shot(page, "fix4-qa9-j1f.png");
} catch (err) {
  result.crash = String(err?.message ?? err);
} finally {
  writeEvidence("j1f-estimator", result);
  await browser.close();
}
console.log(JSON.stringify(result.data, null, 1).slice(0, 3500));