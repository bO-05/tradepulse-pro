import { launchBrowser, waitForAppReady, writeJson, shot, delay, BASE_URL } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = {};
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(900);

    out.cue = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").includes("Cue:"));
      if (!btn) return null;
      const span = btn.querySelector("span.truncate") || btn.querySelector("span");
      const parent = btn.parentElement;
      const g = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), clientW: el.clientWidth, scrollW: el.scrollWidth, display: cs.display, flex: cs.flex, minWidth: cs.minWidth, overflow: cs.overflow, textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace, title: el.getAttribute("title") }; };
      return { button: g(btn), span: g(span), parent: g(parent), textLen: (span.innerText || "").length, visibleRatio: Math.round((span.clientWidth / Math.max(1, span.scrollWidth)) * 100) / 100, parentText: (parent.innerText || "").slice(0, 120) };
    });
    const cueBox = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").includes("Cue:"));
      const r = btn.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    });
    await shot(page, "fix4-qa2-craft-tour-cue.png", { clip: { x: Math.max(0, cueBox.x - 20), y: Math.max(0, cueBox.y - 20), width: Math.min(1400, cueBox.width + 700), height: cueBox.height + 40 } });

    out.stepper = await page.evaluate(() => {
      const container = document.querySelector("header div.hidden.sm\\:flex.items-center.gap-1");
      const btns = [...document.querySelectorAll("header button")].filter((b) => /^\d\d|^✓/.test((b.innerText || "").trim()) || (b.getAttribute("title") || "").match(/^0\d: /));
      if (!container) return { error: "container not found", btns: btns.length };
      const cr = container.getBoundingClientRect();
      const cs = getComputedStyle(container);
      const items = btns.map((b) => {
        const r = b.getBoundingClientRect();
        const badge = b.querySelector("span:last-child");
        const br = badge ? badge.getBoundingClientRect() : null;
        const overflowRight = Math.round(r.right - cr.right);
        return { text: (b.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40), left: Math.round(r.left), right: Math.round(r.right), overflowRight, badgeRight: br ? Math.round(br.right) : null, badgeOverflowRight: br ? Math.round(br.right - cr.right) : null };
      });
      return { container: { left: Math.round(cr.left), right: Math.round(cr.right), clientW: container.clientWidth, scrollW: container.scrollWidth, overflowX: cs.overflowX }, items };
    });
    const stepperBox = await page.evaluate(() => {
      const container = document.querySelector("header div.hidden.sm\\:flex.items-center.gap-1");
      const r = container.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    });
    await shot(page, "fix4-qa2-craft-stepper-clip.png", { clip: { x: Math.max(0, stepperBox.x - 10), y: Math.max(0, stepperBox.y - 10), width: Math.min(1420, stepperBox.width + 300), height: stepperBox.height + 30 } });

    await page.evaluate(() => {
      const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes("01: CSI Scoping"));
      if (b) b.click();
    });
    await delay(600);
    out.unnamedCombos = await page.evaluate(() => {
      return [...document.querySelectorAll("select")].filter((s) => s.getBoundingClientRect().width > 0).map((s) => {
        const lb = s.getAttribute("aria-labelledby");
        const lab = s.getAttribute("aria-label") || (lb ? lb.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ") : "") || (s.id ? (document.querySelector(`label[for="${CSS.escape(s.id)}"]`)?.innerText || "") : "") || (s.closest("label")?.innerText || "");
        return { ariaLabel: s.getAttribute("aria-label"), id: s.id, computedLabel: (lab || "").trim().slice(0, 60), selected: (s.options[s.selectedIndex] || {}).text, cls: (s.className || "").slice(0, 90), html: s.outerHTML.slice(0, 220) };
      });
    });

    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
    await delay(600);
    out.mobile375 = await page.evaluate(() => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      const ctx = document.createElement("canvas").getContext("2d");
      const cs = getComputedStyle(s);
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const text = s.options[s.selectedIndex]?.text || "";
      const w = ctx.measureText(text).width;
      const r = s.getBoundingClientRect();
      return { text, measuredTextWidth: Math.round(w), controlW: Math.round(r.width), truncated: w > r.width, title: s.getAttribute("title"), ariaLabel: s.getAttribute("aria-label") };
    });
    const headerBox = await page.evaluate(() => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      const r = s.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    });
    await shot(page, "fix4-qa2-craft-mobile-project-select.png", { clip: { x: 0, y: Math.max(0, headerBox.y - 40), width: 375, height: headerBox.height + 80 } });

    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await delay(500);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes("Live Activity Audit"));
      if (b) b.click();
    });
    await delay(700);
    out.auditHeadings = await page.evaluate(() => {
      return [...document.querySelectorAll("h2,h3,h4")].filter((h) => h.getBoundingClientRect().height > 0).map((h) => ({ tag: h.tagName, text: (h.innerText || "").trim().replace(/\s+/g, " ").slice(0, 90) }));
    });
    await shot(page, "fix4-qa2-craft-audit-duplicates.png", { full: true });

    writeJson("fix4-qa2-07-targeted.json", out);
    console.log(JSON.stringify(out, null, 2).slice(0, 9000));
  } finally {
    await browser.close();
  }
};
run();