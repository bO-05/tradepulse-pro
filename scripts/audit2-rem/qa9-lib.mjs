import { ConvexHttpClient } from "convex/browser";
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

export const URL = "https://brainy-skunk-440.convex.cloud";
export const WEBSITE = "https://brainy-skunk-440.convex.site";
export const EVIDENCE_DIR = path.resolve("evidence");
export const FIXTURE_TAG = "AUDIT-QA9";

export function client() {
  const raw = new ConvexHttpClient(URL);
  return {
    raw,
    query: (name, args) => withRetry(() => raw.query(name, args), 3),
    mutation: (name, args) => withRetry(() => raw.mutation(name, args), 2),
  };
}

export async function withRetry(fn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = String(err?.message ?? err);
      const transient = /fetch failed|ECONNRESET|socket hang up|network|ETIMEDOUT|EAI_AGAIN|timed out/i.test(msg);
      if (!transient) throw err;
      await delay(700 * (i + 1));
    }
  }
  throw last;
}

export function fixtureName(purpose, tag) {
  const t = tag || FIXTURE_TAG;
  return `${t}-${purpose}`;
}

export function isQa9Title(title) {
  return typeof title === "string" && title.includes(FIXTURE_TAG);
}

export function writeEvidence(name, obj) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `fix4-qa9-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  console.log(`[evidence] ${file}`);
  return file;
}

export function writeLog(name, lines) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `fix4-qa9-${name}.log`);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  console.log(`[log] ${file}`);
  return file;
}

export async function call(label, fn) {
  try {
    const value = await fn();
    console.log(`  PASS  ${label}`);
    return { label, ok: true, value };
  } catch (err) {
    const data = err && typeof err === "object" && "data" in err ? err.data : null;
    const entry = {
      label,
      ok: false,
      data: typeof data === "string" ? data : data == null ? null : JSON.stringify(data),
      message: err?.message ?? String(err),
    };
    console.log(`  FAIL  ${label} :: ${entry.data ?? entry.message.split("\n")[0]}`);
    return entry;
  }
}

export async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const BROWSER_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

export async function launchBrowser(width = 1440, height = 950) {
  const executablePath = BROWSER_CANDIDATES.find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error("No Chrome/Edge executable found");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    protocolTimeout: 300000,
    args: ["--no-sandbox", "--disable-dev-shm-usage", `--window-size=${width},${height}`],
    defaultViewport: { width, height },
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

export function diagnosticsSummary(diag) {
  const errors = diag.consoleLogs.filter((l) => l.type === "error");
  return {
    consoleErrors: errors.slice(0, 20),
    consoleErrorCount: errors.length,
    pageErrors: diag.pageErrors.slice(0, 10),
    failedRequests: diag.failedRequests.slice(0, 20),
  };
}

export async function shot(page, name, opts = {}) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const p = path.join(EVIDENCE_DIR, name);
  await page.screenshot({ path: p, fullPage: !!opts.full });
  return p;
}

export async function waitForAppReady(page, timeout = 45000) {
  await page.waitForSelector('select[aria-label="Select Commercial Construction Project"]', { timeout });
  await page.waitForFunction(() => !document.body.innerText.includes("Connecting to Convex reactive backend"), { timeout });
  await delay(600);
}

export async function text(page) {
  return page.evaluate(() => document.body.innerText);
}

export async function selectProjectByTitle(page, substring) {
  const res = await page.evaluate((needle) => {
    const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    if (!sel) return { ok: false, reason: "selector not found" };
    const opt = [...sel.options].find((o) => o.textContent.includes(needle));
    if (!opt) return { ok: false, reason: "option not found", options: [...sel.options].map((o) => o.textContent.trim()) };
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: opt.value, label: opt.textContent.trim() };
  }, substring);
  if (res.ok) await delay(900);
  return res;
}

export async function currentProjectLabel(page) {
  return page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    if (!sel) return null;
    return sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent.trim() : null;
  });
}

export async function setReactValue(page, selector, value) {
  return page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error("input not found: " + sel);
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value;
    },
    selector,
    value
  );
}

/** Real keyboard typing into a located element (clears first). */
export async function typeInto(page, selector, value) {
  const handle = await page.$(selector);
  if (!handle) throw new Error("typeInto: not found " + selector);
  await handle.scrollIntoView();
  const box = await handle.boundingBox();
  await page.mouse.click(box.x + Math.min(10, box.width / 2), box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(String(value), { delay: 2 });
  return handle.evaluate((el) => el.value);
}

export async function clickByText(page, text, opts = {}) {
  const found = await page.evaluate(
    (needle, exact) => {
      const els = [...document.querySelectorAll("button, a, [role=button], [role=tab], label")];
      const match = els.find((b) => {
        const t = (b.textContent || "").trim();
        return exact ? t === needle : t.includes(needle);
      });
      if (!match) return null;
      match.scrollIntoView({ block: "center" });
      const r = match.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { hidden: true, t: (match.textContent || "").trim() };
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: (match.textContent || "").trim(), disabled: !!match.disabled };
    },
    text,
    !!opts.exact
  );
  if (!found) return { ok: false, reason: "not found", text };
  if (found.hidden) return { ok: false, reason: "zero-size", text: found.t };
  if (found.disabled) return { ok: false, reason: "disabled", text: found.t };
  await page.mouse.click(found.x, found.y);
  return { ok: true, text: found.t };
}

export async function buttonSnapshot(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b) => ({
      text: (b.textContent || "").trim().slice(0, 80),
      title: b.getAttribute("title") || "",
      aria: b.getAttribute("aria-label") || "",
      disabled: !!b.disabled,
      visible: b.getBoundingClientRect().width > 0,
    })).filter((b) => b.visible && (b.text || b.title || b.aria))
  );
}

export async function waitForText(page, needle, timeout = 20000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, needle);
}

export async function clickTab(page, label) {
  return clickByText(page, label, { exact: false });
}

export async function uploadFile(page, selector, filePath) {
  const input = await page.$(selector);
  if (!input) throw new Error("uploadFile: input not found " + selector);
  await input.uploadFile(filePath);
  await delay(300);
}

export function tmpFile(name, content) {
  const dir = path.join(process.env.TEMP || process.env.TMP || "C:/Users/user/AppData/Local/Temp", "opencode");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, "utf8");
  return p;
}

export async function deleteFixtureProject(c, projectId, note) {
  return call(`deleteProject ${note ?? projectId}`, () => c.mutation("projects:deleteProject", { projectId }));
}