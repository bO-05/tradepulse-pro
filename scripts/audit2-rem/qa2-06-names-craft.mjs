import { launchBrowser, waitForAppReady, writeJson, shot, delay, BASE_URL } from "./lib.mjs";

const AX = async (page) => {
  const snap = await page.accessibility.snapshot({ interestingOnly: true });
  const controls = [];
  const walk = (n) => {
    if (!n) return;
    if (["button", "link", "combobox", "textbox", "checkbox", "radio", "menuitem"].includes(n.role)) controls.push({ role: n.role, name: n.name, disabled: n.disabled });
    (n.children || []).forEach(walk);
  };
  walk(snap);
  return controls;
};

const clickTab = async (page, label) => {
  await page.evaluate((t) => {
    const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes(t) || (x.innerText || "").includes(t));
    if (b) b.click();
  }, label);
  await delay(600);
};

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = { url: BASE_URL };
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
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(900);

    out.ax = {};
    out.truncation = {};
    out.headings = {};
    for (const [id, label] of tabs) {
      await clickTab(page, label);
      const ax = await AX(page);
      out.ax[id] = { emptyNames: ax.filter((c) => !c.name || !c.name.trim()).map((c) => c.role), iconOnlyNames: ax.filter((c) => c.role === "button" && /^[✕×✖X]$/.test((c.name || "").trim())).map((c) => c.name), total: ax.length };
      out.truncation[id] = await page.evaluate(() => {
        const vis = (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== "none";
        const clipped = [];
        for (const el of document.querySelectorAll("body *")) {
          if (!vis(el)) continue;
          const cs = getComputedStyle(el);
          const isClamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
          const isEllipsis = cs.textOverflow === "ellipsis";
          if (!isClamp && !isEllipsis) continue;
          const overflowed = isClamp ? el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1 : el.scrollWidth > el.clientWidth + 1;
          if (!overflowed) continue;
          const text = (el.innerText || el.textContent || "").trim().slice(0, 70);
          if (text.length < 3) continue;
          clipped.push({ text, title: el.getAttribute("title"), ariaLabel: el.getAttribute("aria-label"), clamp: cs.webkitLineClamp, clientW: el.clientWidth, scrollW: el.scrollWidth, clientH: el.clientHeight, scrollH: el.scrollHeight, cls: (el.className || "").toString().slice(0, 60) });
        }
        const seen = new Set();
        return clipped.filter((c) => { const k = c.text; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 20);
      });
      out.headings[id] = await page.evaluate(() => {
        const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((h) => h.getBoundingClientRect().height > 0).map((h) => h.tagName + ":" + (h.innerText || "").trim().replace(/\s+/g, " "));
        const counts = {};
        hs.forEach((h) => (counts[h] = (counts[h] || 0) + 1));
        return { duplicates: Object.entries(counts).filter(([, c]) => c > 1), all: hs };
      });
      console.log(`AX ${id}: controls=${ax.length} empty=${out.ax[id].emptyNames.length} truncation=${out.truncation[id].length} dupHeadings=${out.headings[id].duplicates.length}`);
      out.truncation[id].slice(0, 6).forEach((t) => console.log(`   CLIP [${t.clamp}] clipW=${t.clientW}<${t.scrollW} title=${t.title} :: ${JSON.stringify(t.text)}`));
      out.headings[id].duplicates.forEach((d) => console.log(`   DUP ${d[0]} x${d[1]}`));
    }

    out.deadControls = {};
    out.deadControls.links = await page.evaluate(() =>
      [...document.querySelectorAll("a")].map((a) => ({ text: (a.innerText || "").trim().slice(0, 60), href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel"), hasClick: !!a.onclick })).filter((a) => !a.href || a.href === "#" || a.href.startsWith("javascript:") || (a.target === "_blank" && !a.rel))
    );

    out.stepperNav = [];
    const stepperLabels = ["01: CSI Scoping", "02: Discovery", "03: Pre-Bid", "04: Bid Leveling", "05: Scope Clash", "06: Subcontracts"];
    for (const label of stepperLabels) {
      const before = await page.evaluate(() => (document.querySelector("main h2") || {}).innerText || "");
      await clickTab(page, label);
      const after = await page.evaluate(() => (document.querySelector("main h2") || {}).innerText || "");
      out.stepperNav.push({ label, before: before.slice(0, 40), after: after.slice(0, 40), changed: before !== after });
    }
    out.utilityNav = [];
    for (const label of ["Live Activity Audit", "Evals & Architecture"]) {
      const before = await page.evaluate(() => (document.querySelector("main h2") || {}).innerText || "");
      await clickTab(page, label);
      const after = await page.evaluate(() => (document.querySelector("main h2") || {}).innerText || "");
      out.utilityNav.push({ label, before: before.slice(0, 40), after: after.slice(0, 40), changed: before !== after });
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(200);
    await page.keyboard.press("3");
    await delay(600);
    out.shortcut3 = await page.evaluate(() => {
      const active = [...document.querySelectorAll("header button")].filter((b) => getComputedStyle(b).boxShadow !== "none" && (b.getAttribute("title") || "").includes(": ")).map((b) => (b.getAttribute("title") || "").slice(0, 20));
      return { heading: (document.querySelector("main h2") || {}).innerText || "", activePills: active };
    });

    await clickTab(page, "01: CSI Scoping");
    out.duplicateButtons = await page.evaluate(() => {
      const map = {};
      [...document.querySelectorAll("button")].forEach((b) => {
        const k = ((b.innerText || b.getAttribute("title") || b.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "));
        if (!k) return;
        map[k] = (map[k] || 0) + 1;
      });
      return Object.entries(map).filter(([, c]) => c > 2).sort((a, b) => b[1] - a[1]).slice(0, 15);
    });

    out.closeButtonStyles = {};
    const recordClose = async (name, opener) => {
      await opener();
      await delay(450);
      const info = await page.evaluate(() => {
        const overlays = [...document.querySelectorAll("div.fixed.inset-0")].filter((o) => o.getBoundingClientRect().width > 0);
        const scope = overlays[overlays.length - 1] || document;
        const btns = [...scope.querySelectorAll("button")].filter((b) => ((b.getAttribute("aria-label") || "") + " " + (b.innerText || "")).toLowerCase().includes("close") || /^[✕×✖X]$/.test((b.innerText || "").trim()));
        const b = btns[0];
        if (!b) return null;
        const cs = getComputedStyle(b);
        return { label: b.getAttribute("aria-label") || (b.innerText || "").trim(), tag: b.tagName.toLowerCase(), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height), padding: cs.padding, fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, bg: cs.backgroundColor, radius: cs.borderRadius, hasIcon: !!b.querySelector("svg") };
      });
      out.closeButtonStyles[name] = info;
      await page.keyboard.press("Escape");
      await delay(300);
      await page.evaluate(() => {
        const overlays = [...document.querySelectorAll("div.fixed.inset-0")].filter((o) => o.getBoundingClientRect().width > 0);
        const scope = overlays[overlays.length - 1];
        if (scope) {
          const b = [...scope.querySelectorAll("button")].find((x) => ((x.getAttribute("aria-label") || "") + " " + (x.innerText || "")).includes("Close") || ((x.innerText || "").trim() === "Cancel"));
          if (b) b.click();
        }
      });
      await delay(300);
    };
    await recordClose("new-project", async () => { await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "New Project"); b.click(); }); });
    await recordClose("ai-spec", async () => { await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").includes("AI Spec Breakdown")); b.click(); }); });
    await recordClose("create-package", async () => { await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Create Trade Package")); b.click(); }); });
    await recordClose("judge-dock", async () => { await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").includes("60s Judge Dock")); b.click(); }); });
    await clickTab(page, "02: Discovery");
    await recordClose("add-contractor", async () => { await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Add Contractor Manually")); b.click(); }); });

    console.log("CLOSE STYLES:");
    Object.entries(out.closeButtonStyles).forEach(([k, v]) => console.log(`   ${k}: ${JSON.stringify(v)}`));
    console.log("EMPTY AX NAMES per tab:", JSON.stringify(Object.fromEntries(Object.entries(out.ax).map(([k, v]) => [k, v.emptyNames]))));
    console.log("STEPPER NAV:", JSON.stringify(out.stepperNav));
    console.log("SHORTCUT 3:", JSON.stringify(out.shortcut3));
    console.log("DEAD LINKS:", JSON.stringify(out.deadControls.links));
    writeJson("fix4-qa2-06-names-craft.json", out);
    await shot(page, "fix4-qa2-craft-end.png");
  } finally {
    await browser.close();
  }
};
run();