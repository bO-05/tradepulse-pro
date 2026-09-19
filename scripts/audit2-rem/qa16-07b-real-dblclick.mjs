import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { client, writeEvidence, writeLog, sleep } from "./qa16-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const ps = await c.query("projects:listProjects", {});
  const journey = ps.find((p) => p.title === "AUDIT-QA16-JOURNEY");
  const jPkgs = await c.query("tradePackages:listByProject", { projectId: journey._id });
  const div26 = jPkgs.find((p) => p.csiDivision === "26 00 00");
  say(`journey=${journey._id} div26=${div26._id} name=${div26.tradeName}`);

  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`https://brainy-skunk-440.convex.site/?project=${journey._id}&tab=leveling&qa16=dblclick2`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
    b?.click();
  });
  await delay(1200);

  // click the Div 26 package in whatever ribbon/selector is present
  const pick = await page.evaluate((needle) => {
    const btns = [...document.querySelectorAll("button")];
    const hits = btns.filter((b) => (b.textContent || "").includes(needle));
    if (!hits.length) return { ok: false, sample: btns.map((b) => (b.textContent || "").trim().slice(0, 40)).slice(0, 30) };
    hits[0].click();
    return { ok: true, text: hits[0].textContent.trim().slice(0, 80) };
  }, div26.tradeName);
  say(`pick=${JSON.stringify(pick)}`);
  await delay(1000);

  const box = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Award Compliant Winner"));
    if (!b) return null;
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: b.disabled, text: b.textContent.trim().slice(0, 60) };
  });
  const out = { pick, box };
  if (box) {
    await page.mouse.click(box.x, box.y);
    await delay(120);
    const mid = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Award Compliant Winner"));
      return { disabled: b ? b.disabled : "gone", ariaBusy: document.querySelector('[aria-busy="true"]') ? true : false };
    });
    await page.mouse.click(box.x, box.y);
    await delay(2600);
    const agrs = (await c.query("agreements:listAgreements", { projectId: journey._id })).filter((a) => a.tradePackageId === div26._id);
    const logs = await c.query("auditLogs:listRecentLogs", { projectId: journey._id, limit: 200 });
    out.midClickState = mid;
    out.agreementRows = agrs.length;
    out.statuses = agrs.map((a) => a.status);
    out.awardLogs = logs.filter((l) => l.tradePackageId === div26._id && /Awarded|Re-Awarded/.test(l.title)).map((l) => l.title);
    await shot(page, "fix4-qa16-real-dblclick-award.png");
  }
  out.diag = { pageErrors: diag.pageErrors.slice(0, 5), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text).slice(0, 5) };
  writeEvidence("real-dblclick", out);
  writeLog("real-dblclick", log);
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
}

main().catch((e) => { console.error(e); writeLog("real-dblclick-crash", [String(e?.stack || e)]); process.exit(1); });