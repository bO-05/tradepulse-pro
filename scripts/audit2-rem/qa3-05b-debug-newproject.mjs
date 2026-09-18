import { launchBrowser, waitForAppReady, selectProjectByTitle, shot, delay } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1600, 1000);
  const page = await browser.newPage();
  await page.goto(process.env.REM_BASE_URL || "https://brainy-skunk-440.convex.site", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, "AUDIT-QA3-fixture-2026-09-18");
  await delay(1200);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click());
  await delay(700);
  const info = await page.evaluate(() => {
    const dlgs = [...document.querySelectorAll('[role="dialog"]')];
    return dlgs.map((d, i) => ({
      i,
      title: (d.querySelector("h3")?.textContent || "").trim(),
      inputs: [...d.querySelectorAll("input,textarea")].map((x) => ({ tag: x.tagName, type: x.type, ph: x.placeholder, aria: x.getAttribute("aria-label"), val: x.value, required: x.required, pattern: x.getAttribute("pattern") })),
      buttons: [...d.querySelectorAll("button")].map((b) => (b.textContent || "").trim()),
    }));
  });
  console.log(JSON.stringify(info, null, 1));
  const filled = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => (x.textContent || "").includes("Create New Construction Project"));
    const set = (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value;
    };
    const title = d.querySelector('input[placeholder*="Innovation"]');
    const budget = d.querySelector('input[aria-label="Estimated budget in dollars"]');
    const weeks = d.querySelector('input[aria-label="Target completion duration in weeks"]');
    const out = { title: set(title, "   "), budget: set(budget, "100"), weeks: set(weeks, "52") };
    return out;
  });
  console.log("filled", JSON.stringify(filled));
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => (x.textContent || "").includes("Create New Construction Project"));
    const b = [...d.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Create Commercial Project"));
    window.__qa3clicked = { disabled: b.disabled, form: !!b.form };
    b.click();
  });
  await delay(900);
  // second attempt with requestSubmit if first produced nothing
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => (x.textContent || "").includes("Create New Construction Project"));
    const f = d.querySelector("form");
    window.__qa3submit = !!f;
    if (f) f.requestSubmit();
  });
  await delay(900);
  const after = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => (x.textContent || "").includes("Create New Construction Project"));
    return {
      dialogOpen: !!d,
      clicked: window.__qa3clicked,
      submit: window.__qa3submit,
      inputVals: d ? [...d.querySelectorAll("input,textarea")].map((x) => x.value) : null,
      ps: d ? [...d.querySelectorAll("p")].map((p) => ({ cls: (p.className || "").toString().slice(0, 60), text: (p.textContent || "").trim() })) : null,
      tail: d ? (d.innerText || "").slice(-400) : null,
    };
  });
  console.log(JSON.stringify(after, null, 1));
  await shot(page, "fix4-qa3-05-debug-newproject.png");
  await browser.close();
};
run().catch((e) => { console.error(e); process.exit(1); });