import fs from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  EVIDENCE_DIR,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  getSelectorState,
  selectProjectByTitle,
  bodyText,
  clickButtonByText,
  setInputValue,
  writeLog,
  summarizeDiagnostics,
  delay,
} from "./qa1-lib.mjs";

export {
  BASE_URL,
  EVIDENCE_DIR,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  getSelectorState,
  selectProjectByTitle,
  bodyText,
  clickButtonByText,
  setInputValue,
  writeLog,
  summarizeDiagnostics,
  delay,
};

export const NEW_PROJECT_DIALOG = '[role="dialog"][aria-labelledby="new-project-title"]';

export async function evaluateText(page, fn, ...args) {
  return page.evaluate(fn, ...args);
}

export async function waitForBodyText(page, needles, timeout = 30000, interval = 200) {
  const list = Array.isArray(needles) ? needles : [needles];
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeout) {
    last = await bodyText(page);
    const hit = list.find((n) => last.includes(n));
    if (hit) return { hit, elapsedMs: Date.now() - start };
    await delay(interval);
  }
  return { hit: null, elapsedMs: Date.now() - start, lastTextLength: last.length };
}

export async function clickTab(page, needle) {
  return page.evaluate((n) => {
    const btns = [...document.querySelectorAll("button")];
    const match = btns.find((b) => (b.textContent || "").replace(/\s+/g, " ").includes(n));
    if (!match) {
      return {
        ok: false,
        reason: "tab button not found",
        available: btns.map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 80),
      };
    }
    match.scrollIntoView({ block: "center" });
    match.click();
    return { ok: true, text: (match.textContent || "").trim() };
  }, needle);
}

export async function openNewProjectModal(page) {
  const res = await clickButtonByText(page, "New Project", { exact: true });
  if (!res.ok) return res;
  await page.waitForSelector(NEW_PROJECT_DIALOG, { timeout: 10000 });
  return res;
}

export async function fillNewProjectForm(page, values) {
  return page.evaluate(
    (dialogSel, vals) => {
      const dlg = document.querySelector(dialogSel);
      if (!dlg) return { ok: false, reason: "dialog missing" };
      const proto = HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      const inputs = [...dlg.querySelectorAll("input")];
      const setAt = (i, v) => {
        if (!inputs[i]) return;
        setter.call(inputs[i], v);
        inputs[i].dispatchEvent(new Event("input", { bubbles: true }));
        inputs[i].dispatchEvent(new Event("change", { bubbles: true }));
      };
      setAt(0, vals.title ?? "");
      setAt(1, vals.location ?? "Austin, TX");
      setAt(2, vals.projectType ?? "QA Commercial");
      setAt(3, vals.generalContractor ?? "QA GC, LP");
      setAt(4, String(vals.budget ?? 1000000));
      setAt(5, String(vals.weeks ?? 26));
      const ta = dlg.querySelector("textarea");
      if (ta && vals.spec) {
        const taProto = HTMLTextAreaElement.prototype;
        const taSetter = Object.getOwnPropertyDescriptor(taProto, "value").set;
        taSetter.call(ta, vals.spec);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return {
        ok: true,
        values: inputs.map((i) => i.value),
        spec: ta ? ta.value.slice(0, 40) : null,
      };
    },
    NEW_PROJECT_DIALOG,
    values
  );
}

export async function submitNewProjectForm(page) {
  return page.evaluate((dialogSel) => {
    const dlg = document.querySelector(dialogSel);
    if (!dlg) return { ok: false, reason: "dialog missing" };
    const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"));
    if (!btn) return { ok: false, reason: "submit button missing" };
    btn.click();
    return { ok: true, disabled: btn.disabled };
  }, NEW_PROJECT_DIALOG);
}

export async function readNewProjectError(page) {
  return page.evaluate((dialogSel) => {
    const dlg = document.querySelector(dialogSel);
    if (!dlg) return null;
    const p = dlg.querySelector("p.text-rose-400");
    return p ? p.textContent.trim() : null;
  }, NEW_PROJECT_DIALOG);
}

export async function isNewProjectModalOpen(page) {
  return page.evaluate((dialogSel) => Boolean(document.querySelector(dialogSel)), NEW_PROJECT_DIALOG);
}

export async function getToastText(page) {
  return page.evaluate(() => {
    const candidates = [...document.querySelectorAll("div")].filter((d) =>
      /created successfully|delete|Error creating|successfully/i.test(d.textContent || "")
    );
    const el = candidates[candidates.length - 1];
    return el ? el.textContent.trim().slice(0, 300) : null;
  });
}

export async function createProjectViaUI(page, { title, budget = 2500000, weeks = 26, spec }) {
  const opened = await openNewProjectModal(page);
  if (!opened.ok) throw new Error("could not open New Project modal: " + JSON.stringify(opened));
  const filled = await fillNewProjectForm(page, {
    title,
    budget,
    weeks,
    spec: spec || `QA project scope for ${title}. Electrical, HVAC, Plumbing CSI divisions.`,
  });
  if (!filled.ok) throw new Error("could not fill modal: " + JSON.stringify(filled));
  await delay(150);
  const submitted = await submitNewProjectForm(page);
  if (!submitted.ok) throw new Error("could not submit modal: " + JSON.stringify(submitted));
  const waited = await waitForBodyText(page, ["created successfully in Convex", "Error creating project"], 20000);
  const toast = await getToastText(page);
  const modalOpen = await isNewProjectModalOpen(page);
  return { filled, submitted, waited, toast, modalOpen };
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(name, obj) {
  ensureDir(EVIDENCE_DIR);
  const p = path.join(EVIDENCE_DIR, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
  return p;
}

export function fixtureTxt(name, content) {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "fixtures");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, "utf8");
  return p;
}