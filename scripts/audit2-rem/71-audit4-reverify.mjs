import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay } from "./lib.mjs";

const R = { startedAt: new Date().toISOString() };

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1500);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);

    // 1) holdout card — case-insensitive innerText + DOM visibility
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Evals & Architecture"))?.click(); });
    await delay(1500);
    R.holdout = await page.evaluate(() => {
      const t = document.body.innerText.toLowerCase();
      const spans = [...document.querySelectorAll("span")];
      const label = spans.find((s) => (s.textContent || "").toLowerCase().includes("holdout"));
      const card = label ? label.closest("div") : null;
      const r = card ? card.getBoundingClientRect() : null;
      return {
        innerTextHasHoldout: t.includes("holdout"),
        labelText: label ? label.textContent.trim() : null,
        visible: card ? card.offsetParent !== null : null,
        rect: r ? { top: Math.round(r.top), height: Math.round(r.height) } : null,
        text: card ? card.innerText.replace(/\n/g, " | ").slice(0, 140) : null,
      };
    });

    // 2) focus restore with a REAL mouse click on New Project
    const box = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "New Project");
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    await delay(700);
    R.focusRealClick = await page.evaluate(() => ({ focusedOnOpen: document.activeElement?.tagName + ":" + (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").trim().slice(0, 30), dialogOpen: !!document.querySelector('[role="dialog"]') }));
    await page.keyboard.press("Escape");
    await delay(500);
    R.focusRealClick.afterEscape = await page.evaluate(() => ({ active: (document.activeElement?.textContent || "").trim().slice(0, 40), dialogOpen: !!document.querySelector('[role="dialog"]') }));

    // 3) audit timestamps — click by text
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Live Activity Audit"))?.click(); });
    await delay(1200);
    R.auditTimes = await page.evaluate(() => {
      const t = document.body.innerText;
      return { fullDates: (t.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2}, \d{4}, [^\n]{0,45}/g) || []).slice(0, 3), anyTime: (t.match(/\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)/g) || []).slice(0, 3) };
    });
    await shot(page, "audit4-audit-timestamps.png");

    // 4) zero-dispatch toast — poll every 400ms
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("01:")); b?.click(); });
    await delay(900);
    // select the AUDIT fixture, if present; else demo is read-only for this check -> skip mutation
    const sel = await page.evaluate(() => { const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]'); return { value: s.value, options: [...s.options].map((o) => ({ v: o.value, t: o.textContent.trim() })) }; });
    const fixture = sel.options.find((o) => o.t.startsWith("AUDIT-4"));
    R.fixturePresent = Boolean(fixture);
    if (fixture) {
      await page.evaluate((v) => { const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]'); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); }, fixture.v);
      await delay(1500);
      await page.evaluate(() => {
        const cards = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("AUDIT-4 Electrical") && (d.innerText || "").includes("Dispatch RFQs"));
        const card = cards[cards.length - 1];
        const btn = card ? [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Dispatch RFQs")) : null;
        if (btn) btn.click();
      });
      const samples = [];
      for (let i = 0; i < 14; i++) {
        await delay(400);
        const toast = await page.evaluate(() => document.querySelector('[role="status"]')?.textContent || null);
        samples.push({ ms: (i + 1) * 400, toast: toast ? toast.slice(0, 110) : null });
        if (toast) break;
      }
      R.zeroToast = samples;
      await shot(page, "audit4-zero-toast.png");
    }

    R.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 90)).slice(0, 6) };
    writeJson("audit4-reverify.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("audit4-reverify.json", R);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 7000));
};
run();