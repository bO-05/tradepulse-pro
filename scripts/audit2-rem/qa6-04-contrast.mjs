// QA6-04: full visible-text contrast rescan at 1440x900 (all tabs + all dialogs + tour bar),
// with gradient-stop-aware background resolution. Verifies prior white-on-emerald-600 /
// sky-600 / amber-600 hits moved to 700+ (or dark text).
import {
  BASE_URL,
  armOpenerBySelector,
  armOpenerByText,
  clickHeaderTab,
  delay,
  gotoDemo,
  launchBrowser,
  shot,
  writeJson,
  writeLog,
} from "./qa6-lib.mjs";

const SCAN = () => {
  const parse = (s) => {
    if (!s) return null;
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((v) => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const stops = (img) => {
    const out = [];
    const re = /rgba?\(([^)]+)\)/g;
    let m;
    while ((m = re.exec(img))) {
      const p = m[1].split(",").map((v) => parseFloat(v));
      out.push({ r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] });
    }
    return out;
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.05;
  };
  const hasDirectText = (el) => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim().length >= 2) return true;
    return false;
  };
  const pageBase = parse(getComputedStyle(document.body).backgroundColor) || { r: 2, g: 6, b: 23, a: 1 };
  const results = [];
  const gradientText = [];
  for (const el of document.querySelectorAll("*")) {
    if (!hasDirectText(el) || !visible(el)) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    if (el.closest("button:disabled,input:disabled,select:disabled,textarea:disabled,[aria-disabled='true']")) continue;
    const cs = getComputedStyle(el);
    const fgRaw = parse(cs.color);
    if (!fgRaw) continue;
    const text = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .slice(0, 90);
    if (fgRaw.a === 0 || cs.webkitTextFillColor === "rgba(0, 0, 0, 0)") {
      gradientText.push({ text, cls: (el.className || "").toString().slice(0, 80) });
      continue;
    }
    const solidLayers = [];
    const images = [];
    let cur = el;
    let opacity = 1;
    while (cur) {
      const ccs = getComputedStyle(cur);
      opacity *= parseFloat(ccs.opacity) || 1;
      const img = ccs.backgroundImage && ccs.backgroundImage !== "none" ? ccs.backgroundImage : null;
      let opaqueGradient = false;
      if (img) {
        const st = stops(img);
        if (st.length) {
          images.push(img);
          opaqueGradient = st.some((s) => s.a >= 0.999);
        }
      }
      const c = parse(ccs.backgroundColor);
      if (c && c.a > 0) {
        solidLayers.push(c);
        if (c.a >= 0.999) break;
      }
      if (opaqueGradient) break;
      cur = cur.parentElement;
    }
    let base = null;
    const opaqueIdx = solidLayers.findIndex((l) => l.a >= 0.999);
    if (opaqueIdx >= 0) {
      base = { ...solidLayers[opaqueIdx] };
      for (let i = opaqueIdx - 1; i >= 0; i--) base = over(solidLayers[i], base);
    } else {
      base = { ...pageBase };
      for (let i = solidLayers.length - 1; i >= 0; i--) base = over(solidLayers[i], base);
    }
    let fg = fgRaw;
    if (opacity < 0.999) fg = { ...fgRaw, a: fgRaw.a * opacity };
    const composedFg = fg.a >= 0.999 ? fg : over(fg, base);
    const fs = parseFloat(cs.fontSize);
    const fw = parseInt(cs.fontWeight, 10) || 400;
    const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
    const req = large ? 3 : 4.5;
    let worst = null;
    if (images.length) {
      for (const img of images) {
        for (const st of stops(img)) {
          const sc = st.a >= 0.999 ? st : over(st, base);
          const r = ratio(composedFg, sc);
          if (!worst || r < worst.r) worst = { r, stop: st, img: img.slice(0, 90) };
        }
      }
    } else {
      worst = { r: ratio(composedFg, base), stop: base, img: null };
    }
    if (worst && worst.r < req) {
      results.push({
        text,
        ratio: Math.round(worst.r * 100) / 100,
        required: req,
        fg: cs.color,
        bg: `rgb(${Math.round(worst.stop.r)}, ${Math.round(worst.stop.g)}, ${Math.round(worst.stop.b)})`,
        gradient: images.length > 0 ? worst.img : null,
        fontSize: cs.fontSize,
        fontWeight: fw,
        large,
        el: el.tagName.toLowerCase() + "." + (el.className || "").toString().split(/\s+/).slice(0, 4).join("."),
      });
    }
  }
  const seen = new Set();
  const dedup = [];
  for (const r of results.sort((a, b) => a.ratio - b.ratio)) {
    const k = `${r.text}|${r.fg}|${r.bg}|${r.fontSize}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(r);
  }
  return { violations: dedup.slice(0, 120), totalViolations: results.length, gradientText: gradientText.slice(0, 30), gradientTextCount: gradientText.length };
};

const PRIOR_PROBE = () => {
  const parse = (s) => {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((v) => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const targets = [
    "Award Compliant Winner",
    "Award Subcontract & Generate AIA A401",
    "Simulate Inbound RFI",
    "Assign to Div 23",
    "1-Click Deduct Credit",
    "Inspect Bid Leveling Matrix",
    "Assign to Div 26",
    "Run Extraction & Leveling Check",
    "Run Token Diagnostics",
  ];
  const out = [];
  for (const b of document.querySelectorAll("button")) {
    const t = (b.innerText || "").trim().replace(/\s+/g, " ");
    if (!targets.some((x) => t.includes(x))) continue;
    const r = b.getBoundingClientRect();
    if (r.width < 1) continue;
    const cs = getComputedStyle(b);
    const fg = parse(cs.color);
    const bg = parse(cs.backgroundColor);
    if (!fg || !bg || bg.a < 0.999) continue;
    out.push({ text: t.slice(0, 60), color: cs.color, bg: cs.backgroundColor, ratio: Math.round(ratio(fg, bg) * 100) / 100, required: 4.5 });
  }
  return out;
};

const countLegacyBgs = () => {
  const legacy = { "rgb(5, 150, 105)": 0, "rgb(2, 132, 199)": 0, "rgb(217, 119, 6)": 0 };
  const white = { "rgb(5, 150, 105)": 0, "rgb(2, 132, 199)": 0, "rgb(217, 119, 6)": 0 };
  for (const el of document.querySelectorAll("button,span,div,a")) {
    const cs = getComputedStyle(el);
    if (legacy[cs.backgroundColor] === undefined) continue;
    legacy[cs.backgroundColor]++;
    const c = getComputedStyle(el).color;
    if (c === "rgb(255, 255, 255)") white[cs.backgroundColor]++;
  }
  return { elementsOnLegacyBg: legacy, whiteTextOnLegacyBg: white };
};

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = { url: BASE_URL, viewport: "1440x900", startedAt: new Date().toISOString(), surfaces: {}, priorHits: [], legacy600: null };
  const lines = [];
  try {
    out.project = await gotoDemo(page);

    const scanSurface = async (id, label) => {
      const res = await page.evaluate(SCAN);
      const prior = await page.evaluate(PRIOR_PROBE);
      if (prior.length) out.priorHits.push({ surface: id, hits: prior });
      out.surfaces[id] = res;
      const l = `CONTRAST ${id} (${label}): strict=${res.totalViolations} gradientText=${res.gradientTextCount}`;
      lines.push(l);
      res.violations.slice(0, 10).forEach((v) => lines.push(`   ${v.ratio}:1 need ${v.required} ${v.fontSize}/${v.fontWeight} fb=${v.fg} bg=${v.bg}${v.gradient ? " grad" : ""} :: ${JSON.stringify(v.text)}`));
      console.log(l);
      res.violations.slice(0, 6).forEach((v) => console.log(`   ${v.ratio}:1 need ${v.required} fg=${v.fg} bg=${v.bg}${v.gradient ? " grad" : ""} :: ${v.text}`));
      return res;
    };

    const tabs = [
      ["packages", "01: CSI Scoping"],
      ["discovery", "02: Discovery"],
      ["qna", "03: Pre-Bid"],
      ["leveling", "04: Bid Leveling"],
      ["coordination", "05: Scope Clash"],
      ["contracts", "06: Subcontracts"],
      ["audit", "Live Activity Audit"],
      ["diagnostics", "Evals & Architecture"],
    ];
    for (const [id, label] of tabs) {
      await clickHeaderTab(page, label);
      await scanSurface(id, label);
    }

    // legacy-600 counts across every tab already seen: recompute once at end of tab loop is
    // per-tab; do a dedicated sweep to detect remaining white-on-600 anywhere.
    out.legacy600 = { perTab: {} };
    for (const [id, label] of tabs) {
      await clickHeaderTab(page, label);
      await delay(250);
      out.legacy600.perTab[id] = await page.evaluate(countLegacyBgs);
    }

    const modal = async (id, arm, label) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await delay(250);
      const op = await arm();
      if (!op) {
        lines.push(`CONTRAST ${id}: OPENER NOT FOUND`);
        return;
      }
      await page.mouse.click(op.x, op.y);
      await delay(600);
      await scanSurface(id, label);
      await shot(page, `fix4-qa6-04-contrast-${id}.png`);
      await page.keyboard.press("Escape");
      await delay(500);
      const still = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter((e) => e.getBoundingClientRect().width > 0).length);
      if (still) {
        await page.evaluate(() => {
          const ds = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getBoundingClientRect().width > 0);
          const d = ds[ds.length - 1];
          const b = d && [...d.querySelectorAll("button")].find((x) => /cancel|close/i.test((x.getAttribute("aria-label") || "") + " " + (x.innerText || "")));
          if (b) b.click();
        });
        await delay(400);
      }
    };

    await clickHeaderTab(page, "01: CSI Scoping");
    await modal("new-project", () => armOpenerByText(page, "New Project", true), "New Project dialog");
    await modal("create-package", () => armOpenerByText(page, "Create Trade Package"), "Create Trade Package dialog");
    await modal("ai-spec", () => armOpenerByText(page, "AI Spec Breakdown"), "AI Spec dialog");
    await clickHeaderTab(page, "02: Discovery");
    await modal("add-contractor", () => armOpenerByText(page, "Add Contractor Manually"), "Add Contractor dialog");
    await modal("edit-contractor", () => armOpenerBySelector(page, 'button[title="Edit contractor info"]'), "Edit Contractor dialog");
    await clickHeaderTab(page, "04: Bid Leveling");
    await modal("ingest-quote", () => armOpenerByText(page, "Ingest Quote / PDF"), "Ingest Quote dialog");
    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(200);
    await modal("judge-dock", () => armOpenerByText(page, "60s Judge Dock"), "Judge Dock");
    const cueAlready = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) => (b.getAttribute("title") || "").includes("full presenter script"))
    );
    if (!cueAlready) {
      await modal("tour", () => armOpenerByText(page, "Demo Tour"), "Investor Demo Tour bar");
    } else {
      await scanSurface("tour", "Investor Demo Tour bar (already open)");
      await shot(page, "fix4-qa6-04-contrast-tour.png");
    }

    const summary = {};
    for (const [k, v] of Object.entries(out.surfaces)) summary[k] = v.totalViolations;
    lines.unshift(`summary strict violations: ${JSON.stringify(summary)}`);
    lines.push(`legacy600: ${JSON.stringify(out.legacy600.perTab)}`);
    writeJson("fix4-qa6-04-contrast.json", out);
    writeLog("fix4-qa6-04-contrast.log", lines);
    console.log(JSON.stringify(summary));
  } finally {
    await browser.close();
  }
};
run();