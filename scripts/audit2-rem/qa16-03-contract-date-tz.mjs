import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, clickButtonByText } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa16-lib.mjs";

const fx = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };

function dismissTour(page) {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    if (b) { b.click(); return true; }
    return false;
  });
}

async function probe(timezone, projectId) {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.emulateTimezone(timezone);
  try {
    await page.goto(`https://brainy-skunk-440.convex.site/?project=${projectId}&tab=contracts&qa16=tz`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForAppReady(page);
    await dismissTour(page);
    await delay(800);

    const browserNow = await page.evaluate(() => ({
      localDate: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      localIsoDate: new Date().toLocaleDateString("en-CA"),
      utcIsoDate: new Date().toISOString().slice(0, 10),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      offsetMinutes: new Date().getTimezoneOffset(),
    }));
    say(`[${timezone}] browser local=${browserNow.localDate} (${browserNow.localIsoDate}), utc=${browserNow.utcIsoDate}`);

    let open = await clickButtonByText(page, "Inspect Draft");
    if (!open.ok) {
      const chip = await clickButtonByText(page, "Superseded");
      say(`[${timezone}] no active draft; clicked Superseded chip=${JSON.stringify(chip)}`);
      await delay(600);
      open = await clickButtonByText(page, "Inspect Draft");
    }
    if (!open.ok) throw new Error(`Inspect Draft not found: ${JSON.stringify(open)}`);
    await delay(900);

    const viewer = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      const dlg = dialogs.find((d) => (d.textContent || "").includes("AGREEMENT")) || dialogs[dialogs.length - 1] || null;
      const text = dlg ? dlg.innerText : "";
      const m = text.match(/AGREEMENT made as of the ([^.\n]+)\./i);
      const docDate = m ? m[1].trim() : null;
      return {
        found: Boolean(dlg),
        docDate,
        hasExecutedChip: text.includes("Execution Status Recorded"),
        textLength: text.length,
        head: text.slice(0, 240),
      };
    });
    say(`[${timezone}] contract docDate="${viewer.docDate}" browserDate="${browserNow.localDate}"`);
    await shot(page, `fix4-qa16-contract-date-${timezone.replace(/\W+/g, "_")}.png`);

    return {
      timezone,
      browser: browserNow,
      contractDate: viewer.docDate,
      dateMatchesLocal: viewer.docDate === browserNow.localDate,
      viewerFound: viewer.found,
      viewerLength: viewer.textLength,
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 5),
      pageErrors: diag.pageErrors.slice(0, 5),
    };
  } finally {
    await browser.close();
  }
}

const out = {
  capturedAt: new Date().toISOString(),
  agreementCreatedAtUtc: new Date().toISOString(),
  newYork: await probe("America/New_York", fx.projectA.id),
  tokyo: await probe("Asia/Tokyo", fx.projectA.id),
};
writeEvidence("contract-date-tz", out);
writeLog("contract-date-tz", log);
console.log(JSON.stringify(out, null, 2));