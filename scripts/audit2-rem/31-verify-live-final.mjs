import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay, getSelectorState, bodyText,
} from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const out = { startedAt: new Date().toISOString() };

  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1500);
    out.selectorBefore = await getSelectorState(page);
    out.kpi = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        buyout: (t.match(/Buyout: (\d+)\/(\d+) Awarded/) || []).slice(1),
        gaps: (t.match(/Gaps Exposed: \+?\$([\d,]+)/) || [])[1] || null,
        deceptive: (t.match(/(\d+) Deceptive Bid/) || [])[1] || null,
        leveledLabel: /best bid per package/.test(t),
      };
    });
    out.stepper = await page.evaluate(() => (document.body.innerText.match(/(\d+)\/(\d+) Awarded/) || []).slice(1));

    // Tour is live
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Demo Tour")); if (b && !b.className.includes("ring")) b.click(); });
    await delay(900);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:"))?.click(); });
    await delay(1000);
    out.tourCue = await page.evaluate(() => (document.body.innerText.match(/Cue:"?[^\n]{0,320}/) || [])[0] || null);
    await shot(page, "live-tour-scene4.png");
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour"))?.click(); });
    await delay(400);

    // Layout at widths
    out.overflow = {};
    for (const w of [375, 768, 1024, 1440]) {
      await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
      await delay(400);
      out.overflow[w] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    }
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await delay(300);

    // New Project modal centered
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click(); });
    await delay(800);
    out.newProjectModal = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return null;
      const r = dlg.getBoundingClientRect();
      return { top: Math.round(r.top), inHeader: !!dlg.closest("header"), allFieldsVisible: [...dlg.querySelectorAll("input,textarea")].every((f) => { const fr = f.getBoundingClientRect(); return fr.top >= 0 && fr.bottom <= window.innerHeight; }) };
    });
    await shot(page, "live-newproject-modal.png");
    await page.keyboard.press("Escape");
    await delay(400);

    // Focus trap
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("60s Judge Dock"))?.click(); });
    await delay(900);
    const trail = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      trail.push(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')));
    }
    await page.keyboard.press("Escape");
    await delay(600);
    out.focusTrap = { escaped: trail.some((v) => !v), restored: await page.evaluate(() => (document.activeElement?.textContent || "").includes("60s Judge Dock")) };

    // Seller: KPI/step consistency + registrations
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Subcontracts")); b?.click(); });
    await delay(1000);
    out.contracts = await page.evaluate(() => {
      const t = document.body.innerText;
      return { sum: (t.match(/ACTIVE CONTRACTED SUM\s*\$?([\d,]+)/) || [])[1] || null, lds: (t.match(/LDs: \$([\d,]+)\/day/) || [])[1] || null };
    });

    // Evals labels
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Evals & Architecture"))?.click(); });
    await delay(1200);
    out.evals = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        honestTitle: t.includes("Bid Extraction & ADR-0003 Normalization Check"),
        noZeroCheating: !t.includes("Zero Cheating"),
        noParity: !t.includes("PARITY ACHIEVED"),
        runId: (t.match(/Run ID: eval_\d+/) || [])[0] || null,
        runDate: (t.match(/started (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[^\n]*/) || [])[0] || null,
      };
    });
    await shot(page, "live-evals.png", { full: true });

    // Isolation: stale project id
    await page.goto("https://brainy-skunk-440.convex.site/?project=proj_domain_tower_b&tab=packages", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1500);
    out.isolation = await page.evaluate(() => ({ text: document.body.innerText.slice(0, 160), url: window.location.href, options: document.querySelectorAll('select[aria-label="Select Commercial Construction Project"] option').length }));

    // Demo integrity (backend-side counts via UI)
    out.selectorAfter = await getSelectorState(page);
    out.demoCounts = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        pkgs: (t.match(/(\d+) Pkgs/) || [])[1],
        subs: (t.match(/(\d+) Subs/) || [])[1],
        rfis: (t.match(/(\d+) RFIs/) || [])[1],
        bids: (t.match(/(\d+) Bids/) || [])[1],
        clashes: (t.match(/(\d+) Clashes/) || [])[1],
        award: (t.match(/(\d+)\/(\d+) Awarded/) || []).slice(1),
      };
    });

    out.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 6), pageErrors: diag.pageErrors, failedRequests: diag.failedRequests.slice(0, 6) };
    writeJson("fix-verify-live-final.json", out);
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
    writeJson("fix-verify-live-final.json", out);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(out, null, 2).slice(0, 12000));
};
run();