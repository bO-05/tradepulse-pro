import puppeteer from "puppeteer-core";
import { launchBrowser, waitForAppReady, attachDiagnostics, shot, writeJson, delay, BASE_URL } from "./lib.mjs";

const TABS = ["packages", "discovery", "qna", "leveling", "coordination", "contracts", "audit", "diagnostics"];

const inventory = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const name = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const t = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ").trim();
      if (t) return t;
    }
    return (el.innerText || el.getAttribute("title") || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 100);
  };
  const buttons = [...document.querySelectorAll("button")].filter(vis).map((b) => ({
    name: name(b),
    iconOnly: !(b.innerText || "").trim(),
    ariaLabel: b.getAttribute("aria-label"),
    title: b.getAttribute("title"),
    disabled: b.disabled,
    type: b.getAttribute("type"),
    w: Math.round(b.getBoundingClientRect().width),
    h: Math.round(b.getBoundingClientRect().height),
    bg: getComputedStyle(b).backgroundColor,
    fg: getComputedStyle(b).color,
    fs: getComputedStyle(b).fontSize,
    fw: getComputedStyle(b).fontWeight,
  }));
  const links = [...document.querySelectorAll("a")].filter(vis).map((a) => ({ text: (a.innerText || "").trim().slice(0, 80), href: a.getAttribute("href") }));
  const selects = [...document.querySelectorAll("select")].filter(vis).map((s) => ({
    ariaLabel: s.getAttribute("aria-label"),
    id: s.id,
    hasLabelEl: !!(s.id && document.querySelector(`label[for="${s.id}"]`)),
    wrappingLabel: !!s.closest("label"),
    text: (s.options[s.selectedIndex] || {}).text || "",
    opts: [...s.options].map((o) => o.text.trim().slice(0, 60)).slice(0, 12),
  }));
  const fields = [...document.querySelectorAll("input,textarea")].filter(vis).map((i) => ({
    tag: i.tagName.toLowerCase(),
    type: i.getAttribute("type") || "",
    ariaLabel: i.getAttribute("aria-label"),
    id: i.id,
    name: i.getAttribute("name"),
    hasLabelEl: !!(i.id && document.querySelector(`label[for="${i.id}"]`)),
    wrappingLabel: !!i.closest("label"),
    placeholder: i.getAttribute("placeholder"),
    required: i.required,
    title: i.getAttribute("title"),
  }));
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(vis).map((h) => ({ tag: h.tagName.toLowerCase(), text: (h.innerText || "").trim().replace(/\s+/g, " ").slice(0, 100) }));
  const roles = [...document.querySelectorAll("[role]")].filter(vis).map((r) => ({ role: r.getAttribute("role"), name: name(r).slice(0, 60), tag: r.tagName.toLowerCase() }));
  const ellipsis = [...document.querySelectorAll("*")].filter(vis).filter((el) => {
    const cs = getComputedStyle(el);
    return cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1 && (el.innerText || "").trim().length > 3 && el.children.length === 0;
  }).map((el) => ({ text: (el.innerText || "").trim().slice(0, 80), title: el.getAttribute("title"), ariaLabel: el.getAttribute("aria-label"), w: el.clientWidth, sw: el.scrollWidth }));
  const stageSelect = document.querySelector('select[aria-label="Navigate procurement stage"]');
  return {
    title: document.title,
    activeProject: (() => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      return s ? s.options[s.selectedIndex]?.text : null;
    })(),
    buttons,
    links,
    selects,
    fields,
    headings,
    roles,
    ellipsis,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    stageSelectVisible: stageSelect ? stageSelect.getBoundingClientRect().width > 0 : false,
    bodyChars: document.body.innerText.length,
  };
};

const run = async () => {
  const { browser, executablePath } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const out = { base: BASE_URL, executablePath, tabs: {} };
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(800);
    out.initial = await page.evaluate(inventory);
    console.log("INITIAL PROJECT:", out.initial.activeProject);
    console.log("INITIAL SELECTS:", JSON.stringify(out.initial.selects.map((s) => [s.ariaLabel, s.text])));
    for (const tab of TABS) {
      await page.evaluate((t) => {
        const b = [...document.querySelectorAll("header button")].find((x) => {
          const title = x.getAttribute("title") || "";
          const norm = title.toLowerCase();
          const map = { packages: "01:", discovery: "02:", qna: "03:", leveling: "04:", coordination: "05:", contracts: "06:", audit: "live activity audit", diagnostics: "evals" };
          return norm.includes(map[t]);
        });
        if (b) b.click();
        return !!b;
      }, tab);
      await delay(700);
      out.tabs[tab] = await page.evaluate(inventory);
      await shot(page, `fix4-qa2-tab-${tab}.png`);
      console.log(`TAB ${tab}: buttons=${out.tabs[tab].buttons.length} fields=${out.tabs[tab].fields.length} headings=${out.tabs[tab].headings.length} ellipsis=${out.tabs[tab].ellipsis.length} overflowX=${out.tabs[tab].overflowX}`);
    }
    out.diag = { consoleErrors: diag.consoleLogs.filter((c) => c.type === "error"), pageErrors: diag.pageErrors, failedRequests: diag.failedRequests.slice(0, 20) };
    console.log("DIAG:", JSON.stringify(out.diag));
    writeJson("fix4-qa2-00-recon.json", out);
  } finally {
    await browser.close();
  }
};
run();