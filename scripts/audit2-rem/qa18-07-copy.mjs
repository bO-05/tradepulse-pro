import { launchBrowser, attachDiagnostics, waitForAppReady, delay, clickTab, shot } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog, client } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};

async function main() {
  const c = client();
  const beforeLogs = (await c.query("auditLogs:listRecentLogs", { projectId: fx.live.id, limit: 200 })) || [];
  out.auditBefore = beforeLogs.map((l) => l.title).slice(0, 10);

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${fx.live.id}&tab=leveling&qa18=copy`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  // pick Div 26 package
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("AUDIT-QA18-LIVE Alpha Electrical"));
    if (b) b.click();
  });
  await delay(1500);

  const awardBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Award Compliant Winner"));
    if (!b) return { ok: false };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.textContent || "").trim().slice(0, 90) };
  });
  say(`award click: ${JSON.stringify(awardBtn)}`);
  await delay(3500);
  const banner = await page.evaluate(() => {
    const t = document.body.innerText;
    const clashBtn = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Check Scope Clashes"));
    return {
      bannerText: t.split("Subcontract Awarded")[1]?.slice(0, 300) || null,
      clashButton: clashBtn ? (clashBtn.textContent || "").replace(/\s+/g, " ").trim() : null,
    };
  });
  say(`banner: ${JSON.stringify(banner)}`);
  out.banner = banner;
  await shot(page, "fix4-qa18-copy-award-banner.png");

  if (banner.clashButton) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Check Scope Clashes"));
      b.click();
    });
    await delay(2500);
    const coord = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        hasVfd: t.includes("Variable Frequency Drives"),
        hasDeducted: t.includes("deducted") || t.includes("Deducted"),
        clashBadge: (() => {
          const b = [...document.querySelectorAll("button")].find((x) => /Clashes|Clear/.test(x.textContent || ""));
          return b ? (b.textContent || "").replace(/\s+/g, " ").trim() : null;
        })(),
        head: t.split("Real-Time Cross-Trade")[1]?.slice(0, 250) || t.slice(0, 250),
      };
    });
    say(`coordination after claim: ${JSON.stringify(coord)}`);
    out.coordination = coord;
    await shot(page, "fix4-qa18-copy-coordination.png");
  }

  const afterLogs = (await c.query("auditLogs:listRecentLogs", { projectId: fx.live.id, limit: 200 })) || [];
  out.auditAfterAward = afterLogs.map((l) => l.title).slice(0, 12);
  const deductionLogs = afterLogs.filter((l) => /deduct/i.test(l.title + " " + (l.description || "")));
  out.deductionLogs = deductionLogs.map((l) => l.title);

  // Tour scene 5 (coordination) action
  const tourState = await page.evaluate(() => {
    const toggle = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Toggle Investor Demo Tour"));
    const barOpen = document.body.innerText.includes("Executive Demo Tour");
    if (!barOpen && toggle) toggle.click();
    return { barOpen, clicked: !barOpen };
  });
  say(`tour: ${JSON.stringify(tourState)}`);
  await delay(800);
  const sceneClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "05");
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
  await delay(800);
  const sceneInfo = await page.evaluate(() => {
    const t = document.body.innerText;
    return { title: t.match(/Scene 5[^\n]*/)?.[0] || t.match(/05[^\n]{0,80}/)?.[0] || null };
  });
  say(`scene click=${JSON.stringify(sceneClick)} info=${JSON.stringify(sceneInfo)}`);
  const actionClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Advance to Scope Clash Engine"));
    if (!b) return { ok: false, avail: [...document.querySelectorAll("button")].map((x) => (x.textContent || "").trim()).filter(Boolean).slice(0, 50) };
    b.click();
    return { ok: true };
  });
  say(`action click: ${JSON.stringify(actionClick)}`);
  await delay(3000);
  const toast = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[role="status"]')].map((e) => (e.textContent || "").trim());
    return els;
  });
  const afterTourLogs = (await c.query("auditLogs:listRecentLogs", { projectId: fx.live.id, limit: 200 })) || [];
  const tourDeductions = afterTourLogs.filter((l) => /deduct/i.test(l.title + " " + (l.description || "")));
  say(`toast after tour action: ${JSON.stringify(toast)}`);
  say(`deduction logs after tour: ${JSON.stringify(tourDeductions.map((l) => l.title))}`);
  out.tour = { sceneClick, sceneInfo, actionClick, toast, deductionLogsAfter: tourDeductions.map((l) => l.title) };
  await shot(page, "fix4-qa18-copy-tour-toast.png");

  out.pageErrors = diag.pageErrors.slice(0, 5);
  writeEvidence("copy", out);
  writeLog("copy", log);
  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  writeLog("copy-crash", [String(e && e.stack ? e.stack : e)]);
  process.exit(1);
});