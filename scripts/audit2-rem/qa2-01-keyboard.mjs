import { launchBrowser, waitForAppReady, writeJson, shot, delay, BASE_URL } from "./lib.mjs";

const STOP_DESC = 500;

const describeStop = () => {
  const el = document.activeElement;
  if (!el || el === document.body) {
    return { tag: "BODY", name: "(document body)", rect: null, zone: "body" };
  }
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const zone = el.closest('[role="dialog"],[role="alertdialog"]')
    ? "dialog"
    : el.closest("header")
    ? "header"
    : el.closest("footer")
    ? "footer"
    : el.closest("main")
    ? "main"
    : el.closest("aside")
    ? "aside"
    : "other";
  const name = (() => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const lb = el.getAttribute("aria-labelledby");
    if (lb) return lb.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ").trim();
    const t = (el.innerText || "").trim().replace(/\s+/g, " ");
    if (t) return t.slice(0, 120);
    const title = el.getAttribute("title");
    if (title) return title.trim();
    return (el.getAttribute("placeholder") || "").trim();
  })();
  const cls = (el.className || "").toString();
  return {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute("role") || (el.tagName === "BUTTON" ? "button" : el.tagName === "A" ? "link" : null),
    name,
    title: el.getAttribute("title"),
    ariaLabel: el.getAttribute("aria-label"),
    type: el.getAttribute("type"),
    disabled: el.disabled === true,
    zone,
    focusedClass: cls.slice(0, 200),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    inViewport: r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1,
    tabIndexAttr: el.getAttribute("tabindex"),
    styles: {
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} off:${cs.outlineOffset}`,
      boxShadow: cs.boxShadow,
      borderColor: cs.borderTopColor,
      borderWidth: cs.borderTopWidth,
      bg: cs.backgroundColor,
      color: cs.color,
    },
  };
};

const restingStyles = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  try {
    el.blur();
    const cs = getComputedStyle(el);
    const snap = {
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
      boxShadow: cs.boxShadow,
      borderColor: cs.borderTopColor,
      borderWidth: cs.borderTopWidth,
      bg: cs.backgroundColor,
      color: cs.color,
    };
    el.focus();
    return snap;
  } catch {
    return null;
  }
};

const ringVerdict = (s, base) => {
  if (!base) return "unknown";
  const changed =
    s.boxShadow !== base.boxShadow ||
    s.outline !== base.outline ||
    s.borderColor !== base.borderColor ||
    s.borderWidth !== base.borderWidth ||
    s.bg !== base.bg ||
    s.color !== base.color;
  const hasRing = s.boxShadow !== "none" || (s.outline.split(" ")[0] !== "none" && s.outline.split(" ")[1] !== "0px");
  return changed ? (hasRing ? "ring+change" : "change-no-ring") : "no-change";
};

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = { url: BASE_URL, viewport: "1440x900", journeys: {} };
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(800);

    await page.evaluate(() => {
      try { document.body.focus(); } catch {}
    });
    const stops = [];
    const seen = new Set();
    let repeatCount = 0;
    for (let i = 0; i < 260; i++) {
      await page.keyboard.press("Tab");
      await delay(35);
      const d = await page.evaluate(describeStop);
      const base = await page.evaluate(restingStyles);
      await delay(15);
      const after = await page.evaluate(() => {
        const el = document.activeElement;
        const cs = getComputedStyle(el);
        return { outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, boxShadow: cs.boxShadow, borderColor: cs.borderTopColor, borderWidth: cs.borderTopWidth, bg: cs.backgroundColor, color: cs.color };
      });
      d.ring = ringVerdict(after, base);
      const key = `${d.tag}|${d.name}|${d.rect ? d.rect.y : ""}`;
      if (seen.has(key)) repeatCount++;
      seen.add(key);
      stops.push(d);
      if (stops.length > 40 && repeatCount > 30) break;
    }
    out.journeys.global = stops;

    const tabs = ["packages", "discovery", "qna", "leveling", "coordination", "contracts", "audit", "diagnostics"];
    for (const tab of tabs) {
      const target = {
        packages: "01: CSI Scoping",
        discovery: "02: Discovery",
        qna: "03: Pre-Bid",
        leveling: "04: Bid Leveling",
        coordination: "05: Scope Clash",
        contracts: "06: Subcontracts",
        audit: "Live Activity Audit",
        diagnostics: "Evals & Architecture",
      }[tab];
      const clicked = await page.evaluate((t) => {
        const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes(t) || (x.innerText || "").includes(t));
        if (b) b.click();
        return b ? (b.getAttribute("title") || b.innerText || "").trim().slice(0, 60) : null;
      }, target);
      await delay(650);
      await page.evaluate(() => {
        const main = document.querySelector("main");
        const first = main && main.querySelector('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]');
        if (first) first.focus();
      });
      const local = [];
      for (let i = 0; i < 45; i++) {
        await page.keyboard.press("Tab");
        await delay(25);
        const d = await page.evaluate(describeStop);
        if (d.zone === "body") break;
        local.push(d);
      }
      out.journeys[tab] = { clicked, stops: local };
      console.log(`TAB ${tab}: clicked=${clicked} stops=${local.length} no-change=${local.filter((s) => s.ring === "no-change").length} unknown=${local.filter((s) => s.ring === "unknown").length}`);
    }

    const bad = out.journeys.global.filter((s) => s.ring === "no-change" && s.tag === "button");
    console.log("GLOBAL STOPS:", out.journeys.global.length);
    console.log("GLOBAL BUTTONS NO VISIBLE FOCUS CHANGE:", bad.length);
    bad.slice(0, 25).forEach((s) => console.log("  NOCHANGE:", s.zone, JSON.stringify(s.name).slice(0, 70)));
    await shot(page, "fix4-qa2-keyboard-end.png");
    writeJson("fix4-qa2-01-keyboard.json", out);
  } finally {
    await browser.close();
  }
};
run();