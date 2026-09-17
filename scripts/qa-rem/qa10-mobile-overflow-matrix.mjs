// QA-10 micro-probe: mobile 375 header overflow repro matrix + ?project=fake fresh-context behavior.
// Usage: node scripts/qa-rem/qa10-mobile-overflow-matrix.mjs
import { launchBrowser, waitForAppReady, delay, BASE_URL, writeLog, getSelectorState, selectProjectByTitle } from "./qa1-lib.mjs";
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

const { browser } = await launchBrowser();
try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(25000);
  await page.setViewport({ width: 375, height: 812 });
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await delay(2000);

  async function measure(label) {
    const m = await page.evaluate(() => ({
      vw: window.innerWidth,
      doc: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      overflowPx: document.documentElement.scrollWidth - window.innerWidth,
      selector: (() => {
        const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
        return sel ? sel.options[sel.selectedIndex]?.textContent.trim() : null;
      })(),
      deleteBtn: Boolean([...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().includes("Delete"))),
    }));
    ev(`${label}: ${JSON.stringify(m)}`);
    return m;
  }

  const demo = await measure("375 packages demo");
  await selectProjectByTitle(page, fixture.emptyTag);
  await delay(2500);
  const empty = await measure("375 packages custom-empty");
  await selectProjectByTitle(page, fixture.tag);
  await delay(2500);
  const ui = await measure("375 packages custom-ui");

  ev("");
  ev("=== ?project=fake in a FRESH context (no stored selection) ===");
  const ctx2 = await browser.createBrowserContext();
  const page2 = await ctx2.newPage();
  page2.setDefaultTimeout(25000);
  const errs = [];
  page2.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page2.on("pageerror", (e) => errs.push(String(e)));
  await page2.goto(`${BASE_URL}/?project=fake`, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page2);
  await delay(2500);
  const fakeSel = await getSelectorState(page2);
  const fakeUrl = page2.url();
  const fakeBody = await page2.evaluate(() => document.querySelector("main")?.innerText.replace(/\s+/g, " ").slice(0, 200) ?? "");
  ev(`fresh ?project=fake -> url=${fakeUrl} selected="${fakeSel?.selectedText}" consoleErrors=${errs.length}`);
  ev(`body sample="${fakeBody}"`);

  const summary = { demo, empty, ui, fake: { url: fakeUrl, selected: fakeSel?.selectedText, consoleErrors: errs } };
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa10-mobile-overflow-matrix.json"), JSON.stringify(summary, null, 2), "utf8");
  writeLog("remediation-qa10-mobile-overflow-matrix.txt", LOG);
  console.log("Wrote evidence.");
} finally {
  await browser.close();
}