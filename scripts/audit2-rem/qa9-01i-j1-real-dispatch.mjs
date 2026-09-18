/**
 * QA9 J1i: correct UI dispatch targeting (card-scoped) on QA9 Conveying Systems.
 * Evidence: evidence/fix4-qa9-j1i-*.json
 */
import { client, launchBrowser, attachDiagnostics, diagnosticsSummary, waitForAppReady, delay, selectProjectByTitle, writeEvidence, shot, FIXTURE_TAG } from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J1-ESTIMATOR`;
const p = (await c.query("projects:listProjects", {})).find((x) => x.title === PROJECT);
const pkg = (await c.query("tradePackages:listByProject", { projectId: p._id })).find((x) => x.tradeName === "QA9 Conveying Systems");
const result = { journey: "J1i", data: { pkgId: pkg._id } };
const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
try {
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, PROJECT);
  await delay(1600);
  await page.keyboard.press("Digit1");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => (b.getAttribute("title") || "").includes("Dispatch RFQ")), { timeout: 10000 });
  const hit = await page.evaluate((ct) => {
    const cards = [...document.querySelectorAll("div")]
      .filter((d) => d.querySelector('button[title*="Dispatch RFQ"]') && (d.textContent || "").includes(ct))
      .sort((a, b) => a.textContent.length - b.textContent.length);
    const card = cards[0];
    if (!card) return { ok: false };
    const b = card.querySelector('button[title*="Dispatch RFQ"]');
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, cardHead: card.textContent.slice(0, 90) };
  }, "QA9 Conveying Systems");
  result.data.card = hit;
  if (hit.ok) {
    await page.mouse.click(hit.x, hit.y);
    const toasts = [];
    for (let i = 0; i < 30; i++) {
      await delay(500);
      const t = await page.evaluate(() => { const el = document.querySelector('[role="status"]'); return el ? el.innerText.trim() : null; });
      if (t && !toasts.includes(t)) toasts.push(t);
      if (toasts.length && i > 5) break;
    }
    result.data.toasts = toasts;
  }
  await delay(1500);
  const after = await c.query("tradePackages:getPackage", { tradePackageId: pkg._id });
  const ctrs = (await c.query("contractors:listByProject", { projectId: p._id })).filter((x) => x.tradePackageId === pkg._id);
  result.data.statusAfter = after.status;
  result.data.contractors = ctrs.map((x) => `${x.companyName}:${x.rfqStatus}`);
  result.console = diagnosticsSummary(diag);
  await shot(page, "fix4-qa9-j1i.png");
} catch (err) {
  result.crash = String(err?.message ?? err);
} finally {
  writeEvidence("j1i-estimator", result);
  await browser.close();
}
console.log("card:", JSON.stringify(result.data.card));
console.log("toasts:", JSON.stringify(result.data.toasts ?? []));
console.log("status:", result.data.statusAfter, "| ctrs:", JSON.stringify(result.data.contractors));