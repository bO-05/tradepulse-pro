import { launchBrowser, waitForAppReady, delay, shot } from "./lib.mjs";
import { writeEvidence, writeLog } from "./qa26-lib.mjs";

const BASE = "https://brainy-skunk-440.convex.site";

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const log = [];
  const say = (s) => { log.push(s); console.log(s); };
  try {
    await page.goto(`${BASE}/?qa26=debugnp`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(800);
    const open = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /New Project/.test(x.innerText || ""));
      b?.click();
      return Boolean(b);
    });
    await delay(900);
    const dlg = await page.evaluate(() => {
      const ds = [...document.querySelectorAll('[role="dialog"]')].filter((x) => x.getBoundingClientRect().width > 1);
      const d = ds[ds.length - 1];
      if (!d) return null;
      return {
        title: (d.querySelector("h2,h3") || {}).innerText,
        inputs: [...d.querySelectorAll("input,textarea,select")].map((x) => ({ tag: x.tagName, aria: x.getAttribute("aria-label"), ph: x.getAttribute("placeholder"), type: x.getAttribute("type"), req: x.required })),
        buttons: [...d.querySelectorAll("button")].map((b) => (b.innerText || "").trim()),
        text: (d.innerText || "").slice(0, 500),
      };
    });
    say(`dialog=${JSON.stringify(dlg)}`);
    // try filling and creating
    const fill = async (sel, val) => {
      const r = await page.evaluate(({ sel, val }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, { sel, val });
      if (!r) say(`fill missing: ${sel}`);
      return r;
    };
    await fill('input[aria-label="Project title"]', "AUDIT-QA26-JOURNEY");
    await fill('input[aria-label="Project location"]', "Honolulu, HI");
    await fill('input[aria-label="Project type"]', "Healthcare / Mixed-Use");
    await fill('input[aria-label="General contractor or contracting entity"]', "QA26 Journey GC, LLC");
    await fill('input[aria-label="Estimated budget in dollars"]', "900000");
    await fill('input[aria-label="Target completion duration in weeks"]', "52");
    const clickCreate = await page.evaluate(() => {
      const ds = [...document.querySelectorAll('[role="dialog"]')].filter((x) => x.getBoundingClientRect().width > 1);
      const d = ds[ds.length - 1];
      const b = d && [...d.querySelectorAll("button")].find((x) => /Create Commercial Project/.test(x.innerText || ""));
      if (!b) return { ok: false, buttons: d ? [...d.querySelectorAll("button")].map((x) => (x.innerText || "").trim()) : null };
      b.click();
      return { ok: true, disabled: b.disabled };
    });
    await delay(4000);
    const after = await page.evaluate(() => {
      const ds = [...document.querySelectorAll('[role="dialog"]')].filter((x) => x.getBoundingClientRect().width > 1);
      const d = ds[ds.length - 1];
      return {
        dialogOpen: Boolean(d),
        alert: d ? (d.querySelector('[role="alert"]')?.innerText || null) : null,
        text: d ? (d.innerText || "").slice(0, 400) : null,
      };
    });
    await shot(page, "fix4-qa26-debug-newproject.png");
    say(`clickCreate=${JSON.stringify(clickCreate)} after=${JSON.stringify(after)}`);
    writeEvidence("debug-newproject", { dlg, clickCreate, after, fillOk: true });
    writeLog("debug-newproject", log);
  } catch (e) {
    writeLog("debug-newproject-crash", [String(e?.stack ?? e)]);
    console.error(e);
  } finally {
    await browser.close();
  }
}

main();