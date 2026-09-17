// QA-8 (round 3) mobile 375x812 probe: overflow + nav usability (landing + detail tab).
// Usage: node scripts/qa-rem/qa8-mobile.mjs
import {
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  delay,
  BASE_URL,
  writeLog,
  getSelectorState,
  selectProjectByTitle,
} from "./qa1-lib.mjs";

const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 500) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "…" : s;
};

const diag = {};
const httpErrors = [];

async function overflowReport(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const docSw = document.documentElement.scrollWidth;
    const bodySw = document.body.scrollWidth;
    const offenders = [];
    for (const el of document.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || "").slice(0, 70),
          text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 45),
          right: Math.round(r.right),
          width: Math.round(r.width),
        });
        if (offenders.length >= 20) break;
      }
    }
    return { vw, docSw, bodySw, horizontalOverflowPx: Math.max(docSw, bodySw) - vw, offenders };
  });
}

async function mobileNavReport(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        visible: cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0,
        inViewportX: r.x >= 0 && r.right <= window.innerWidth + 1,
      };
    };
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      projectSelector: box(q('select[aria-label="Select Commercial Construction Project"]')),
      stageSelect: box(q('select[aria-label="Navigate procurement stage"]')),
      newProjectBtn: box([...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("New Project"))),
      pipelineNavVisible: box(q("header .hidden.sm\\:flex")),
      topBar: box(q("header > div")),
    };
  });
}

async function setStageSelect(page, value) {
  return page.evaluate((value) => {
    const sel = document.querySelector('select[aria-label="Navigate procurement stage"]');
    if (!sel) return { ok: false };
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: sel.value };
  }, value);
}

async function activeStage(page) {
  return page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Navigate procurement stage"]');
    return sel ? sel.value : null;
  });
}

async function mainSample(page, max = 300) {
  return page.evaluate((max) => {
    const main = document.querySelector("main");
    return main ? main.innerText.replace(/\s+/g, " ").trim().slice(0, max) : null;
  }, max);
}

async function run() {
  const { browser } = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(25000);
    Object.assign(diag, attachDiagnostics(page));
    page.on("response", (r) => {
      if (r.status() >= 400) httpErrors.push({ status: r.status(), method: r.request().method(), url: r.url() });
    });
    await page.setViewport({ width: 375, height: 812 });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);

    ev("=== QA-8 MOBILE 375x812 PROBE ===");
    ev(`Base URL: ${BASE_URL}`);
    ev(`UTC: ${new Date().toISOString()}`);
    ev("");

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(2000);

    ev("[landing] URL after load: " + page.url());
    const sel0 = await getSelectorState(page);
    ev(`[landing] selector: ${J({ selected: sel0.selectedText, count: sel0.options.length })}`);
    const ov0 = await overflowReport(page);
    ev(`[landing] viewport=${ov0.vw} docScrollWidth=${ov0.docSw} bodyScrollWidth=${ov0.bodySw} horizontalOverflowPx=${ov0.horizontalOverflowPx}`);
    for (const o of ov0.offenders) ev(`[landing] overflow-offender ${J(o)}`);
    const nav0 = await mobileNavReport(page);
    ev(`[landing] nav: ${J(nav0)}`);
    await shot(page, "remediation-qa8-mobile-375-landing.png");

    ev("");
    ev("[detail] select demo + switch to Bid Leveling via mobile stage select");
    await selectProjectByTitle(page, "The Domain Tower B");
    await delay(2200);
    const setR = await setStageSelect(page, "leveling");
    await delay(2200);
    ev(`[detail] setStage=${J(setR)} activeStage=${await activeStage(page)}`);
    ev(`[detail] main="${await mainSample(page)}"`);
    const ov1 = await overflowReport(page);
    ev(`[detail] viewport=${ov1.vw} docScrollWidth=${ov1.docSw} bodyScrollWidth=${ov1.bodySw} horizontalOverflowPx=${ov1.horizontalOverflowPx}`);
    for (const o of ov1.offenders) ev(`[detail] overflow-offender ${J(o)}`);
    await shot(page, "remediation-qa8-mobile-375-leveling.png");

    ev("");
    ev("[detail2] switch to Scope Clash via mobile stage select");
    await setStageSelect(page, "coordination");
    await delay(1800);
    ev(`[detail2] activeStage=${await activeStage(page)}`);
    const ov2 = await overflowReport(page);
    ev(`[detail2] horizontalOverflowPx=${ov2.horizontalOverflowPx}`);
    for (const o of ov2.offenders.slice(0, 8)) ev(`[detail2] overflow-offender ${J(o)}`);
    await shot(page, "remediation-qa8-mobile-375-clash.png");

    ev("");
    const errs = diag.consoleLogs.filter((l) => l.type === "error" || l.type === "warning");
    ev(`[diag] console errors/warnings=${errs.length}`);
    for (const e of errs) ev(`  [${e.type}] ${e.text}`);
    ev(`[diag] pageerrors=${diag.pageErrors.length} failedReq=${diag.failedRequests.length} http>=400=${httpErrors.length}`);
    for (const p of diag.pageErrors) ev(`  pageerror ${p}`);
    for (const f of diag.failedRequests) ev(`  failedReq ${f}`);
    for (const h of httpErrors) ev(`  http>=400 ${h.method} ${h.status} ${h.url}`);

    const dest = writeLog("remediation-qa8-mobile.txt", LOG);
    console.log(`Wrote ${dest}`);
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});