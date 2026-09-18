import { launchBrowser, waitForAppReady, writeJson, shot, delay, BASE_URL } from "./lib.mjs";

const shotClip = async (page, name, box, pad = 10) => {
  await shot(page, name, { clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(1440, box.width + pad * 2), height: box.height + pad * 2 } });
};

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = {};
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(900);

    const focusTrials = [
      { id: "stepper-pill", sel: 'header button[title^="04:"]' },
      { id: "project-select", sel: 'select[aria-label="Select Commercial Construction Project"]' },
      { id: "ai-spec-btn", sel: 'button' , find: "AI Spec Breakdown" },
      { id: "create-pkg-btn", sel: 'button', find: "Create Trade Package" },
      { id: "delete-pkg-btn", sel: 'button[title="Delete Trade Package"]' },
      { id: "dispatch-rfq", sel: 'button', find: "Dispatch RFQs" },
    ];
    out.focusTrials = {};
    for (const t of focusTrials) {
      const box = await page.evaluate((sel, find) => {
        let el = find ? [...document.querySelectorAll(sel)].find((b) => (b.innerText || "").includes(find)) : document.querySelector(sel);
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), tag: el.tagName };
      }, t.sel, t.find);
      if (!box) continue;
      await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
      await delay(150);
      await shotClip(page, `fix4-qa2-focus-${t.id}-blur.png`, box);
      const focused = await page.evaluate((sel, find) => {
        let el = find ? [...document.querySelectorAll(sel)].find((b) => (b.innerText || "").includes(find)) : document.querySelector(sel);
        if (!el) return null;
        el.focus();
        const cs = getComputedStyle(el);
        return { outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} ${cs.outlineOffset}`, boxShadow: cs.boxShadow, borderColor: cs.borderTopColor, bg: cs.backgroundColor };
      }, t.sel, t.find);
      await delay(150);
      await shotClip(page, `fix4-qa2-focus-${t.id}-focus.png`, box);
      out.focusTrials[t.id] = { box, focused };
    }

    await page.evaluate(() => {
      const b = [...document.querySelectorAll("header button")].find((x) => (x.innerText || "").trim() === "Live Activity Audit");
      if (b) b.click();
    });
    await delay(800);
    out.audit = await page.evaluate(() => {
      const hs = [...document.querySelectorAll("h2,h3,h4")].filter((h) => h.getBoundingClientRect().height > 0).map((h) => h.tagName + ": " + (h.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80));
      const counts = {};
      hs.forEach((h) => (counts[h] = (counts[h] || 0) + 1));
      return { heading: (document.querySelector("main h2") || {}).innerText || "", duplicates: Object.entries(counts).filter(([, c]) => c > 1), all: hs.slice(0, 40) };
    });
    await shot(page, "fix4-qa2-craft-audit-tab.png", { full: true });

    await page.evaluate(() => {
      const b = [...document.querySelectorAll("header button")].find((x) => (x.innerText || "").trim() === "Evals & Architecture");
      if (b) b.click();
    });
    await delay(800);
    out.diagSelects = await page.evaluate(() =>
      [...document.querySelectorAll("select")].filter((s) => s.getBoundingClientRect().width > 0).map((s) => ({
        ariaLabel: s.getAttribute("aria-label"),
        id: s.id,
        selected: (s.options[s.selectedIndex] || {}).text,
        labels: s.labels ? [...s.labels].map((l) => l.innerText.trim().slice(0, 40)) : [],
        cls: (s.className || "").slice(0, 70),
      }))
    );
    writeJson("fix4-qa2-08-audit-focus.json", out);
    console.log(JSON.stringify(out, null, 2).slice(0, 6000));
  } finally {
    await browser.close();
  }
};
run();