import { launchBrowser, waitForAppReady, writeJson, shot, delay } from "./lib.mjs";

const metrics = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
  };
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const overflowers = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!vis(el)) continue;
    if (el.closest(".fixed.inset-0")) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.right > vw + 1 || r.left < -1) {
      const parentClip = el.parentElement ? getComputedStyle(el.parentElement).overflowX : "visible";
      overflowers.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").toString().slice(0, 90),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        parentOverflowX: parentClip,
        text: (el.innerText || "").trim().slice(0, 50),
      });
    }
  }
  const clippedText = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!vis(el) || el.children.length > 0) continue;
    const t = (el.innerText || el.textContent || "").trim();
    if (t.length < 4) continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      clippedText.push({
        text: t.slice(0, 60),
        clientW: el.clientWidth,
        scrollW: el.scrollWidth,
        title: el.getAttribute("title"),
        ariaLabel: el.getAttribute("aria-label"),
        cls: (el.className || "").toString().slice(0, 70),
      });
    }
  }
  const stage = document.querySelector('select[aria-label="Navigate procurement stage"]');
  const stageLabel = stage ? stage.closest("label") : null;
  return {
    vw,
    vh,
    scrollW: document.documentElement.scrollWidth,
    overflowX: document.documentElement.scrollWidth - vw,
    overflowers: overflowers.slice(0, 25),
    overflowersTotal: overflowers.length,
    clippedText: clippedText.slice(0, 30),
    clippedTextTotal: clippedText.length,
    stageSelectVisible: stage ? stage.getBoundingClientRect().width > 0 : false,
    stageLabelVisible: stageLabel ? stageLabel.getBoundingClientRect().width > 0 : false,
    projectSelect: (() => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      if (!s) return null;
      return { clientW: s.clientWidth, scrollW: s.scrollWidth, title: s.getAttribute("title"), value: s.options[s.selectedIndex]?.text };
    })(),
  };
};

const dialogFit = () => {
  const overlays = [...document.querySelectorAll("div.fixed.inset-0")].filter((o) => o.getBoundingClientRect().width > 0);
  const overlay = overlays[overlays.length - 1];
  if (!overlay) return null;
  const card = overlay.querySelector(":scope > div") || overlay.firstElementChild;
  const dlg = overlay.querySelector('[role="dialog"],[role="alertdialog"]') || card;
  const r = dlg.getBoundingClientRect();
  const crate = card.getBoundingClientRect();
  const actionBtns = [...dlg.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().width > 0).map((b) => {
    b.scrollIntoView({ block: "nearest" });
    const br = b.getBoundingClientRect();
    return { text: (b.innerText || b.getAttribute("aria-label") || "").trim().slice(0, 40), bottom: Math.round(br.bottom), visible: br.bottom <= innerHeight + 1 && br.top >= -1, disabled: b.disabled };
  });
  return {
    role: dlg.getAttribute("role"),
    cardLeft: Math.round(crate.left),
    cardRight: Math.round(crate.right),
    cardWidth: Math.round(crate.width),
    cardHeight: Math.round(crate.height),
    cardScrollW: dlg.scrollWidth,
    cardClientW: dlg.clientWidth,
    horizontalClip: dlg.scrollWidth > dlg.clientWidth + 1,
    cardScrollH: dlg.scrollHeight,
    cardClientH: dlg.clientHeight,
    verticalScrollable: dlg.scrollHeight > dlg.clientHeight + 1,
    inViewport: crate.left >= -1 && crate.right <= innerWidth + 1,
    actions: actionBtns.slice(0, 6),
  };
};

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = { viewports: {} };
  const openers = [
    ["new-project", async () => { await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "New Project"); if (b) { b.scrollIntoView({ block: "center" }); b.click(); } }); }],
    ["create-package", async () => { await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Create Trade Package")); if (b) { b.scrollIntoView({ block: "center" }); b.click(); } }); }],
  ];
  try {
    for (const [w, h, label] of [
      [720, 450, "zoom200"],
      [375, 812, "mobile375"],
    ]) {
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await page.goto(process.env.REM_BASE_URL || "https://brainy-skunk-440.convex.site", { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForAppReady(page);
      await delay(900);
      await page.evaluate(() => { const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes("01: CSI Scoping")); if (b) b.click(); });
      await delay(600);
      const m = await page.evaluate(metrics);
      out.viewports[label] = { metrics: m, dialogs: {} };
      await shot(page, `fix4-qa2-${label}-packages.png`);
      console.log(`${label}: vw=${m.vw} overflowX=${m.overflowX} overflowers=${m.overflowersTotal} clipped=${m.clippedTextTotal} projectSelect=${JSON.stringify(m.projectSelect)} stageVisible=${m.stageSelectVisible}`);
      m.overflowers.slice(0, 8).forEach((o) => console.log(`   OVERFLOW ${o.tag} left=${o.left} right=${o.right} parentOverflowX=${o.parentOverflowX} :: ${o.text}`));
      m.clippedText.slice(0, 8).forEach((o) => console.log(`   CLIPPED "${o.text}" client=${o.clientW} scroll=${o.scrollW} title=${o.title}`));

      await page.evaluate(() => window.scrollTo(0, 0));
      await delay(300);
      for (const [id, open] of openers) {
        await open();
        await delay(600);
        const fit = await page.evaluate(dialogFit);
        out.viewports[label].dialogs[id] = fit;
        await shot(page, `fix4-qa2-${label}-dialog-${id}.png`);
        console.log(`   DIALOG ${id}: card=${fit.cardWidth}x${fit.cardHeight} clip=${fit.horizontalClip} vscroll=${fit.verticalScrollable} inViewport=${fit.inViewport} actions=${JSON.stringify(fit.actions.filter((a) => !a.visible).map((a) => a.text))}`);
        await page.keyboard.press("Escape");
        await delay(300);
        await page.evaluate(() => {
          const overlays = [...document.querySelectorAll("div.fixed.inset-0")].filter((o) => o.getBoundingClientRect().width > 0);
          const scope = overlays[overlays.length - 1];
          if (scope) {
            const b = [...scope.querySelectorAll("button")].find((x) => ((x.getAttribute("aria-label") || "") + " " + (x.innerText || "")).includes("Cancel"));
            if (b) b.click();
          }
        });
        await delay(300);
      }
    }
    writeJson("fix4-qa2-04-responsive.json", out);
  } finally {
    await browser.close();
  }
};
run();