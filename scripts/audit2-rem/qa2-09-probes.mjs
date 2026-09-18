import { launchBrowser, waitForAppReady, writeJson, shot, delay, BASE_URL } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = {};
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(900);

    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "New Project");
      b.click();
    });
    await delay(500);
    await page.evaluate(() => {
      const form = document.querySelector('[role="dialog"] form');
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await delay(600);
    out.validation = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const errorEl = [...dlg.querySelectorAll("p,div,span")].find((e) => /required|must be/i.test(e.innerText || "") && e.children.length === 0);
      const errs = [...document.querySelectorAll('[role="alert"]')].map((e) => (e.innerText || "").slice(0, 60));
      const live = [...document.querySelectorAll("[aria-live]")].map((e) => ({ tag: e.tagName, live: e.getAttribute("aria-live"), text: (e.innerText || "").slice(0, 40) }));
      const describedBy = [...dlg.querySelectorAll("input,textarea,select")].map((i) => ({ tag: i.tagName, ariaLabel: i.getAttribute("aria-label"), ariaDescribedby: i.getAttribute("aria-describedby") }));
      return {
        errorText: errorEl ? errorEl.innerText.trim() : null,
        errorAttrs: errorEl ? { tag: errorEl.tagName, role: errorEl.getAttribute("role"), ariaLive: errorEl.getAttribute("aria-live"), id: errorEl.id } : null,
        roleAlertCount: errs.length,
        liveRegions: live,
        fields: describedBy,
      };
    });
    await shot(page, "fix4-qa2-validation-error.png");
    await page.keyboard.press("Escape");
    await delay(300);

    await page.evaluate(() => {
      const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes("04: Bid Leveling"));
      if (b) b.click();
    });
    await delay(700);
    out.awardButtons = await page.evaluate(() =>
      [...document.querySelectorAll("button")].filter((b) => (b.innerText || "").includes("Award") && b.getBoundingClientRect().width > 0).map((b) => {
        const cs = getComputedStyle(b);
        return { text: (b.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60), bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 90), color: cs.color, cls: (b.className || "").slice(0, 110) };
      })
    );

    await page.evaluate(() => {
      const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes("01: CSI Scoping"));
      if (b) b.click();
    });
    await delay(700);
    const before = await page.evaluate(() => [...document.querySelectorAll("h3")].filter((h) => h.getBoundingClientRect().height > 0).length);
    out.packageSelection = await page.evaluate(() => ({ beforeActive: [...document.querySelectorAll("button")].filter((b) => (b.innerText || "").trim() === "Active Package").length }));
    const idx = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")].filter((b) => (b.innerText || "").trim() === "Inspect Package");
      if (btns.length < 2) return null;
      btns[1].focus();
      const r = btns[1].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, h3count: document.querySelectorAll("h3").length };
    });
    if (idx) {
      await page.keyboard.press("Enter");
      await delay(500);
      out.packageSelection.afterActive = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => (b.innerText || "").trim() === "Active Package").length);
      out.packageSelection.selectedCardTitle = await page.evaluate(() => {
        const card = [...document.querySelectorAll("div")].find((d) => d.className && d.className.includes("rounded-xl") && d.className.includes("border") && d.innerText && d.innerText.includes("Active Package") && d.innerText.length < 1500);
        return card ? card.innerText.split("\n").filter((l) => l.trim()).slice(0, 3) : null;
      });
      out.packageSelection.keyboardSelectable = true;
    }
    out.ariaCurrentOnCards = await page.evaluate(() => [...document.querySelectorAll("[aria-current],[aria-selected],[aria-pressed]")].map((e) => ({ tag: e.tagName, attr: e.getAttribute("aria-current") || e.getAttribute("aria-selected") || e.getAttribute("aria-pressed"), text: (e.innerText || "").slice(0, 40) })));
    out.roleAlertTotal = await page.evaluate(() => document.querySelectorAll('[role="alert"]').length);
    out.ariaLiveTotal = await page.evaluate(() => document.querySelectorAll("[aria-live]").length);

    writeJson("fix4-qa2-09-probes.json", out);
    console.log(JSON.stringify(out, null, 2).slice(0, 7000));
  } finally {
    await browser.close();
  }
};
run();