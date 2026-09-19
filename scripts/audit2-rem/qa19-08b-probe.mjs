/** QA19-08b: inspect leveling controls after the agreement is executed. */
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa19-lib.mjs";

const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const c = client();
  const agreements = (await c.query("agreements:listAgreements", { projectId: F.live.id })) || [];
  const executed = agreements.find((a) => a.status === "executed") || null;
  say(`executed agreement: ${JSON.stringify(executed ? { id: executed._id, bidId: executed.bidId, status: executed.status } : null)}`);

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${F.live.id}&tab=leveling&qa19=probe2`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(2500);
  const state = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")].map((b) => ({
      text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70),
      disabled: b.disabled,
    }));
    return {
      awardButtons: buttons.filter((b) => /Award/i.test(b.text) || /Unaward/i.test(b.text)),
      hasExecutedBanner: document.body.innerText.includes("executed"),
      hasLockedHint: document.body.innerText.includes("Leveling locked"),
      subA: document.body.innerText.includes("AUDIT-QA19-LIVE Alpha Sub A"),
      subB: document.body.innerText.includes("AUDIT-QA19-LIVE Alpha Sub B"),
      bodyHead: document.body.innerText.slice(0, 400),
    };
  });
  say(`state: ${JSON.stringify(state, null, 1)}`);
  await shot(page, "fix4-qa19-smoke-leveling-after-exec.png");

  // Try the award path the UI actually uses for the other bid (generateAgreement).
  const click = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Award/i.test(x.textContent || "") && !/Unaward/i.test(x.textContent || ""));
    if (!b) return { ok: false };
    b.click();
    return { ok: true, text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) };
  });
  await delay(3500);
  const after = await page.evaluate(() => ({
    toasts: [...document.querySelectorAll('[role="status"]')].map((e) => (e.textContent || "").trim()),
    inlineAlerts: [...document.querySelectorAll('[role="alert"]')].map((e) => (e.textContent || "").trim().slice(0, 200)),
  }));
  say(`click=${JSON.stringify(click)} after=${JSON.stringify(after)}`);

  const bids = (await c.query("bids:listByPackage", { tradePackageId: F.live.p1 })) || [];
  const agreementsAfter = (await c.query("agreements:listAgreements", { projectId: F.live.id })) || [];
  const out = {
    executed: executed ? { id: executed._id, bidId: executed.bidId } : null,
    state,
    click,
    after,
    bids: bids.map((b) => ({ id: b._id, name: b.subcontractorName, isAwarded: b.isAwarded })),
    agreementCount: agreementsAfter.length,
    executedCount: agreementsAfter.filter((a) => a.status === "executed").length,
    pageErrors: diag.pageErrors.slice(0, 3),
  };
  writeEvidence("smoke-probe", out);
  writeLog("smoke-probe", log);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  writeLog("smoke-probe-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});