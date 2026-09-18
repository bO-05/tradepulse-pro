import { launchBrowser, waitForAppReady, delay, selectProjectByTitle, shot } from "./lib.mjs";
import { writeEvidence, writeLog } from "./qa10-lib.mjs";

const log = [];
const say = (s) => { log.push(s); console.log(s); };

const TABS = [
  ["packages", "CSI Scoping"],
  ["discovery", "Discovery"],
  ["qna", "Pre-Bid Q&A"],
  ["leveling", "Bid Leveling"],
  ["coordination", "Scope Clash"],
  ["contracts", "Subcontracts"],
  ["audit", "Live Activity Audit"],
  ["diagnostics", "Evals & Architecture"],
];

const SCAN = () => {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.05;
  };
  const inScrollableX = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
      p = p.parentElement;
    }
    return false;
  };
  const overflowers = [];
  const unreachable = [];
  const occluded = [];
  const interactives = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    if (el.closest(".fixed.inset-0")) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !inScrollableX(el)) {
      overflowers.push({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60),
        left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
        cls: (el.className || "").toString().slice(0, 60),
      });
    }
    const tag = el.tagName.toLowerCase();
    if (["button", "a", "select", "input", "textarea"].includes(tag) && !el.disabled) {
      const name = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 60);
      interactives.push({ el, tag, name });
      const fullyOff = r.right < -1 || r.left > vw + 1 || r.bottom < -1 || r.top > vh + 1;
      if (fullyOff) unreachable.push({ tag, name, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], why: "off-viewport" });
    }
  }
  for (const it of interactives) {
    const r = it.el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), vh - 1);
    const top = document.elementFromPoint(cx, cy);
    if (!top) continue;
    if (top !== it.el && !it.el.contains(top) && !top.contains(it.el)) {
      occluded.push({ tag: it.tag, name: it.name, by: (top.getAttribute("aria-label") || top.innerText || top.tagName).toString().trim().slice(0, 50) });
    }
  }
  const clippedText = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || el.children.length > 0) continue;
    const t = (el.innerText || el.textContent || "").trim();
    if (t.length < 4) continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && !el.closest(".fixed.inset-0")) {
      clippedText.push({ text: t.slice(0, 50), clientW: el.clientWidth, scrollW: el.scrollWidth, title: el.getAttribute("title") });
    }
  }
  return {
    vw, vh,
    docScrollW: document.documentElement.scrollWidth,
    docOverflowX: document.documentElement.scrollWidth - vw,
    overflowers: overflowers.slice(0, 12),
    overflowersTotal: overflowers.length,
    unreachable: unreachable.slice(0, 12),
    unreachableTotal: unreachable.length,
    occluded: occluded.slice(0, 12),
    occludedTotal: occluded.length,
    clippedText: clippedText.slice(0, 10),
    clippedTotal: clippedText.length,
    mainText: (document.querySelector("main")?.innerText || "").slice(0, 200),
  };
};

const DIALOG_SCAN = () => {
  const overlays = [...document.querySelectorAll("div.fixed.inset-0")].filter((o) => o.getBoundingClientRect().width > 0);
  const overlay = overlays[overlays.length - 1];
  if (!overlay) return null;
  const dialog = overlay.querySelector('[role="dialog"],[role="alertdialog"]');
  const card = dialog || overlay.querySelector(":scope > div") || overlay.firstElementChild;
  const r = (card || overlay).getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  const buttons = [...(dialog || overlay).querySelectorAll("button")].filter((b) => b.getBoundingClientRect().width > 0);
  const unreachableActions = buttons.filter((b) => {
    const br = b.getBoundingClientRect();
    return br.right > vw + 1 || br.left < -1 || br.bottom > vh + 1 || br.top < -1;
  }).map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim().slice(0, 40));
  const active = document.activeElement;
  return {
    role: dialog ? dialog.getAttribute("role") : null,
    ariaModal: dialog ? dialog.getAttribute("aria-modal") : null,
    cardWidth: Math.round(r.width), cardHeight: Math.round(r.height),
    cardLeft: Math.round(r.left), cardRight: Math.round(r.right), cardTop: Math.round(r.top), cardBottom: Math.round(r.bottom),
    horizontalClip: (dialog || card).scrollWidth > (dialog || card).clientWidth + 1,
    verticalScrollable: (dialog || card).scrollHeight > (dialog || card).clientHeight + 1,
    inViewport: r.left >= -1 && r.right <= vw + 1 && r.top >= -1 && r.bottom <= vh + 1,
    actionCount: buttons.length,
    unreachableActions,
    focusInsideDialog: dialog ? dialog.contains(active) : null,
  };
};

async function openByText(page, text, exact = false) {
  return page.evaluate((needle, ex) => {
    const els = [...document.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().width > 0);
    const el = els.find((b) => (ex ? (b.innerText || "").trim() === needle : (b.innerText || "").includes(needle)));
    if (!el) return null;
    window.__qa10Opener = el;
    el.scrollIntoView({ block: "center" });
    el.focus();
    el.click();
    return { text: (el.innerText || "").trim().slice(0, 60) };
  }, text, exact);
}

async function closeTopDialog(page) {
  return page.evaluate(() => {
    const overlays = [...document.querySelectorAll("div.fixed.inset-0")].filter((o) => o.getBoundingClientRect().width > 0);
    const overlay = overlays[overlays.length - 1];
    if (!overlay) return false;
    const btn = [...overlay.querySelectorAll("button")].find((b) => /cancel|close|dismiss/i.test((b.getAttribute("aria-label") || "") + " " + (b.innerText || "")));
    if (btn) { btn.click(); return true; }
    return false;
  });
}

async function main() {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = { viewports: {} };
  try {
    const scenarios = [
      { label: "mobile320", w: 320, h: 700, shots: true },
      { label: "mobile375", w: 375, h: 812, shots: false },
      { label: "zoom200", w: 720, h: 450, shots: true, note: "720 CSS px = 1440@200% browser zoom" },
    ];
    for (const sc of scenarios) {
      await page.setViewport({ width: sc.w, height: sc.h, deviceScaleFactor: 1 });
      await page.goto("https://brainy-skunk-440.convex.site", { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForAppReady(page);
      await delay(800);
      await selectProjectByTitle(page, "AUDIT-QA10-ALPHA");
      await delay(1000);
      const vp = { tabs: {} };
      for (const [id, name] of TABS) {
        await page.evaluate((t) => {
          const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes(t) || (x.innerText || "").includes(t));
          if (b) b.click();
        }, name);
        await delay(750);
        await page.evaluate(() => window.scrollTo(0, 0));
        await delay(150);
        const m = await page.evaluate(SCAN);
        vp.tabs[id] = m;
        if (sc.shots) await shot(page, `fix4-qa10-06-${sc.label}-${id}.png`);
        say(`${sc.label} ${id}: overflowX=${m.docOverflowX} overflowers=${m.overflowersTotal} unreachable=${m.unreachableTotal} occluded=${m.occludedTotal} clipped=${m.clippedTotal}`);
        m.overflowers.slice(0, 3).forEach((o) => say(`    overflow ${o.tag} [${o.left},${o.right}] :: ${o.text}`));
        m.unreachable.slice(0, 3).forEach((o) => say(`    unreachable ${o.tag} "${o.name}" why=${o.why}`));
        m.occluded.slice(0, 3).forEach((o) => say(`    occluded ${o.tag} "${o.name}" by "${o.by}"`));
      }
      // dialogs at this viewport
      vp.dialogs = {};
      const dialogOpeners = [
        ["new-project", async () => openByText(page, "New Project", true)],
        ["create-package", async () => { await page.evaluate(() => { const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes("CSI Scoping") || (x.innerText || "").includes("CSI Scoping")); if (b) b.click(); }); await delay(600); return openByText(page, "Create Trade Package"); }],
        ["judge-dock", async () => openByText(page, "60s Judge Dock")],
        ["add-contractor", async () => { await page.evaluate(() => { const b = [...document.querySelectorAll("header button")].find((x) => (x.innerText || "").includes("Discovery")); if (b) b.click(); }); await delay(700); return openByText(page, "Add Contractor"); }],
        ["ingest-quote", async () => { await page.evaluate(() => { const b = [...document.querySelectorAll("header button")].find((x) => (x.innerText || "").includes("Bid Leveling")); if (b) b.click(); }); await delay(700); return openByText(page, "Ingest"); }],
      ];
      for (const [id, opener] of dialogOpeners) {
        let opened = null;
        try { opened = await opener(); } catch (e) { opened = { error: String(e.message) }; }
        await delay(550);
        let scan = await page.evaluate(DIALOG_SCAN);
        let trapEscape = null;
        if (scan) {
          // keyboard trap test: 30 Tabs, count focus escapes
          let outside = 0;
          const focusNames = [];
          for (let i = 0; i < 30; i++) {
            await page.keyboard.press("Tab");
            await delay(15);
            const st = await page.evaluate(() => {
              const overlays = [...document.querySelectorAll("div.fixed.inset-0")].filter((o) => o.getBoundingClientRect().width > 0);
              const overlay = overlays[overlays.length - 1];
              const dlg = overlay ? overlay.querySelector('[role="dialog"],[role="alertdialog"]') : null;
              const a = document.activeElement;
              return { inDialog: dlg ? dlg.contains(a) : false, tag: a ? a.tagName.toLowerCase() : null, name: (a && (a.getAttribute("aria-label") || a.innerText || "")) ? (a.getAttribute("aria-label") || a.innerText).trim().slice(0, 40) : "" };
            });
            focusNames.push(st.name);
            if (!st.inDialog) outside++;
          }
          trapEscape = { outside30: outside, sample: [...new Set(focusNames)].slice(0, 10) };
          await page.keyboard.press("Escape");
          await delay(350);
          const afterEsc = await page.evaluate(() => {
            const overlays = [...document.querySelectorAll("div.fixed.inset-0")].filter((o) => o.getBoundingClientRect().width > 0);
            const a = document.activeElement;
            return {
              overlaysLeft: overlays.length,
              activeTag: a ? a.tagName.toLowerCase() : null,
              activeName: a ? ((a.getAttribute("aria-label") || a.innerText || a.getAttribute("title") || "").trim().slice(0, 50)) : null,
              isBody: a === document.body,
              openerIsActive: a === window.__qa10Opener,
            };
          });
          subtractEscape = afterEsc;
          scan.afterEscape = afterEsc;
        } else if (opened) {
          // maybe already closed or opener missing; try cancel
          const cancelled = await closeTopDialog(page);
          scan = { opened, cancelled, missing: true };
        }
        vp.dialogs[id] = { opened, scan, trapEscape };
        const trapBad = trapEscape && trapEscape.outside30 > 0;
        say(`${sc.label} dialog ${id}: opened=${opened ? "yes" : "no"} inViewport=${scan?.inViewport} hClip=${scan?.horizontalClip} unreachableActions=${JSON.stringify(scan?.unreachableActions || [])} trapOutside=${trapEscape?.outside30 ?? "n/a"} afterEscActive="${scan?.afterEscape?.activeName ?? "?"}" openerRestored=${scan?.afterEscape?.openerIsActive ?? "?"}`);
        if (trapBad) say(`    FLAG focus escaped dialog ${trapEscape.outside30}/30 tabs`);
        // make sure it is closed for next iteration
        await page.keyboard.press("Escape").catch(() => {});
        await delay(250);
        await closeTopDialog(page).catch(() => {});
        await delay(250);
      }
      out.viewports[sc.label] = vp;
    }
    writeEvidence("responsive", out);
    writeLog("responsive", log);
    const bad = [];
    for (const [label, vp] of Object.entries(out.viewports)) {
      for (const [tab, m] of Object.entries(vp.tabs)) {
        if (m.docOverflowX > 1 || m.unreachableTotal > 0 || m.occludedTotal > 0) bad.push(`${label}/${tab}: overflowX=${m.docOverflowX} unreachable=${m.unreachableTotal} occluded=${m.occludedTotal}`);
      }
      for (const [d, v] of Object.entries(vp.dialogs)) {
        if (v.scan && v.scan.inViewport === false) bad.push(`${label}/dialog-${d}: card outside viewport`);
        if (v.scan && v.scan.horizontalClip) bad.push(`${label}/dialog-${d}: horizontal clip`);
        if (v.trapEscape && v.trapEscape.outside30 > 0) bad.push(`${label}/dialog-${d}: ${v.trapEscape.outside30}/30 tabs escaped dialog`);
      }
    }
    console.log(`\nRESPONSIVE FLAGS: ${bad.length}`);
    bad.forEach((b) => console.log("  " + b));
  } finally {
    await browser.close();
  }
}
let subtractEscape = null;
main().catch((e) => { console.error(e); process.exit(1); });