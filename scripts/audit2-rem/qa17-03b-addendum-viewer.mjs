/**
 * QA17-03b: addendum issuance date in the Project Files preview viewer.
 */
import { launchBrowser, waitForAppReady, shot, delay } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog, longDateUtc, utcDate } from "./qa17-lib.mjs";

const F = readEvidence("fixtures");
const EXPECTED = `${longDateUtc(utcDate(new Date()))} (UTC)`;
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  try {
    await page.goto(`https://brainy-skunk-440.convex.site/?project=${F.name.id}&tab=packages&qa17=addendum`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(900);
    const click = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const h = [...document.querySelectorAll("h4")].find((x) => (x.innerText || "").includes("ADDENDUM") && vis(x));
      if (!h) return { ok: false, reason: "addendum file row not found" };
      let n = h;
      for (let i = 0; i < 6 && n; i++) {
        if (n.querySelector && n.querySelector("button")) break;
        n = n.parentElement;
      }
      const btn = [...(n ? n.querySelectorAll("button") : [])].find((b) => (b.getAttribute("title") || "").includes("Preview"));
      if (!btn) return { ok: false, reason: "preview button not found" };
      btn.click();
      return { ok: true };
    });
    await delay(900);
    const viewer = await page.evaluate((expected) => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.getAttribute("aria-label") || "").includes("Preview of"));
      const text = dlg ? dlg.innerText : "";
      return { found: Boolean(dlg), hasExpected: text.includes(expected), issuance: (text.match(/Issuance Date:\*\*\s*([^\n]+)/) || [])[1] || null, len: text.length };
    }, EXPECTED);
    await shot(page, "fix4-qa17-addendum-viewer.png");
    say(`viewer: ${JSON.stringify(viewer)}`);
    writeEvidence("addendum-viewer", { capturedAt: new Date().toISOString(), expected: EXPECTED, click, viewer, pass: click.ok && viewer.found && viewer.hasExpected });
    writeLog("addendum-viewer", log);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("addendum-viewer-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});