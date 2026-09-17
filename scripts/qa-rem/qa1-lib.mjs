import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export { delay };

export const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
export const BASE_URL = process.env.QA_BASE_URL || "https://brainy-skunk-440.convex.site";

const BROWSER_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

export async function launchBrowser() {
  const executablePath = BROWSER_CANDIDATES.find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error("No Chrome/Edge executable found in common paths");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1600,1000"],
    defaultViewport: { width: 1600, height: 1000 },
  });
  return { browser, executablePath };
}

export function attachDiagnostics(page) {
  const consoleLogs = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on("console", (m) => consoleLogs.push({ type: m.type(), text: m.text() }));
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  page.on("requestfailed", (r) =>
    failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure() ? r.failure().errorText : "unknown"}`)
  );
  return { consoleLogs, pageErrors, failedRequests };
}

export async function shot(page, name) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const p = path.join(EVIDENCE_DIR, name);
  await page.screenshot({ path: p });
  return p;
}

export async function waitForAppReady(page, timeout = 30000) {
  await page.waitForSelector('select[aria-label="Select Commercial Construction Project"]', { timeout });
  await page.waitForFunction(
    () => !document.body.innerText.includes("Connecting to Convex reactive backend"),
    { timeout }
  );
}

export async function getSelectorState(page) {
  return page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    if (!sel) return null;
    return {
      value: sel.value,
      selectedText: sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent.trim() : null,
      options: [...sel.options].map((o) => ({ value: o.value, text: o.textContent.trim() })),
    };
  });
}

export async function selectProjectByTitle(page, titleSubstring) {
  return page.evaluate((needle) => {
    const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    if (!sel) return { ok: false, reason: "selector not found" };
    const opt = [...sel.options].find((o) => o.textContent.includes(needle));
    if (!opt) return { ok: false, reason: "option not found", options: [...sel.options].map((o) => o.textContent.trim()) };
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    const t0 = performance.now();
    return { ok: true, value: opt.value, text: opt.textContent.trim(), dispatchAt: t0 };
  }, titleSubstring);
}

export async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

export async function clickButtonByText(page, text, opts = {}) {
  return page.evaluate(
    (needle, exact) => {
      const buttons = [...document.querySelectorAll("button")];
      const match = buttons.find((b) => {
        const t = (b.textContent || "").trim();
        return exact ? t === needle : t.includes(needle);
      });
      if (!match) {
        return {
          ok: false,
          reason: "button not found",
          available: buttons.map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 60),
        };
      }
      match.scrollIntoView({ block: "center" });
      match.click();
      return { ok: true, text: (match.textContent || "").trim(), disabled: match.disabled };
    },
    text,
    !!opts.exact
  );
}

export async function setInputValue(page, selector, value) {
  return page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error("input not found: " + sel);
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value;
    },
    selector,
    value
  );
}

export function writeLog(name, lines) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const p = path.join(EVIDENCE_DIR, name);
  fs.writeFileSync(p, lines.join("\n") + "\n", "utf8");
  return p;
}

export function summarizeDiagnostics(diag) {
  return {
    consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text),
    consoleWarnings: diag.consoleLogs.filter((l) => l.type === "warning").map((l) => l.text),
    pageErrors: diag.pageErrors,
    failedRequests: diag.failedRequests,
    consoleLogCount: diag.consoleLogs.length,
  };
}