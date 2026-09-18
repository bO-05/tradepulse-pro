import { launchBrowser, waitForAppReady, writeJson, shot, delay, BASE_URL } from "./lib.mjs";

const state = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).display !== "none";
  };
  const overlays = [...document.querySelectorAll("div.fixed.inset-0")].filter(vis);
  const nameOf = (el) => (el ? (el.getAttribute("aria-label") || (el.innerText || "").trim() || el.getAttribute("title") || "").slice(0, 80) : null);
  return {
    overlays: overlays.map((o) => ({ z: getComputedStyle(o).zIndex, role: o.getAttribute("role") })),
    active: nameOf(document.activeElement),
    dialogs: [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(vis).map((d) => ({ role: d.getAttribute("role"), name: nameOf(d).slice(0, 60) })),
    scrollY: window.scrollY,
  };
};

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = {};
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(900);

    const judge = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").includes("60s Judge Dock"));
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(judge.x, judge.y);
    await delay(500);
    out.judgeOpen = await page.evaluate(state);

    const reset = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => (x.innerText || "").includes("Reset Demo Data"));
      if (!b) return null;
      b.scrollIntoView({ block: "center" });
      b.focus();
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (reset) {
      await page.keyboard.press("Enter");
      await delay(450);
      out.confirmOpen = await page.evaluate(state);
      await shot(page, "fix4-qa2-stack-confirm-over-dock.png");
      await page.keyboard.press("Escape");
      await delay(400);
      out.afterConfirmEscape = await page.evaluate(state);
      out.confirmFocusRestored = await page.evaluate(() => {
        const a = document.activeElement;
        const label = a ? (a.getAttribute("aria-label") || (a.innerText || "").trim() || a.getAttribute("title") || "").slice(0, 80) : null;
        return { active: label, restored: !!label && label.includes("Reset Demo Data") };
      });
      await shot(page, "fix4-qa2-stack-after-confirm-escape.png");
    }

    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.move(720, 450);
    await page.mouse.wheel({ deltaY: 900 });
    await delay(500);
    const scrollAfter = await page.evaluate(() => window.scrollY);
    out.dockScrollTrap = { before: scrollBefore, after: scrollAfter, backgroundScrolled: scrollAfter !== scrollBefore, bodyOverflow: await page.evaluate(() => getComputedStyle(document.body).overflow) };
    await page.keyboard.press("Escape");
    await delay(300);

    await page.evaluate(() => {
      const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes("02: Discovery"));
      if (b) b.click();
    });
    await delay(650);
    const addBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Add Contractor Manually"));
      b.scrollIntoView({ block: "center" });
      b.focus();
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.keyboard.press("Enter");
    await delay(450);
    out.addOpen = await page.evaluate(state);
    const scrollBefore2 = await page.evaluate(() => window.scrollY);
    await page.mouse.move(720, 300);
    await page.mouse.wheel({ deltaY: 900 });
    await delay(500);
    out.addScrollTrap = { before: scrollBefore2, after: await page.evaluate(() => window.scrollY), backgroundScrolled: await page.evaluate((b) => window.scrollY !== b, scrollBefore2) };
    await shot(page, "fix4-qa2-stack-add-directory-after-wheel.png");
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Cancel");
      if (b) b.click();
    });
    await delay(300);

    out.tour = await page.evaluate(() => {
      const pills = [...document.querySelectorAll("button")].filter((b) => /^0[1-6]$/.test((b.innerText || "").trim()));
      return pills.map((b) => ({ text: b.innerText.trim(), title: b.getAttribute("title"), ariaLabel: b.getAttribute("aria-label"), ariaCurrent: b.getAttribute("aria-current"), bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color }));
    });
    out.stepperSelected = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("header button")].filter((b) => /^\d\d\s/.test((b.innerText || "").trim()) || (b.getAttribute("title") || "").includes(": "));
      return btns.map((b) => ({ name: (b.innerText || "").trim().slice(0, 40), ariaCurrent: b.getAttribute("aria-current"), ariaSelected: b.getAttribute("aria-selected"), ring: getComputedStyle(b).boxShadow !== "none", bg: getComputedStyle(b).backgroundColor }));
    });
    writeJson("fix4-qa2-02b-stacking-motion.json", out);
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await browser.close();
  }
};
run();