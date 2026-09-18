import { delay } from "./lib.mjs";

export { delay };

export async function findHandles(page, selector, matcher, arg) {
  const handles = await page.$$(selector);
  const out = [];
  for (const h of handles) {
    let meta;
    try {
      meta = await h.evaluate((el) => ({
        text: (el.textContent || "").trim(),
        title: el.getAttribute("title") || "",
        aria: el.getAttribute("aria-label") || "",
        ph: el.placeholder || "",
        value: el.value !== undefined ? String(el.value) : "",
        disabled: !!el.disabled,
        visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      }));
    } catch {
      continue;
    }
    if (matcher(meta, arg)) out.push({ handle: h, meta });
    else await h.dispose();
  }
  return out;
}

export async function findButton(page, text, opts = {}) {
  const matches = await findHandles(page, "button", (m, a) => {
    const hay = [m.text, m.title, m.aria].join(" | ");
    return a.exact ? m.text === a.text : hay.includes(a.text);
  }, { text, exact: !!opts.exact });
  const idx = opts.nth === undefined ? 0 : opts.nth;
  return matches[idx] || null;
}

export async function findField(page, hint, opts = {}) {
  const scope = opts.scope || "input,textarea,select";
  const matches = await findHandles(page, scope, (m, a) => {
    const hay = [m.ph, m.aria, m.title].join(" | ").toLowerCase();
    const want = a.hint.toLowerCase();
    if (a.exact) return m.ph.toLowerCase() === want || m.aria.toLowerCase() === want;
    return hay.includes(want);
  }, { hint: hint, exact: !!opts.exact });
  const idx = opts.nth === undefined ? 0 : opts.nth;
  return matches[idx] || null;
}

export async function centerOf(page, entry) {
  await entry.handle.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
  await delay(120);
  const box = await entry.handle.boundingBox();
  if (!box || box.width === 0 || box.height === 0) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box, meta: entry.meta };
}

export async function realClick(page, entry) {
  const c = await centerOf(page, entry);
  if (!c) return { ok: false, reason: "no box", meta: entry.meta };
  await page.mouse.click(c.x, c.y);
  return { ok: true, meta: c.meta, box: c.box };
}

export async function realClickText(page, text, opts = {}) {
  const entry = await findButton(page, text, opts);
  if (!entry) return { ok: false, reason: "button not found", text };
  return { ...(await realClick(page, entry)), text };
}

export async function realClickInCard(page, cardContains, buttonText) {
  const handles = await page.$$("button");
  for (const h of handles) {
    let isMatch = false;
    try {
      isMatch = await h.evaluate((el, args) => {
        const [ct, bt] = args;
        const t = (el.textContent || "").trim();
        if (!t.includes(bt)) return false;
        let p = el.parentElement;
        for (let i = 0; i < 8 && p; i++) {
          const it = p.innerText || "";
          if (it.includes(ct) && it.length < 3000) return true;
          if (p.tagName === "MAIN" || p.tagName === "BODY") break;
          p = p.parentElement;
        }
        return false;
      }, [cardContains, buttonText]);
    } catch { /* detached */ }
    if (isMatch) return { ...(await realClick(page, { handle: h, meta: { text: buttonText } })), cardContains, buttonText };
    await h.dispose();
  }
  return { ok: false, reason: "card button not found", cardContains, buttonText };
}

export async function clickConfirm(page, label) {
  const entries = await findHandles(page, "button", (m, a) => m.text === a, label);
  if (!entries[0]) return { ok: false, reason: "confirm button not found", label };
  return realClick(page, entries[0]);
}

export async function getToast(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[role="status"]');
    return el ? el.textContent.trim() : null;
  });
}

export async function realClickSelector(page, selector, opts = {}) {
  const entries = await findHandles(page, selector, () => true, null);
  const idx = opts.nth === undefined ? 0 : opts.nth;
  if (!entries[idx]) return { ok: false, reason: "selector not found", selector };
  return { ...(await realClick(page, entries[idx])), selector };
}

export async function typeInto(page, entry, text, opts = {}) {
  const c = await centerOf(page, entry);
  if (!c) return { ok: false, reason: "no box", meta: entry.meta };
  await page.mouse.click(c.x, c.y);
  await delay(80);
  if (opts.clear !== false) {
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
  }
  if (text) await page.keyboard.type(String(text), { delay: opts.delay ?? 4 });
  return { ok: true, meta: entry.meta, typed: text };
}

export async function typeIntoField(page, hint, text, opts = {}) {
  const entry = await findField(page, hint, opts);
  if (!entry) return { ok: false, reason: "field not found", hint };
  return { ...(await typeInto(page, entry, text, opts)), hint };
}

export async function selectByValue(page, selector, predicate, arg) {
  const entries = await findHandles(page, selector, () => true, null);
  for (const e of entries) {
    if (predicate(e.meta, arg)) {
      await e.handle.select(e.meta.value);
      await delay(200);
      return { ok: true, meta: e.meta };
    }
  }
  return { ok: false, reason: "select option not found", selector, arg };
}

export async function selectProject(page, titleSubstring) {
  return page.evaluate((needle) => {
    const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    if (!sel) return { ok: false, reason: "selector not found" };
    const opt = [...sel.options].find((o) => o.textContent.includes(needle));
    if (!opt) return { ok: false, reason: "option not found", options: [...sel.options].map((o) => o.textContent.trim()) };
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: opt.value, text: opt.textContent.trim() };
  }, titleSubstring);
}

export async function projectOptionState(page) {
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

export async function clickTab(page, stepPrefix) {
  const entries = await findHandles(page, "button", (m, a) => m.title.startsWith(a), stepPrefix);
  if (entries[0]) return realClick(page, entries[0]);
  return { ok: false, reason: "tab not found", stepPrefix };
}

export async function waitForTextGone(page, text, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const present = await page.evaluate((t) => document.body.innerText.includes(t), text);
    if (!present) return true;
    await delay(600);
  }
  return false;
}

export async function waitForText(page, text, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const present = await page.evaluate((t) => document.body.innerText.includes(t), text);
    if (present) return true;
    await delay(500);
  }
  return false;
}

export async function dismissTour(page) {
  for (const t of ["Dismiss", "Close Demo Tour"]) {
    const e = await findButton(page, t);
    if (e) {
      await realClick(page, e);
      await delay(300);
      return true;
    }
  }
  return false;
}

export async function openNewProjectModal(page) {
  const e = await findButton(page, "New Project", { exact: true });
  if (!e) return { ok: false, reason: "New Project button not found" };
  await realClick(page, e);
  await waitForText(page, "Create New Construction Project", 10000);
  await delay(300);
  return { ok: true };
}

export function createFixtureName(purpose) {
  return `AUDIT-QA1-${purpose}-2026-09-18`;
}