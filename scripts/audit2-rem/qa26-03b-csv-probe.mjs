/**
 * QA26-03b: isolate the leveling CSV truth after void (single export, read back
 * immediately) and dump the matrix row DOM around the tested bidder. Restores
 * the AWARD fixture to executed afterwards.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, waitForAppReady, delay, clickTab } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, EVIDENCE_DIR } from "./qa26-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  log.push(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1200)}`);
  console.log(log[log.length - 1]);
};

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa26-csv-probe");
  fs.mkdirSync(dlDir, { recursive: true });
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
  const dismissTour = () =>
    page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
  try {
    await page.goto(`${BASE}/?project=${F.award.id}&tab=leveling&qa26=csvprobe`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour();
    await delay(1800);
    await clickTab(page, "Bid Leveling");
    await delay(1200);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes("QA26 Award Electrical"));
      b?.click();
    });
    await delay(1500);

    // void the executed agreement A
    const agrs = (await c.query("agreements:listAgreements", { projectId: F.award.id })) || [];
    const agrA = agrs.find((a) => a.bidId === F.award.bids.a.bidId);
    if (agrA?.status === "executed") {
      await c.mutation("agreements:voidExecutedAgreement", { agreementId: agrA._id, reason: "QA26 CSV probe: void to test unawarded export truth." });
    }
    await delay(2500);

    const matrix = await page.evaluate(() => {
      const t = (document.querySelector("main") || document.body).innerText;
      const i = t.indexOf("AUDIT-QA26 Award Electric A");
      const j = t.indexOf("AUDIT-QA26 Award Electric B");
      return {
        aroundA: t.slice(Math.max(0, i - 200), i + 400).replace(/\n/g, " | "),
        aroundB: t.slice(Math.max(0, j - 200), j + 400).replace(/\n/g, " | "),
        locked: /Leveling Locked/.test(t),
        pkgStatusMatch: /QA26 Award Electrical[\s\S]{0,80}?(Awarded|Leveling|Draft)/.exec(t.replace(/\n/g, " "))?.[1] ?? null,
        awardsOnPage: (t.match(/Award Compliant Winner/g) || []).length,
      };
    });

    const csvClick = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Export Leveling CSV/.test(x.innerText || ""));
      if (b) { b.click(); return true; }
      return false;
    });
    await delay(3500);
    const files = fs.readdirSync(dlDir).filter((f) => f.endsWith(".csv"));
    const latest = files.map((f) => ({ f, t: fs.statSync(path.join(dlDir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
    const csv = latest ? fs.readFileSync(path.join(dlDir, latest), "utf8") : "";
    const rowA = csv.split(/\r?\n/).find((l) => l.includes("Award Electric A")) || "";
    const rowB = csv.split(/\r?\n/).find((l) => l.includes("Award Electric B")) || "";
    const after = (await c.query("agreements:listAgreements", { projectId: F.award.id })) || [];
    record(
      "A26-03b.1",
      "voided package CSV export truth: bid A row is UNAWARDED (no AWARDED claim while un-awarded)",
      csvClick && !/AWARDED/.test(rowA) && /UNAWARDED/.test(rowA) && /UNAWARDED/.test(rowB) &&
        after.find((a) => a._id === agrA?._id)?.status === "superseded",
      { matrix, rowA, rowB, status: after.find((a) => a._id === agrA?._id)?.status }
    );

    // restore: re-award + execute
    const reGen = await c.mutation("agreements:generateAgreement", { bidId: F.award.bids.a.bidId, tradePackageId: F.award.p26 });
    await c.mutation("agreements:executeAgreement", { agreementId: reGen._id });
    await delay(2200);
    const restored = (await c.query("agreements:listAgreements", { projectId: F.award.id })) || [];
    record(
      "A26-03b.2",
      "AWARD fixture restored to executed after the probe",
      restored.find((a) => a._id === reGen._id)?.status === "executed",
      { restored: restored.map((a) => ({ n: a.agreementNumber, s: a.status })) }
    );

    writeEvidence("csv-probe", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("csv-probe", log);
  } catch (err) {
    writeLog("csv-probe-crash", [String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});