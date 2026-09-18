import { setTimeout as delay } from "node:timers/promises";
import { launchBrowser, waitForAppReady, writeJson, shot } from "./lib.mjs";

const R = { startedAt: new Date().toISOString() };

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const closeTour = async () => {
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
  };
  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1000);
    await closeTour();

    // select demo project
    await page.evaluate(() => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      const o = [...s.options].find((x) => x.textContent.includes("The Domain Tower B"));
      s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await delay(1800);

    const clickTab = async (prefix) => {
      await page.evaluate((p) => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(p)); b?.click(); }, prefix);
      await delay(900);
    };

    const inventory = {};
    for (const prefix of ["01:", "02:", "03:", "04:", "05:", "06:", "07:"]) {
      await clickTab(prefix);
      inventory[prefix] = await page.evaluate(() => {
        const rows = [];
        [...document.querySelectorAll("main button, main select")].forEach((el) => {
          const t = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120);
          const aria = el.getAttribute?.("aria-label") || "";
          rows.push({ tag: el.tagName, text: t, aria, cls: (el.className || "").toString().slice(0, 60) });
        });
        return rows.filter((r) => r.text || r.aria);
      });
    }
    R.inventory = inventory;

    // leveling: expand Why GCs Care, get LD copy
    await clickTab("04:");
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Why GCs Care")); b?.click(); });
    await delay(400);
    R.ld = await page.evaluate(() => {
      const t = document.body.innerText;
      const i = t.indexOf("schedule-impact rate");
      return i >= 0 ? t.slice(Math.max(0, i - 160), i + 200) : null;
    });
    await shot(page, "fix4-before-F11-leveling.png", { full: true });

    // QnA selectors screenshot
    await clickTab("03:");
    await shot(page, "fix4-before-F11-qna.png");
    R.qnaSelectorButtons = await page.evaluate(() => {
      const out = [];
      [...document.querySelectorAll("main button")].forEach((b) => {
        const t = (b.textContent || "").trim();
        if (/\d{2} 00 00/.test(t)) out.push(t);
      });
      return out;
    });
    writeJson("fix4-before-f11.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-before-f11.json", R);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ error: R.error, qnaSelectorButtons: R.qnaSelectorButtons, ld: R.ld, tab01: R.inventory?.["01:"]?.slice(0, 25), tab02: R.inventory?.["02:"]?.slice(0, 25) }, null, 2));
};
run();