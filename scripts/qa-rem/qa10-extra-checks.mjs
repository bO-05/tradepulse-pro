// QA-10 extra targeted checks:
//  A. Tour first-visit behavior + dismissal persistence (report LANDING claim).
//  B. Demo project Scope Clash still shows 2 double-buys ($50,500) + 2 voids ($46,500).
//  C. Fixture 375px leveling document-overflow offenders (isolate element).
// Usage: node scripts/qa-rem/qa10-extra-checks.mjs
import { launchBrowser, attachDiagnostics, shot, waitForAppReady, delay, BASE_URL, writeLog, getSelectorState, selectProjectByTitle } from "./qa1-lib.mjs";
import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const fixture = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-fixture.json"), "utf8"));
const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 600) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "…" : s;
};

async function clickTab(page, label) {
  return page.evaluate((label) => {
    const header = document.querySelector("header");
    const btns = header ? [...header.querySelectorAll("button")] : [];
    const match = btns.find((b) => (b.getAttribute("title") || "").includes(label) || [...b.querySelectorAll("span")].some((s) => (s.textContent || "").trim() === label));
    if (!match) return { ok: false };
    match.click();
    return { ok: true, text: (match.textContent || "").trim().slice(0, 50) };
  }, label);
}
async function mainSample(page, max = 1200) {
  return page.evaluate((max) => {
    const main = document.querySelector("main");
    return main ? main.innerText.replace(/\s+/g, " ").trim().slice(0, max) : "";
  }, max);
}
async function selectStageMobile(page, value) {
  return page.evaluate((value) => {
    const sel = document.querySelector('select[aria-label="Navigate procurement stage"]');
    if (!sel) return { ok: false };
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: sel.value };
  }, value);
}

async function run() {
  const { browser } = await launchBrowser();
  try {
    ev("=== QA-10 EXTRA CHECKS ===");
    ev(`UTC: ${new Date().toISOString()}`);
    ev("");

    // ---- A. tour first-visit + persistence ----
    const ctxA = await browser.createBrowserContext();
    const page = await ctxA.newPage();
    page.setDefaultTimeout(25000);
    const d = attachDiagnostics(page);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2500);
    const tourInfo = await page.evaluate(() => {
      const closeBtn = document.querySelector('button[title="Close Teleprompter"]');
      const expandBtn = document.querySelector('button[title="Expand Investor Demo Teleprompter"]');
      return {
        ls: (() => { try { return window.localStorage.getItem("tradepulse.tourDismissed"); } catch { return "ERR"; } })(),
        hasClose: Boolean(closeBtn),
        hasExpand: Boolean(expandBtn),
        sceneText: /Scene \d+\/06/.test(document.body.innerText),
        cueText: document.body.innerText.includes("Cue:"),
      };
    });
    ev(`[A] fresh context tour: ${J(tourInfo)}`);
    let dismissed = null;
    if (tourInfo.hasClose) {
      await page.evaluate(() => document.querySelector('button[title="Close Teleprompter"]').click());
      await delay(700);
      dismissed = await page.evaluate(() => ({
        ls: window.localStorage.getItem("tradepulse.tourDismissed"),
        stillHasClose: Boolean(document.querySelector('button[title="Close Teleprompter"]')),
      }));
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForAppReady(page);
      await delay(2000);
      const afterReload = await page.evaluate(() => ({
        ls: window.localStorage.getItem("tradepulse.tourDismissed"),
        hasClose: Boolean(document.querySelector('button[title="Close Teleprompter"]')),
      }));
      ev(`[A] after dismiss: ${J(dismissed)}; after reload: ${J(afterReload)}`);
      await shot(page, "remediation-qa10-10-tour-after-dismiss-reload.png");
    }
    const tourSessionA = { firstVisit: tourInfo, dismissed, consoleErrors: d.consoleLogs.filter((l) => l.type === "error").length };

    // ---- B. demo clash counts ----
    ev("");
    ev("[B] demo project Scope Clash counts");
    await selectProjectByTitle(page, "The Domain Tower B");
    await delay(2500);
    await clickTab(page, "Scope Clash");
    await delay(2000);
    const coord = await mainSample(page, 1400);
    const has50500 = coord.includes("50,500");
    const has46500 = coord.includes("46,500");
    ev(`[B] demo coordination contains 50,500=${has50500} 46,500=${has46500}`);
    ev(`[B] sample="${coord.slice(0, 900)}"`);
    await shot(page, "remediation-qa10-11-demo-coordination.png");
    const selDemo = await getSelectorState(page);

    // ---- C. fixture mobile 375 overflow offenders ----
    ev("");
    ev("[C] fixture mobile 375 leveling overflow offenders");
    const mctx = await browser.createBrowserContext();
    const mpage = await mctx.newPage();
    mpage.setDefaultTimeout(25000);
    await mpage.setViewport({ width: 375, height: 812 });
    await mpage.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(mpage);
    await delay(2000);
    await selectProjectByTitle(mpage, fixture.tag);
    await delay(2500);
    await selectStageMobile(mpage, "leveling");
    await delay(2000);
    const offenders = await mpage.evaluate(() => {
      const vw = window.innerWidth;
      const all = [...document.querySelectorAll("body *")];
      const out = [];
      for (const el of all) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > vw + 0.5) {
          // find nearest ancestor that clips horizontally
          let clipped = false;
          let p = el.parentElement;
          while (p && p !== document.body) {
            const ps = getComputedStyle(p);
            if ((ps.overflowX === "auto" || ps.overflowX === "hidden" || ps.overflowX === "scroll") && p.scrollWidth > p.clientWidth) {
              clipped = true;
              break;
            }
            p = p.parentElement;
          }
          out.push({
            tag: el.tagName,
            cls: (el.className || "").toString().slice(0, 80),
            text: (el.textContent || "").trim().slice(0, 60),
            right: Math.round(r.right),
            width: Math.round(r.width),
            clippedByAncestor: clipped,
          });
        }
      }
      return {
        vw,
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        count: out.length,
        top: out.filter((o) => !o.clippedByAncestor).slice(0, 14),
      };
    });
    ev(`[C] ${J(offenders, 1800)}`);
    await shot(mpage, "remediation-qa10-12-mobile-fixture-leveling-overflow.png");

    ev("");
    ev(`[A] console errors on tour page: ${tourSessionA.consoleErrors}`);
    fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-extra-checks.json"), JSON.stringify({ tour: tourSessionA, demoClash: { has50500, has46500, sample: coord }, mobileFixture: offenders, demoSelector: selDemo }, null, 2), "utf8");
    writeLog("remediation-qa10-extra-checks.txt", LOG);
    console.log("Wrote evidence.");
  } finally {
    await browser.close();
  }
}
run().catch((e) => {
  console.error("FATAL", e);
  writeLog("remediation-qa10-extra-checks.txt", LOG.concat([`FATAL: ${e?.stack || e}`]));
  process.exit(1);
});