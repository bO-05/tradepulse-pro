import {
  launchBrowser, attachDiagnostics, waitForAppReady, getSelectorState, shot, writeJson,
  bodyText, delay, kpiBandText,
} from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const out = { startedAt: new Date().toISOString(), checks: {} };
  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);

    // --- Collect header + KPI raw text
    out.headerText = await page.evaluate(() => document.querySelector("header")?.innerText || null);
    out.kpiText = await page.evaluate(() => {
      const m = document.body.innerText.match(/BASELINE:[\s\S]*?Expand 6-Card KPI View/);
      return m ? m[0] : null;
    });

    // --- BUG-01: New Project modal
    const np = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "New Project");
      if (!b) return { ok: false };
      b.click();
      return { ok: true };
    });
    await delay(700);
    out.checks["BUG-01"] = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return { dialog: false };
      const r = dlg.getBoundingClientRect();
      const wrapper = dlg.parentElement;
      const wr = wrapper ? wrapper.getBoundingClientRect() : null;
      const fields = [...dlg.querySelectorAll("input,textarea,select")].map((f) => {
        const fr = f.getBoundingClientRect();
        return { tag: f.tagName, top: Math.round(fr.top), bottom: Math.round(fr.bottom), visible: fr.top >= 0 && fr.bottom <= window.innerHeight };
      });
      return {
        dialog: true,
        dialogRect: { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) },
        wrapperRect: wr ? { top: Math.round(wr.top), height: Math.round(wr.height) } : null,
        viewportH: window.innerHeight,
        fields,
        scrollWidth: document.documentElement.scrollWidth,
        headerSticky: !!dlg.closest("header"),
        offsetParentChain: (() => { const c = []; let el = dlg; while (el && el !== document.body) { c.push(el.tagName + "." + (el.className || "").toString().slice(0, 40)); el = el.parentElement; } return c.slice(0, 8); })(),
      };
    });
    await shot(page, "fix-BUG01-newproject-modal.png");
    await page.keyboard.press("Escape");
    await delay(400);
    out.checks["BUG-01"].afterEscape = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));

    // --- All tabs sweep
    const tabs = ["CSI Scoping", "Discovery", "Pre-Bid Q&A", "Bid Leveling", "Scope Clash", "Subcontracts", "Live Activity Audit", "Evals & Architecture"];
    out.tabs = {};
    for (const t of tabs) {
      const clicked = await page.evaluate((name) => {
        const b = [...document.querySelectorAll("button")].find((x) => ((x.getAttribute("title") || "") + " " + (x.textContent || "")).includes(name) && !(x.textContent || "").includes("Demo Tour"));
        if (!b) return false;
        b.click();
        return true;
      }, t);
      await delay(900);
      if (!clicked) { out.tabs[t] = { clicked: false }; continue; }
      const tabText = await bodyText(page);
      out.tabs[t] = { clicked: true, text: tabText.slice(0, 4000) };
      await shot(page, `fix-live-tab-${t.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
    }

    // --- BUG-34 responsive overflow at multiple widths
    out.checks["BUG-34"] = {};
    for (const w of [375, 640, 768, 1024, 1280, 1440]) {
      await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
      await delay(600);
      out.checks["BUG-34"][w] = await page.evaluate(() => {
        const doc = document.documentElement;
        const offenders = [];
        const all = document.querySelectorAll("*");
        for (const el of all) {
          const r = el.getBoundingClientRect();
          if (r.right > window.innerWidth + 1) {
            const cs = getComputedStyle(el);
            if (cs.position === "fixed") continue;
            offenders.push({ tag: el.tagName, cls: (el.className || "").toString().slice(0, 110), right: Math.round(r.right), width: Math.round(r.width), scrollW: el.scrollWidth, clientW: el.clientWidth });
            if (offenders.length > 8) break;
          }
        }
        return { scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth, overflow: doc.scrollWidth - window.innerWidth, offenders };
      });
      if ([768, 1024].includes(w)) await shot(page, `fix-BUG34-${w}.png`);
    }
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await delay(500);

    // --- BUG-33 focus trap + restore
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("60s Judge Dock"));
      if (b) b.click();
    });
    await delay(900);
    const trap = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return { open: !!dlg, ariaModal: dlg ? dlg.getAttribute("aria-modal") : null };
    });
    const trail = [];
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press("Tab");
      const cur = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        const inDialog = !!el.closest('[role="dialog"]');
        return { tag: el.tagName, text: (el.textContent || el.getAttribute("title") || el.getAttribute("aria-label") || "").trim().slice(0, 60), inDialog };
      });
      trail.push(cur);
    }
    out.checks["BUG-33"] = { ...trap, tabTrail: trail, escaped: trail.some((t) => t && !t.inDialog) };
    await shot(page, "fix-BUG33-judge-dock-focus.png");
    await page.keyboard.press("Escape");
    await delay(600);
    out.checks["BUG-33"].afterEscape = await page.evaluate(() => {
      const el = document.activeElement;
      return { tag: el ? el.tagName : null, text: (el ? (el.textContent || el.getAttribute("title") || "") : "").trim().slice(0, 80), dialogOpen: !!document.querySelector('[role="dialog"]') };
    });

    // --- BUG-35 contrast sweep for slate-500 small text
    out.checks["BUG-35"] = await page.evaluate(() => {
      const parse = (c) => {
        const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
      };
      const lum = (rgb) => {
        const s = rgb.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
      };
      const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
      const isDark = (rgb) => lum(rgb) < 0.5;
      const blend = (fg, bg) => { const a = fg[3]; return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]; };
      const bgOf = (el) => {
        let cur = el;
        while (cur) {
          const cs = getComputedStyle(cur);
          if (cs.backgroundColor && !cs.backgroundColor.includes("rgba(0, 0, 0, 0)")) {
            const bg = parse(cs.backgroundColor);
            if (bg && bg[3] > 0.9) return bg;
          }
          cur = cur.parentElement;
        }
        return [10, 15, 29, 1];
      };
      const fails = [];
      const nodes = document.querySelectorAll("span,p,div,li,td,th,label,code");
      for (const el of nodes) {
        const txt = (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 3)) ? el.innerText : "";
        if (!txt || txt.length > 100) continue;
        const cs = getComputedStyle(el);
        const fg0 = parse(cs.color);
        if (!fg0) continue;
        const fs = parseFloat(cs.fontSize);
        if (fs > 12.5) continue;
        const fg = fg0[3] < 1 ? blend(fg0, bgOf(el)) : fg0;
        const bg = bgOf(el);
        if (!isDark(bg)) continue;
        const r = ratio(fg, bg);
        if (r < 4.5) {
          fails.push({ text: txt.slice(0, 60), color: cs.color, fontSize: cs.fontSize, bg: `rgb(${bg.slice(0, 3).map(Math.round).join(",")})`, ratio: Math.round(r * 100) / 100 });
        }
      }
      return { failCount: fails.length, sample: fails.slice(0, 12) };
    });

    // --- Timestamps on audit tab
    out.checks["BUG-10/28"] = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Live Activity Audit"));
      if (b) b.click();
      return true;
    });
    await delay(1200);
    out.checks["BUG-10/28"] = await page.evaluate(() => {
      const t = document.body.innerText;
      const times = t.match(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)\b/g) || [];
      return { times: times.slice(0, 15), count: times.length };
    });
    await shot(page, "fix-BUG10-audit-timestamps.png");

    out.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error"), pageErrors: diag.pageErrors, failedRequests: diag.failedRequests };
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
  } finally {
    writeJson("fix-verify-readonly.json", out);
    await browser.close();
  }
  console.log(JSON.stringify({ ok: !out.error, error: out.error, checks: Object.keys(out.checks || {}) }, null, 2));
  if (out.error) console.log(out.error);
  console.log(JSON.stringify(out.checks, null, 2));
};

run();