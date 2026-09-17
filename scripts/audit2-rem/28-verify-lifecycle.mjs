import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay, getSelectorState } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const results = {};

  try {
    await page.goto(process.env.REM_BASE_URL || "http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
    const sel = await getSelectorState(page);
    const fixture = sel?.options.find((o) => o.text.includes("AUDIT-AFTER"));
    await page.evaluate((val) => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      s.value = val; s.dispatchEvent(new Event("change", { bubbles: true }));
    }, fixture.value);
    await delay(1500);

    results.before = await page.evaluate(() => ({
      kpi: (document.body.innerText.match(/Buyout: (\d+)\/(\d+) Awarded/) || []).slice(1),
      stepper: (document.body.innerText.match(/(\d+)\/(\d+) Awarded/) || []).slice(1),
    }));

    // Run the full autonomous lifecycle via the Judge Dock
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("60s Judge Dock"))?.click(); });
    await delay(900);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("1-Click Run Full Autonomous Procurement Lifecycle"))?.click(); });
    await delay(30000);
    results.dockMessage = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText.match(/[^\n]*(?:Complete|Awarded)[^\n]*/)?.[0] || null);
    await page.keyboard.press("Escape");
    await delay(800);

    // Consistency across surfaces
    results.after = await page.evaluate(() => {
      const t = document.body.innerText;
      return { kpi: (t.match(/Buyout: (\d+)\/(\d+) Awarded/) || []).slice(1), stepper: (t.match(/(\d+)\/(\d+) Awarded/) || []).slice(1) };
    });
    await shot(page, "after4-lifecycle-kpi.png", { full: true });

    // Contracts tab
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Subcontracts")); b?.click(); });
    await delay(1200);
    results.contracts = await page.evaluate(() => {
      const t = document.body.innerText;
      return { contractedSum: (t.match(/ACTIVE CONTRACTED SUM\s*\$?([\d,]+)/) || [])[1] || null, rows: (t.match(/A401-\d+[^\n]*/g) || []).slice(0, 3), lds: (t.match(/LDs: \$[\d,]+\/day/g) || []).slice(0, 3) };
    });

    // Leveling tab (awarded leveling lock + best bid)
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Bid Leveling")); b?.click(); });
    await delay(1200);
    results.leveling = await page.evaluate(() => {
      const t = document.body.innerText;
      return { trueLeveled: (t.match(/TRUE LEVELED COST\s*\$[\d,]+/g) || []).slice(0, 4), awarded: t.includes("Subcontract Awarded"), locked: /Leveling locked|Executed agreement/.test(t) };
    });
    await shot(page, "after4-lifecycle-leveling.png", { full: true });

    // Tour scene 04 matches live
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Demo Tour")); if (b && !b.className.includes("ring")) b.click(); });
    await delay(900);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:"))?.click(); });
    await delay(1000);
    results.tour = await page.evaluate(() => (document.body.innerText.match(/Cue:"?[^\n]{0,340}/) || [])[0] || null);
    await shot(page, "after4-lifecycle-tour.png");
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour"))?.click(); });
    await delay(400);

    results.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 6), pageErrors: diag.pageErrors, failedRequests: diag.failedRequests.slice(0, 6) };
    writeJson("fix-verify-lifecycle.json", results);
  } catch (e) {
    results.error = String(e && e.stack ? e.stack : e);
    writeJson("fix-verify-lifecycle.json", results);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 2).slice(0, 10000));
};
run();