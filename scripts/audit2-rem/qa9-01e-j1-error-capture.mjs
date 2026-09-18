/**
 * QA9 J1e: capture the full server error payload from UI dispatch.
 * Evidence: evidence/fix4-qa9-j1e-*.json
 */
import { client, launchBrowser, waitForAppReady, delay, selectProjectByTitle, shot, writeEvidence, FIXTURE_TAG } from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J1-ESTIMATOR`;
const p = (await c.query("projects:listProjects", {})).find((x) => x.title === PROJECT);
const pkg = await c.mutation("tradePackages:createTradePackage", {
  projectId: p._id, csiDivision: "12 00 00", tradeName: "QA9 Furnishings Probe", budgetEstimate: 180000,
  scopeSummary: "Furnishings for probe.", mandatoryInclusions: ["Install coordination"],
  bidDeadline: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
});
await c.mutation("contractors:createContractor", {
  tradePackageId: pkg, companyName: "QA9 Probe Furnishings", contactEmail: "bids@qa9-probe.test",
  phone: "(208) 555-0401", licenseNumber: "ID-QA9-3001", licenseStatus: "Active & Verified",
  sourceUrl: "https://qa9-probe.test", rfqStatus: "discovered",
});

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const consoleArgs = [];
page.on("console", async (m) => {
  if (m.type() !== "error") return;
  try {
    const vals = [];
    for (const a of m.args()) vals.push(await a.jsonValue().catch(() => String(a)));
    consoleArgs.push(vals);
  } catch {}
});
const result = { journey: "J1e", data: { pkgId: pkg } };

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
  }, "QA9 Furnishings Probe");
  result.data.hit = hit;
  if (hit.ok) {
    await page.mouse.click(hit.x, hit.y);
    await delay(6000);
    result.data.consoleArgs = consoleArgs.map((a) => a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))));
    const t = await page.evaluate(() => { const el = document.querySelector('[role="status"]'); return el ? el.innerText.trim() : null; });
    result.data.toast = t;
  }
  await shot(page, "fix4-qa9-j1e-error.png");
} catch (err) {
  result.crash = String(err?.message ?? err);
} finally {
  writeEvidence("j1e-estimator", result);
  await browser.close();
}
console.log(JSON.stringify(result.data.consoleArgs ?? result.crash, null, 1).slice(0, 3000));