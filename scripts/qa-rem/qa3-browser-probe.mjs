import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const SITE = "https://brainy-skunk-440.convex.site";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EVIDENCE_DIR = path.resolve("doc/tradepulse audits/outputs/evidence");
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOG = [];
function log(...parts) {
  const line = parts.join(" ");
  LOG.push(line);
  console.log(line);
}
function shot(page, name) {
  const p = path.join(EVIDENCE_DIR, `remediation-qa3-${name}.png`);
  return page.screenshot({ path: p, fullPage: false });
}

const events = [];
let phase = "init";
function record(kind, detail) {
  events.push({ phase, kind, detail, at: new Date().toISOString() });
}

async function clickButtonByText(page, text) {
  return await page.evaluate((t) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const b = buttons.find((el) => (el.textContent || "").includes(t));
    if (!b) return false;
    b.scrollIntoView({ block: "center" });
    b.click();
    return true;
  }, text);
}

async function setDialogInput(page, index, value) {
  return await page.evaluate(
    ({ i, v }) => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return false;
      const input = dialog.querySelectorAll("input")[i];
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    { i: index, v: value }
  );
}

async function readDialogState(page) {
  return await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { open: false };
    const errorEl = Array.from(dialog.querySelectorAll("p")).find((p) => p.className.includes("text-rose-400"));
    const inputs = Array.from(dialog.querySelectorAll("input"));
    return {
      open: true,
      error: errorEl ? errorEl.textContent : null,
      validity: inputs.map((i) => ({ value: i.value, valueMissing: i.validity.valueMissing, rangeUnderflow: i.validity.rangeUnderflow, rangeOverflow: i.validity.rangeOverflow })),
      submitLabel: (Array.from(dialog.querySelectorAll("button")).find((b) => b.type === "submit") || {}).textContent || null,
    };
  });
}

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900 },
});

try {
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      record("console." + msg.type(), `${msg.text()} @ ${JSON.stringify(msg.location())}`);
    }
  });
  page.on("pageerror", (err) => record("pageerror", String(err && err.message ? err.message : err)));
  page.on("requestfailed", (req) => record("requestfailed", `${req.method()} ${req.url()} -> ${req.failure() ? req.failure().errorText : "?"}`));
  page.on("response", (res) => {
    if (res.status() >= 400) record("http>=400", `${res.request().method()} ${res.url()} -> ${res.status()}`);
  });

  // ---------- 1. LANDING ----------
  phase = "landing";
  const t0 = Date.now();
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(10000); // boot gate is 8s max
  log(`LANDING loaded in ${Date.now() - t0}ms; title="${await page.title()}"`);
  log(`LANDING text head: ${JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 300))}`);
  await shot(page, "01-landing-1440");

  // ---------- 2. TABS ----------
  const tabs = [
    ["1", "packages"],
    ["2", "discovery"],
    ["3", "qna"],
    ["4", "leveling"],
    ["5", "coordination"],
    ["6", "contracts"],
    ["7", "audit"],
    ["8", "diagnostics"],
  ];
  for (const [key, id] of tabs) {
    phase = `tab:${id}`;
    const before = events.length;
    await page.keyboard.press(key);
    await sleep(2500);
    const text = await page.evaluate(() => document.body.innerText);
    const hasContent = text.length > 500;
    log(`TAB ${id}: key=${key} contentChars=${text.length} ok=${hasContent} newEvents=${events.length - before}`);
    await shot(page, `02-tab-${id}`);
  }

  // ---------- 3. VALIDATION UI PROBES ----------
  phase = "ui-validation";
  await page.keyboard.press("1");
  await sleep(1000);
  let opened = await clickButtonByText(page, "New Project");
  log(`NEW PROJECT MODAL opened=${opened}`);
  await sleep(1200);
  await shot(page, "03-new-project-modal");

  // 3a. whitespace title
  let inputs = await page.$$('[role="dialog"] input');
  log(`DIALOG inputs=${inputs.length}`);
  await setDialogInput(page, 0, "   ");
  // keep defaults; submit
  let submitted = await clickButtonByText(page, "Create Commercial Project");
  await sleep(1500);
  let state = await readDialogState(page);
  log(`CASE whitespace-title: submitted=${submitted} dialogOpen=${state.open} error=${JSON.stringify(state.error)} validity=${JSON.stringify(state.validity)}`);
  await shot(page, "04-whitespace-title-result");

  // 3b. budget 1e12 (server-side rejection expected)
  phase = "ui-validation-budget1e12";
  await setDialogInput(page, 0, `QA-REM-qa3-ui-budget1e12-${Date.now()}`);
  await setDialogInput(page, 4, "1000000000000");
  await setDialogInput(page, 5, "12");
  submitted = await clickButtonByText(page, "Create Commercial Project");
  await sleep(3000);
  state = await readDialogState(page);
  log(`CASE budget-1e12: submitted=${submitted} dialogOpen=${state.open} error=${JSON.stringify(state.error)}`);
  await shot(page, "05-budget-1e12-result");

  // 3c. weeks 99999 (server-side rejection expected)
  phase = "ui-validation-weeks99999";
  await setDialogInput(page, 0, `QA-REM-qa3-ui-weeks99999-${Date.now()}`);
  await setDialogInput(page, 4, "250000");
  await setDialogInput(page, 5, "99999");
  submitted = await clickButtonByText(page, "Create Commercial Project");
  await sleep(3000);
  state = await readDialogState(page);
  log(`CASE weeks-99999: submitted=${submitted} dialogOpen=${state.open} error=${JSON.stringify(state.error)}`);
  await shot(page, "06-weeks-99999-result");

  // 3d. budget -5 + weeks 0 -> client coerces (expected silent accept)
  phase = "ui-validation-coerced";
  const coercedTitle = `QA-REM-qa3-ui-coerced-${Date.now()}`;
  await setDialogInput(page, 0, coercedTitle);
  await setDialogInput(page, 4, "-5");
  await setDialogInput(page, 5, "0");
  submitted = await clickButtonByText(page, "Create Commercial Project");
  await sleep(4000);
  state = await readDialogState(page);
  const toastText = await page.evaluate(() => {
    const t = document.body.innerText;
    const i = t.indexOf("Project '");
    return i >= 0 ? t.slice(i, i + 200) : null;
  });
  const selectorText = await page.evaluate(() => {
    const sel = document.querySelector("select");
    return sel ? sel.options[sel.selectedIndex]?.textContent : null;
  });
  log(`CASE budget-minus5-weeks0: submitted=${submitted} dialogOpen=${state.open} error=${JSON.stringify(state.error)}`);
  log(`CASE budget-minus5-weeks0 toast-ish=${JSON.stringify(toastText)} selector=${JSON.stringify(selectorText)}`);
  await shot(page, "07-coerced-budget-weeks-result");

  // ---------- 4. NONEXISTENT DEEP URLS ----------
  phase = "deep-urls";
  for (const url of [`${SITE}/project/does-not-exist-qa3`, `${SITE}/bid/does-not-exist-qa3`, `${SITE}/?projectId=jx0000000000000000000000000000`]) {
    const before = events.length;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(9000);
    const info = await page.evaluate(() => ({
      url: location.href,
      body: document.body.innerText.slice(0, 160),
      hasDialog: Boolean(document.querySelector('[role="dialog"]')),
      rootChildren: document.getElementById("root")?.children.length ?? -1,
    }));
    log(`DEEP URL ${url}: final=${info.url} rootChildren=${info.rootChildren} hasDialog=${info.hasDialog} newEvents=${events.length - before}`);
    log(`DEEP URL body: ${JSON.stringify(info.body)}`);
  }
  await shot(page, "08-deep-url-nonexistent");

  // ---------- 5. INVALID STORED PROJECT ID SELF-HEAL ----------
  phase = "stale-localstorage";
  await page.evaluate(() => localStorage.setItem("tradepulse.selectedProjectId", "jx0000000000000000000000000000"));
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(10000);
  const healed = await page.evaluate(() => {
    const sel = document.querySelector("select");
    return {
      stored: localStorage.getItem("tradepulse.selectedProjectId"),
      selector: sel ? sel.options[sel.selectedIndex]?.textContent : null,
      bodyHead: document.body.innerText.slice(0, 120),
    };
  });
  log(`STALE PROJECT ID: storedAfter=${healed.stored} selector=${JSON.stringify(healed.selector)}`);
  await shot(page, "09-stale-project-id");

  // ---------- 6. MOBILE 375 ----------
  phase = "mobile-375";
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(10000);
  const mobile = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide = [];
    document.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 2) {
        wide.push(`${el.tagName}.${(el.className || "").toString().slice(0, 40)} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
      }
    });
    const nav = document.querySelector("nav");
    const buttons = Array.from(document.querySelectorAll("button")).filter((b) => b.offsetParent !== null);
    return {
      innerWidth: window.innerWidth,
      docScrollWidth: doc.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      horizontalOverflow: doc.scrollWidth > window.innerWidth + 1,
      wideElementCount: wide.length,
      wideSample: wide.slice(0, 8),
      navScrollWidth: nav ? nav.scrollWidth : null,
      navClientWidth: nav ? nav.clientWidth : null,
      visibleButtons: buttons.length,
    };
  });
  log(`MOBILE 375: innerWidth=${mobile.innerWidth} docScrollWidth=${mobile.docScrollWidth} bodyScrollWidth=${mobile.bodyScrollWidth} overflow=${mobile.horizontalOverflow} wideElements=${mobile.wideElementCount} navScroll=${mobile.navScrollWidth}/${mobile.navClientWidth} visibleButtons=${mobile.visibleButtons}`);
  log(`MOBILE wide sample: ${JSON.stringify(mobile.wideSample)}`);
  await shot(page, "10-mobile-375-landing");

  // mobile: use a tab via keyboard and screenshot
  await page.keyboard.press("4");
  await sleep(2500);
  await shot(page, "11-mobile-375-leveling");
  phase = "mobile-375-tab4";
  log(`MOBILE tab4 contentChars=${(await page.evaluate(() => document.body.innerText)).length}`);
} catch (err) {
  log(`FATAL: ${String(err && err.stack ? err.stack : err)}`);
} finally {
  await browser.close();
}

const header = [
  "=== QA-3 BROWSER PROBE ===",
  `Site: ${SITE}`,
  `UTC: ${new Date().toISOString()}`,
  `Chrome: ${CHROME_PATH}`,
  "",
  "--- PHASE LOG ---",
  ...LOG,
  "",
  "--- CONSOLE/PAGE/NETWORK EVENTS ---",
  ...events.map((e) => `[${e.phase}] ${e.kind}: ${e.detail}`),
  "",
  `TOTAL EVENTS: ${events.length}`,
];
fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa3-browser-probe.txt"), header.join("\n"), "utf8");
console.log(`\nEvidence written: remediation-qa3-browser-probe.txt (${events.length} events)`);