import fs from "node:fs";
import path from "node:path";
import { launchBrowser, shot } from "./lib.mjs";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Root-purpose check: proves every curated audit report opens offline (file://)
 * with zero broken images, zero page errors, and a sensible title. Judges open
 * these by double-click; this is the test that promise holds.
 *
 * Usage: node scripts/qa/render-audit-reports.mjs
 */

const dir = path.resolve("docs/audits");
const reports = fs.readdirSync(dir).filter((f) => f.endsWith(".html")).sort();
if (reports.length === 0) throw new Error("no audit reports found in docs/audits");

const { browser } = await launchBrowser(1440, 900);
const results = [];
try {
  for (const report of reports) {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
    const fileUrl = "file:///" + path.join(dir, report).replace(/\\/g, "/");
    await page.goto(fileUrl, { waitUntil: "load", timeout: 60000 });
    // Force lazy images to load and wait for every image to settle; otherwise
    // below-the-fold `loading="lazy"` images report naturalWidth 0.
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      for (const img of document.images) img.loading = "eager";
      await Promise.all(
        [...document.images].map(
          (img) =>
            new Promise((resolve) => {
              if (img.complete) return resolve(undefined);
              img.addEventListener("load", () => resolve(undefined), { once: true });
              img.addEventListener("error", () => resolve(undefined), { once: true });
            })
        )
      );
      window.scrollTo(0, 0);
    });
    await delay(700);
    const stats = await page.evaluate(() => ({
      title: document.title || "",
      images: document.images.length,
      broken: [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length,
      textLength: document.body.innerText.length,
    }));
    await shot(page, `fix4-report-render-${report.replace(/\.html$/, "")}.png`);
    results.push({ report, ...stats, pageErrors });
    await page.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.broken > 0 || r.pageErrors.length > 0 || r.textLength < 500);
console.log(JSON.stringify(results, null, 2));
if (failed.length) {
  console.error(`FAIL: ${failed.length} report(s) did not render cleanly`);
  process.exit(1);
}
console.log(`OK: ${results.length} audit reports render offline with no broken images or page errors`);