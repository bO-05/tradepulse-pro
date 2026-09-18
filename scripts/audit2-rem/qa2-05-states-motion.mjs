import { launchBrowser, waitForAppReady, writeJson, shot, delay, BASE_URL } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = { url: BASE_URL };
  try {
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);

    out.reducedMotion = await page.evaluate(() => {
      const mediaQueries = [];
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        const walk = (list) => {
          for (const r of list) {
            if (r.cssRules) walk(r.cssRules);
            if (r.media && r.media.mediaText && r.media.mediaText.includes("prefers-reduced-motion")) mediaQueries.push(r.media.mediaText + " :: " + (r.conditionText || ""));
          }
        };
        walk(rules);
      }
      const anim = [];
      for (const el of document.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.animationName && cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0) {
          anim.push({ tag: el.tagName.toLowerCase(), cls: (el.className || "").toString().slice(0, 90), name: cs.animationName, duration: cs.animationDuration, iteration: cs.animationIterationCount });
        }
      }
      const seen = new Set();
      const distinct = anim.filter((a) => { const k = a.name + "|" + a.iteration; if (seen.has(k)) return false; seen.add(k); return true; });
      const transitionCount = [...document.querySelectorAll("*")].filter((el) => {
        const cs = getComputedStyle(el);
        return cs.transitionDuration && parseFloat(cs.transitionDuration) > 0;
      }).length;
      return { prefersReducedMotionHandled: mediaQueries.length > 0, mediaQueries, animatedCount: anim.length, distinctAnimations: distinct, transitionCount };
    });

    out.states = await page.evaluate(async () => {
      const out = {};
      const prev = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").includes("Previous Scene"));
      const next = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").includes("Next Scene"));
      if (prev) {
        const cs = getComputedStyle(prev);
        out.disabledButton = { text: (prev.innerText || "").trim(), disabled: prev.disabled, opacity: cs.opacity, cursor: cs.cursor, color: cs.color, bg: cs.backgroundColor };
      }
      if (next) {
        const cs = getComputedStyle(next);
        out.enabledButton = { text: (next.innerText || "").trim(), disabled: next.disabled, opacity: cs.opacity, cursor: cs.cursor, color: cs.color, bg: cs.backgroundColor };
      }
      const statusLike = [...document.querySelectorAll("span,div")].filter((el) => {
        const t = (el.innerText || "").trim();
        if (!t || t.length > 22) return false;
        const cs = getComputedStyle(el);
        const bg = cs.backgroundColor;
        const border = cs.borderTopColor;
        const coloredBg = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
        const coloredBorder = border && border !== "rgba(0, 0, 0, 0)" && border !== "transparent";
        return (coloredBg || coloredBorder) && !/^[\d$.,:%/ ]+$/.test(t);
      });
      const statusWords = statusLike.map((el) => {
        const t = (el.innerText || "").trim();
        const cs = getComputedStyle(el);
        const icon = el.querySelector("svg");
        return { text: t, bg: cs.backgroundColor, border: cs.borderTopColor, textColor: cs.color, hasIcon: !!icon, ariaLabel: el.getAttribute("aria-label"), title: el.getAttribute("title") };
      });
      out.statusBadges = statusWords.slice(0, 30);
      const empties = [...document.querySelectorAll("p,div,span,h3")].filter((el) => /^(No |Nothing |None |—|There are no )/.test((el.innerText || "").trim()) && el.children.length === 0).map((el) => (el.innerText || "").trim().slice(0, 90));
      out.emptyStates = [...new Set(empties)].slice(0, 15);
      out.ariaBusy = [...document.querySelectorAll("[aria-busy]")].map((el) => (el.getAttribute("aria-busy") || "") + ":" + (el.className || "").toString().slice(0, 50));
      out.zIndexes = [...document.querySelectorAll("body *")].filter((el) => {
        const cs = getComputedStyle(el);
        return (cs.position === "fixed" || cs.position === "sticky") && cs.zIndex !== "auto";
      }).map((el) => ({ tag: el.tagName.toLowerCase(), pos: getComputedStyle(el).position, z: getComputedStyle(el).zIndex, cls: (el.className || "").toString().slice(0, 60) })).slice(0, 20);
      out.unreachableLabel = (() => {
        const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
        if (!s) return null;
        const ctx = document.createElement("canvas").getContext("2d");
        const cs = getComputedStyle(s);
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const text = s.options[s.selectedIndex]?.text || "";
        return { text, measuredTextWidth: Math.round(ctx.measureText(text).width), controlInnerWidth: s.clientWidth, truncated: ctx.measureText(text).width > s.clientWidth, title: s.getAttribute("title") };
      })();
      return out;
    });

    const hoverTarget = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").includes("New Project"));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color };
    });
    if (hoverTarget) {
      await page.mouse.move(hoverTarget.x, hoverTarget.y);
      await delay(350);
      const after = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").includes("New Project"));
        return { bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color };
      });
      out.hoverChange = { before: { bg: hoverTarget.bg, color: hoverTarget.color }, after, changed: after.bg !== hoverTarget.bg };
    }
    await shot(page, "fix4-qa2-states.png");
    writeJson("fix4-qa2-05-states-motion.json", out);
    console.log(JSON.stringify({ reduced: { handled: out.reducedMotion.prefersReducedMotionHandled, queries: out.reducedMotion.mediaQueries, animated: out.reducedMotion.animatedCount, distinct: out.reducedMotion.distinctAnimations, transitions: out.reducedMotion.transitionCount }, hover: out.hoverChange, disabled: out.states.disabledButton, enabled: out.states.enabledButton, trunc: out.states.unreachableLabel, emptyStates: out.states.emptyStates, z: out.states.zIndexes, statusCount: out.states.statusBadges.length }, null, 2));
  } finally {
    await browser.close();
  }
};
run();