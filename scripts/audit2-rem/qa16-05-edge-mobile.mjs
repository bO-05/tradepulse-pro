import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickButtonByText } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, EVIDENCE_DIR } from "./qa16-lib.mjs";

const fx = readEvidence("fixtures");
const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = { checks: [] };
const check = (name, value) => { results.checks.push({ name, ...value }); say(`[${name}] ${JSON.stringify(value).slice(0, 320)}`); };

const clickPackageCard = (page, needle) =>
  page.evaluate((n) => {
    const cards = [...document.querySelectorAll("div")].filter((d) => String(d.className || "").includes("cursor-pointer") && (d.textContent || "").includes(n));
    if (!cards.length) return { ok: false };
    const card = cards[cards.length - 1];
    card.click();
    return { ok: true, text: (card.textContent || "").slice(0, 100) };
  }, needle);

async function selectTab(page, label) {
  const r = await clickButtonByText(page, label);
  await delay(650);
  return r;
}

async function main() {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const cdp = await page.createCDPSession();
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa16-downloads");
  fs.mkdirSync(dlDir, { recursive: true });
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });

  try {
    await page.goto(`https://brainy-skunk-440.convex.site/?project=${fx.projectEdge.id}&tab=packages&qa16=edge`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(800);

    // 1) Edge data renders without crash; scan for undefined/NaN leaks
    const edgeScan = await page.evaluate(() => {
      const t = document.body.innerText;
      const longCard = [...document.querySelectorAll("div")].find((d) => (d.textContent || "").includes("超長"));
      const longText = longCard ? longCard.querySelector("h3,h4,p,div") : null;
      return {
        hasUndefined: /undefined/.test(t),
        hasNaN: /\bNaN\b/.test(t),
        hasEmojiPkg: t.includes("Électricité") && t.includes("🚧"),
        longNameShown: Boolean(longCard),
        longNameLen: longText ? (longText.textContent || "").length : 0,
        cardOverflow: longCard ? { scrollW: longCard.scrollWidth, clientW: longCard.clientWidth } : null,
      };
    });
    check("edge-render", edgeScan);
    await shot(page, "fix4-qa16-edge-packages.png", { full: true });

    // 2) Award the unicode/empty-lineItems bid via UI and inspect contract + print popup
    await selectTab(page, "Bid Leveling");
    const sel = await clickPackageCard(page, "超長");
    await delay(900);
    const award = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Award Compliant Winner"));
      if (!b) return { ok: false, buttons: [...document.querySelectorAll("button")].map((x) => (x.textContent || "").trim()).slice(0, 30) };
      b.click();
      return { ok: true, text: (b.textContent || "").trim() };
    });
    await delay(2500);
    const agreements = await c.query("agreements:listAgreements", { projectId: fx.projectEdge.id });
    check("edge-award", { sel, award, agreementCount: agreements.length, number: agreements[0]?.agreementNumber || null });

    await selectTab(page, "Subcontracts");
    await delay(500);
    const inspect = await clickButtonByText(page, "Inspect Draft");
    await delay(900);
    const viewer = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.textContent || "").includes("AGREEMENT made as of"));
      const text = dlg ? dlg.innerText : "";
      return {
        found: Boolean(dlg),
        textLen: text.length,
        hasMandatoryHeading: /MANDATORY INCLUSIONS/i.test(text),
        hasUndefined: /undefined/.test(text),
        hasNaN: /\bNaN\b/.test(text),
        printButton: Boolean(dlg && [...dlg.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "").includes("Print"))),
      };
    });
    check("edge-contract-viewer", viewer);

    if (viewer.found) {
      const before = browser.targets().length;
      const popupPromise = new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), 4000);
        browser.once("targetcreated", async (target) => {
          clearTimeout(t);
          try {
            const p = await target.page();
            await delay(1200);
            resolve(p ? { url: p.url(), textLen: (await p.evaluate(() => document.body.innerText)).length } : { url: null, textLen: 0 });
          } catch (e) { resolve({ error: String(e).slice(0, 120) }); }
        });
      });
      await page.evaluate(() => {
        const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.textContent || "").includes("AGREEMENT made as of"));
        const b = dlg && [...dlg.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Print"));
        b?.click();
      });
      const popup = await popupPromise;
      check("edge-print-popup", { beforeTargets: before, popup });
      await shot(page, "fix4-qa16-edge-contract.png");
    }

    // 3) CSV export for empty-lineItems bid
    await selectTab(page, "Bid Leveling");
    await clickPackageCard(page, "超長");
    await delay(700);
    const csvClick = await clickButtonByText(page, "Export Leveling CSV");
    await delay(1500);
    const files = fs.existsSync(dlDir) ? fs.readdirSync(dlDir).filter((f) => f.endsWith(".csv")) : [];
    let csvTail = null;
    if (files.length) {
      const content = fs.readFileSync(path.join(dlDir, files[files.length - 1]), "utf8");
      csvTail = { file: files[files.length - 1], len: content.length, firstRow: content.split("\r\n")[0], dataRow: content.split("\r\n")[1] || null };
    }
    check("edge-csv", { csvClick, files, csvTail });

    // 4) Mobile + zoom overflow matrix
    const sizes = [
      { label: "320", w: 320, h: 700 },
      { label: "375", w: 375, h: 760 },
      { label: "768", w: 768, h: 900 },
      { label: "zoom200", w: 720, h: 450 },
    ];
    const tabs = ["CSI Scoping", "Discovery", "Pre-Bid Q&A", "Bid Leveling", "Scope Clash", "Subcontracts", "Live Activity Audit", "Evals & Architecture"];
    results.responsive = [];
    for (const sz of sizes) {
      await page.setViewport({ width: sz.w, height: sz.h, deviceScaleFactor: 1 });
      await delay(350);
      for (const tab of tabs) {
        await selectTab(page, tab);
        const m = await page.evaluate(() => {
          const de = document.documentElement;
          const vw = de.clientWidth;
          const clipped = [...document.querySelectorAll("button, a, input, select, textarea")].filter((el) => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || r.width === 0 || r.height === 0) return false;
            return r.right > vw + 2 || r.left < -2;
          }).slice(0, 6).map((el) => ({ tag: el.tagName, text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 50), right: Math.round(el.getBoundingClientRect().right), left: Math.round(el.getBoundingClientRect().left) }));
          return { vw, scrollW: de.scrollWidth, overflow: de.scrollWidth > vw + 1, bodyScrollW: document.body.scrollWidth, clipped };
        });
        results.responsive.push({ size: sz.label, tab, ...m });
        if (m.overflow || m.clipped.length) say(`[responsive] ${sz.label} ${tab} overflow=${m.overflow} scrollW=${m.scrollW} vw=${m.vw} clipped=${JSON.stringify(m.clipped)}`);
      }
      if (sz.label === "320") await shot(page, "fix4-qa16-mobile-320.png", { full: true });
    }
    const bad = results.responsive.filter((r) => r.overflow || r.clipped.length);
    check("responsive-summary", { total: results.responsive.length, flagged: bad.length, flaggedRows: bad.slice(0, 12) });

    results.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text).slice(0, 10), pageErrors: diag.pageErrors.slice(0, 10), failedRequests: diag.failedRequests.slice(0, 6) };
  } finally {
    await browser.close();
  }

  writeEvidence("edge-mobile", results);
  writeLog("edge-mobile", log);
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  writeLog("edge-mobile-crash", [String(e && e.stack ? e.stack : e)]);
  process.exit(1);
});