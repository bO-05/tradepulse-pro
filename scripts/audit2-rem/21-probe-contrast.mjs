import { launchBrowser, waitForAppReady, delay } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  try {
    await page.goto(process.env.REM_BASE_URL || "http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "").includes("Bid Leveling"))?.click(); });
    await delay(1200);
    const probe = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("span,p,div,li,td,th,label,code,button")) {
        const t = (el.innerText || "").trim();
        if (!t || t.length > 60) continue;
        if (!/^(26 00 00|Electrical & Lighting Systems|Advance to Scope Clash Engine|Inspect AIA Document A401 Agreement)$/.test(t)) continue;
        const cs = getComputedStyle(el);
        const chain = [];
        let cur = el;
        for (let i = 0; i < 5 && cur; i++) { chain.push(`${cur.tagName}.${(cur.className || "").toString().slice(0, 80)}`); cur = cur.parentElement; }
        out.push({ text: t, color: cs.color, fontSize: cs.fontSize, opacity: cs.opacity, bg: cs.backgroundColor, chain });
      }
      return out;
    });
    console.log(JSON.stringify(probe, null, 2));
  } finally {
    await browser.close();
  }
};
run();