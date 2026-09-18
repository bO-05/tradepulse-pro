import { launchBrowser, waitForAppReady, writeJson, delay, BASE_URL } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = {};
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(800);
    out.animateInClassDefined = await page.evaluate(() => {
      const found = [];
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        const walk = (list) => {
          for (const r of list) {
            if (r.cssRules) walk(r.cssRules);
            if (r.selectorText && r.selectorText.includes("animate-in")) found.push(r.selectorText.slice(0, 80));
          }
        };
        walk(rules);
      }
      return found;
    });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "New Project");
      b.click();
    });
    await delay(500);
    out.overlayAnim = await page.evaluate(() => {
      const o = [...document.querySelectorAll("div.fixed.inset-0")].filter((x) => x.getBoundingClientRect().width > 0).pop();
      const cs = getComputedStyle(o);
      return { cls: (o.className || "").slice(0, 120), animationName: cs.animationName, animationDuration: cs.animationDuration, transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration };
    });
    const snap = await page.accessibility.snapshot({ interestingOnly: true });
    const icons = ["Delete Trade Package", "Minimize teleprompter", "Close Demo Tour", "Previous Scene", "Next Scene", "Delete file from storage", "Edit contractor info", "Delete contractor", "Delete proposal"];
    out.iconButtonNames = {};
    const walk = (n) => {
      if (!n) return;
      if (n.role === "button" && icons.includes(n.name)) (out.iconButtonNames[n.name] = out.iconButtonNames[n.name] || []).push(n.name);
      (n.children || []).forEach(walk);
    };
    walk(snap);
    await page.keyboard.press("Escape");
    await delay(300);
    writeJson("fix4-qa2-10-final-probe.json", out);
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await browser.close();
  }
};
run();