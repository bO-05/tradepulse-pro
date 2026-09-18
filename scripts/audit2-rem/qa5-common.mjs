import { setTimeout as delay } from "node:timers/promises";
import { ConvexHttpClient } from "convex/browser";
import { launchBrowser, waitForAppReady, shot, writeJson } from "./lib.mjs";

export { delay, shot, writeJson };
export const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");

export async function q(path, args, attempts = 5) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await http.query(path, args);
    } catch (e) {
      lastErr = e;
      await delay(1500 + i * 1000);
    }
  }
  throw lastErr;
}

export const PROJECT_TITLE = "AUDIT-QA5-VERIFY-2026-09-18";
export const CONCRETE = { csi: "03 30 00", name: "QA5 Structural Concrete", budget: 2100000 };
export const PLUMBING = { csi: "22 00 00", name: "QA5 Plumbing Systems", budget: 900000 };
export const HVAC = { csi: "23 00 00", name: "QA5 HVAC Mechanical", budget: 1500000 };

export async function openApp() {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    try {
      window.localStorage.setItem("tradepulse.tourDismissed", "1");
    } catch {}
  });
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1200);
  await closeTour(page);
  return { browser, page };
}

export async function closeTour(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(300);
}

export async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

export async function bodyIncludes(page, text) {
  return page.evaluate((t) => document.body.innerText.includes(t), text);
}

export async function waitForBody(page, text, timeout = 15000, interval = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await bodyIncludes(page, text)) return true;
    await delay(interval);
  }
  return false;
}

export async function findButtonBox(page, text, opts = {}) {
  return page.evaluate(
    (needle, exact) => {
      const buttons = [...document.querySelectorAll("button")];
      const match = buttons.find((b) => {
        const t = (b.textContent || "").trim().replace(/\s+/g, " ");
        return exact ? t === needle : t.includes(needle);
      });
      if (!match) return null;
      match.scrollIntoView({ block: "center" });
      const r = match.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (match.textContent || "").trim().replace(/\s+/g, " ") };
    },
    text,
    !!opts.exact
  );
}

export async function clickText(page, text, opts = {}) {
  const t0 = Date.now();
  const timeout = opts.timeout ?? 12000;
  while (Date.now() - t0 < timeout) {
    const box = await findButtonBox(page, text, opts);
    if (box) {
      await page.mouse.click(box.x, box.y);
      return { ok: true, ...box };
    }
    await delay(300);
  }
  return { ok: false, reason: "button not found", text };
}

export async function clickTab(page, prefix) {
  return page.evaluate((p) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(p));
    b?.click();
    return Boolean(b);
  }, prefix);
}

export async function selectProject(page, projectId) {
  await page.evaluate((pid) => {
    const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    if (!s) return false;
    s.value = pid;
    s.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, projectId);
  await delay(1800);
}

export async function selectRibbonPackage(page, tradeName) {
  const ok = await page.evaluate((needle) => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.textContent || "").includes(needle) && x.getAttribute("aria-pressed") !== null
    );
    if (!b) return false;
    b.click();
    return true;
  }, tradeName);
  await delay(1200);
  return ok;
}

export async function selectPackageCard(page, tradeName) {
  const ok = await page.evaluate((name) => {
    const h = [...document.querySelectorAll("h3")].find((x) => (x.textContent || "").trim() === name);
    if (!h) return false;
    h.click();
    return true;
  }, tradeName);
  await delay(1200);
  return ok;
}

export async function setInputByLabel(page, label, value) {
  return page.evaluate(
    (lbl, val) => {
      const el = document.querySelector(`[aria-label="${lbl}"]`);
      if (!el) throw new Error("input not found: " + lbl);
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value;
    },
    label,
    value
  );
}

export async function setInputByPlaceholder(page, placeholder, value) {
  return page.evaluate(
    (ph, val) => {
      const el = [...document.querySelectorAll("input,textarea")].find((x) => x.getAttribute("placeholder") === ph);
      if (!el) throw new Error("input not found by placeholder: " + ph);
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value;
    },
    placeholder,
    value
  );
}

export async function confirmDialog(page, confirmLabel, { cancel = false } = {}) {
  const t0 = Date.now();
  let box = null;
  while (Date.now() - t0 < 6000) {
    box = await page.evaluate((lbl) => {
      const dialogs = [...document.querySelectorAll('[role="alertdialog"]')];
      const d = dialogs[dialogs.length - 1];
      if (!d) return null;
      const btns = [...d.querySelectorAll("button")];
      const target = btns.find((b) => (b.textContent || "").trim() === lbl);
      if (!target) return null;
      const r = target.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, title: d.querySelector("h2")?.textContent?.trim() };
    }, cancel ? "Cancel" : confirmLabel);
    if (box) break;
    await delay(250);
  }
  if (!box) return { ok: false, reason: "confirm dialog not found", confirmLabel };
  await page.mouse.click(box.x, box.y);
  return { ok: true, dialogTitle: box.title };
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // skip
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export async function dumpBackendFixture(projectId) {
  const packages = await http.query("tradePackages:listByProject", { projectId });
  const bids = await http.query("bids:listAllProjectBids", { projectId });
  const contractors = await http.query("contractors:listByProject", { projectId });
  const agreements = await http.query("agreements:listAgreements", { projectId });
  const conversations = [];
  for (const p of packages) {
    const list = await http.query("rfq:listConversations", { tradePackageId: p._id });
    conversations.push(...list.map((c) => ({ ...c, csiDivision: p.csiDivision })));
  }
  return { packages, bids, contractors, agreements, conversations };
}