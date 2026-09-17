import fs from "node:fs";
import path from "node:path";
import { EVIDENCE_DIR, delay } from "./qa1-lib.mjs";

export * from "./qa1-lib.mjs";

export const STATE_PATH = path.join(EVIDENCE_DIR, "remediation-qa5-state.json");

export function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function saveState(patch) {
  const next = { ...loadState(), ...patch, updatedAt: new Date().toISOString() };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function makeLog(fileName) {
  const lines = [];
  const say = (s) => {
    const line = typeof s === "string" ? s : JSON.stringify(s);
    console.log(line);
    lines.push(line);
  };
  const write = () => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const p = path.join(EVIDENCE_DIR, fileName);
    fs.writeFileSync(p, lines.join("\n") + "\n", "utf8");
    console.log(`EVIDENCE WRITTEN: ${p}`);
    return p;
  };
  return { say, lines, write };
}

export async function dismissDemoTour(page) {
  return page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => {
      const t = (b.textContent || "").trim();
      const title = b.getAttribute("title") || "";
      const aria = b.getAttribute("aria-label") || "";
      return (
        b.offsetParent !== null &&
        (/^Dismiss$/i.test(t) ||
          title.includes("Close Demo Tour") ||
          title.includes("Close Teleprompter") ||
          aria.includes("Close Demo Tour"))
      );
    });
    if (!btn) return false;
    btn.click();
    return true;
  });
}

export async function clickStage(page, label) {
  return page.evaluate((needle) => {
    const btns = [...document.querySelectorAll("button")];
    const btn = btns.find((b) => b.offsetParent !== null && (b.textContent || "").includes(needle));
    if (!btn) return { ok: false, available: btns.filter((b) => b.offsetParent !== null).map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 50) };
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return { ok: true, text: (btn.textContent || "").trim().slice(0, 100) };
  }, label);
}

export async function clickVisibleButton(page, text, opts = {}) {
  return page.evaluate(
    ({ needle, exact }) => {
      const btns = [...document.querySelectorAll("button")].filter((b) => b.offsetParent !== null);
      const match = btns.find((b) => {
        const t = (b.textContent || "").trim();
        return exact ? t === needle : t.includes(needle);
      });
      if (!match) return { ok: false, available: btns.map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 60) };
      match.scrollIntoView({ block: "center" });
      match.click();
      return { ok: true, text: (match.textContent || "").trim().slice(0, 120), disabled: match.disabled };
    },
    { needle: text, exact: !!opts.exact }
  );
}

export async function setFieldByLabel(page, labelPrefix, value) {
  return page.evaluate(
    ({ label, value }) => {
      const labels = [...document.querySelectorAll("label")].filter(
        (l) => l.offsetParent !== null && (l.textContent || "").trim().toLowerCase().startsWith(label.toLowerCase())
      );
      if (labels.length === 0) return { ok: false, reason: "label not found", want: label };
      const labelEl = labels[0];
      let ctl = labelEl.parentElement ? labelEl.parentElement.querySelector("input, textarea, select") : null;
      if (!ctl && labelEl.nextElementSibling && /^(INPUT|TEXTAREA|SELECT)$/.test(labelEl.nextElementSibling.tagName)) {
        ctl = labelEl.nextElementSibling;
      }
      if (!ctl) return { ok: false, reason: "control not found for label", want: label };
      const proto =
        ctl instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : ctl instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(ctl, String(value));
      ctl.dispatchEvent(new Event("input", { bubbles: true }));
      ctl.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, tag: ctl.tagName, type: ctl.type || null, value: ctl.value };
    },
    { label: labelPrefix, value }
  );
}

export async function setTextareaInVisibleModal(page, value) {
  return page.evaluate((val) => {
    const areas = [...document.querySelectorAll("textarea")].filter((t) => t.offsetParent !== null);
    if (areas.length === 0) return { ok: false, reason: "no visible textarea" };
    const el = areas[areas.length - 1];
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, length: el.value.length };
  }, value);
}

export async function selectOptionContains(page, selectIndex, optionNeedle) {
  return page.evaluate(
    ({ i, needle }) => {
      const selects = [...document.querySelectorAll("select")].filter((s) => s.offsetParent !== null);
      const sel = selects[i];
      if (!sel) return { ok: false, reason: "visible select not found", count: selects.length };
      const opt = [...sel.options].find((o) => o.textContent.includes(needle));
      if (!opt) return { ok: false, reason: "option not found", options: [...sel.options].map((o) => o.textContent.trim()) };
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(sel, opt.value);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: opt.value, text: opt.textContent.trim() };
    },
    { i: selectIndex, needle: optionNeedle }
  );
}

export async function getToast(page) {
  return page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find(
      (d) => typeof d.className === "string" && d.className.includes("fixed bottom-5 right-5")
    );
    return el ? el.textContent.trim() : null;
  });
}

export async function waitFor(page, fn, timeout = 30000, interval = 500) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    try {
      last = await page.evaluate(fn);
      if (last && typeof last === "object" && last.__evalError) last = null;
    } catch (e) {
      last = null;
    }
    if (last) return { ok: true, elapsedMs: Date.now() - t0, value: last };
    await delay(interval);
  }
  return { ok: false, elapsedMs: Date.now() - t0, value: last };
}

export async function readPackageCard(page, csiDivision) {
  return page.evaluate((csi) => {
    const cards = [...document.querySelectorAll("div")].filter(
      (d) => d.className && typeof d.className === "string" && d.className.includes("rounded-xl") && (d.textContent || "").includes(csi)
    );
    const card = cards.sort((a, b) => a.textContent.length - b.textContent.length)[0];
    if (!card) return null;
    return card.innerText.slice(0, 1200);
  }, csiDivision);
}

export async function readBidCard(page, subcontractorName) {
  return page.evaluate((name) => {
    const h3 = [...document.querySelectorAll("h3")].find((h) => h.offsetParent !== null && (h.textContent || "").includes(name));
    if (!h3) return null;
    let el = h3;
    for (let i = 0; i < 8 && el; i++) {
      el = el.parentElement;
      if (!el) break;
      if ((el.textContent || "").includes("True Leveled Cost") && (el.textContent || "").length < 4000) {
        return el.innerText;
      }
    }
    return h3.parentElement ? h3.parentElement.innerText : null;
  }, subcontractorName);
}

export async function listAuditEvents(page) {
  return page.evaluate(() => {
    const idx = document.body.innerText.indexOf("Activity Events (");
    const countMatch = document.body.innerText.match(/Activity Events \((\d+)\)/);
    const rows = [...document.querySelectorAll("div")].filter((d) => {
      const t = d.innerText || "";
      return t.length < 500 && /Event #|eventType|audit/i.test(t) && d.offsetParent !== null;
    });
    return { count: countMatch ? Number(countMatch[1]) : null, idx, sampleDivs: rows.slice(0, 5).map((r) => r.innerText.slice(0, 300)) };
  });
}