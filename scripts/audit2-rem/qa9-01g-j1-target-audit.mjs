/**
 * QA9 J1g: dispatch click targeting audit.
 * Evidence: evidence/fix4-qa9-j1g-*.json
 */
import { client, launchBrowser, waitForAppReady, delay, selectProjectByTitle, currentProjectLabel, writeEvidence, shot, FIXTURE_TAG } from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J1-ESTIMATOR`;
const p = (await c.query("projects:listProjects", {})).find((x) => x.title === PROJECT);
const pkg = await c.mutation("tradePackages:createTradePackage", {
  projectId: p._id, csiDivision: "14 00 00", tradeName: "QA9 Conveying Systems", budgetEstimate: 410000,
  scopeSummary: "Elevator conveying probe.", mandatoryInclusions: ["Factory startup"],
  bidDeadline: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
});
await c.mutation("contractors:createContractor", {
  tradePackageId: pkg, companyName: "QA9 Vertical Systems", contactEmail: "bids@qa9-vertical.test",
  phone: "(208) 555-0601", licenseNumber: "ID-QA9-5001", licenseStatus: "Active & Verified",
  sourceUrl: "https://qa9-vertical.test", rfqStatus: "discovered",
});

async function snapshotAll() {
  const projects = await c.query("projects:listProjects", {});
  const out = [];
  for (const pr of projects) {
    const pkgs = await c.query("tradePackages:listByProject", { projectId: pr._id });
    for (const pk of pkgs) out.push(`${pr.title} | ${pk.csiDivision} ${pk.tradeName} | ${pk.status}`);
  }
  return out;
}

const result = { journey: "J1g", data: { pkgId: pkg } };
result.data.before = await snapshotAll();
const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
try {
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  const sel = await selectProjectByTitle(page, PROJECT);
  result.data.selectResult = sel;
  await delay(1800);
  result.data.currentLabel = await currentProjectLabel(page);
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
          let card = node;
          return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, cardText: (card.textContent || "").slice(0, 120), elementAtPoint: (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) || {}).outerText?.slice(0, 80) };
        }
        node = node.parentElement;
      }
    }
    return { ok: false };
  }, "QA9 Conveying Systems");
  result.data.hit = hit;
  if (hit.ok) {
    await page.mouse.click(hit.x, hit.y);
    const toasts = [];
    for (let i = 0; i < 24; i++) {
      await delay(500);
      const t = await page.evaluate(() => { const el = document.querySelector('[role="status"]'); return el ? el.innerText.trim() : null; });
      if (t && !toasts.includes(t)) toasts.push(t);
      if (toasts.length && i > 3) break;
    }
    result.data.toasts = toasts;
  }
  await delay(2000);
  result.data.after = await snapshotAll();
  await shot(page, "fix4-qa9-j1g.png");
} catch (err) {
  result.crash = String(err?.message ?? err);
} finally {
  writeEvidence("j1g-estimator", result);
  await browser.close();
}
const changed = result.data.after.filter((x) => !result.data.before.includes(x));
console.log("label:", result.data.currentLabel, "| hit ok:", result.data.hit?.ok);
console.log("toasts:", JSON.stringify(result.data.toasts ?? []));
console.log("changed rows:", JSON.stringify(changed, null, 1));