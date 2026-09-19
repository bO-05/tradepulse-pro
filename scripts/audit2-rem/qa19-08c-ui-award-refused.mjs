/** QA19-08c: UI award-other-bid refusal on the executed-contract package. */
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa19-lib.mjs";

const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${JSON.stringify(detail)}`);
};

async function main() {
  const c = client();
  const bidsBefore = (await c.query("bids:listByPackage", { tradePackageId: F.live.p1 })) || [];
  const agreementsBefore = (await c.query("agreements:listAgreements", { projectId: F.live.id })) || [];

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${F.live.id}&tab=leveling&qa19=awardrefused`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(2500);

  const click = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll("button")].filter(
      (b) => /Award Compliant Winner|Award Subcontract & Draft Agreement/.test(b.textContent || "")
    );
    const b = candidates[0];
    if (!b) return { ok: false, avail: [...document.querySelectorAll("button")].map((x) => (x.textContent || "").replace(/\s+/g, " ").trim()).slice(0, 60) };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90), candidates: candidates.length };
  });
  say(`award click: ${JSON.stringify(click)}`);
  await delay(3500);
  const ui = await page.evaluate(() => ({
    toasts: [...document.querySelectorAll('[role="status"]')].map((e) => (e.textContent || "").trim()),
    alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => (e.textContent || "").trim().slice(0, 220)),
  }));
  say(`ui after: ${JSON.stringify(ui)}`);
  await shot(page, "fix4-qa19-smoke-award-refused.png");

  const bidsAfter = (await c.query("bids:listByPackage", { tradePackageId: F.live.p1 })) || [];
  const agreementsAfter = (await c.query("agreements:listAgreements", { projectId: F.live.id })) || [];
  const toastText = ui.toasts.join(" | ");

  record("SMOKE.ui-award-other-refused-toast", /award failed/i.test(toastText) && /executed subcontract/i.test(toastText), {
    click,
    toasts: ui.toasts,
  });
  record(
    "SMOKE.ui-award-other-refused-no-state-change",
    bidsAfter.every((b) => b.isAwarded === (bidsBefore.find((x) => x._id === b._id) || {}).isAwarded) &&
      agreementsAfter.length === agreementsBefore.length &&
      agreementsAfter.filter((a) => a.status === "executed").length === 1,
    {
      bidsBefore: bidsBefore.map((b) => ({ id: b._id, isAwarded: b.isAwarded })),
      bidsAfter: bidsAfter.map((b) => ({ id: b._id, isAwarded: b.isAwarded })),
      agreementsBefore: agreementsBefore.length,
      agreementsAfter: agreementsAfter.length,
    }
  );

  const out = { click, ui, bidsAfter: bidsAfter.map((b) => ({ id: b._id, name: b.subcontractorName, isAwarded: b.isAwarded })), results, pageErrors: diag.pageErrors.slice(0, 3) };
  writeEvidence("smoke-award-refused", out);
  writeLog("smoke-award-refused", log);
  await browser.close();
  console.log(`results: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("smoke-award-refused-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});