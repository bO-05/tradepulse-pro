import { launchBrowser, waitForAppReady, delay, getSelectorState } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  try {
    await page.goto(process.env.REM_BASE_URL || "http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1500);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(400);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click(); });
    await delay(800);
    const before = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const inputs = [...dlg.querySelectorAll("input")];
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      iset.call(inputs[0], "AUDIT-DEBUG-2026-09-17");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      return { inputs: inputs.map((i) => ({ type: i.type, value: i.value, required: i.required })), submitText: [...dlg.querySelectorAll("button")].map((b) => b.textContent.trim()) };
    });
    console.log("BEFORE", JSON.stringify(before, null, 2));
    await delay(400);
    const clicked = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"));
      btn.click();
      return { disabled: btn.disabled };
    });
    await delay(5000);
    const after = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return {
        dialogOpen: !!dlg,
        errorText: dlg ? (dlg.innerText.match(/[^\n]*(?:required|must be|could not|failed|error)[^\n]*/i) || [])[0] || null : null,
        toast: document.querySelector('[role="status"]')?.textContent || null,
        bodySnippet: document.body.innerText.slice(0, 200),
      };
    });
    console.log("AFTER", JSON.stringify(after, null, 2));
    const sel = await getSelectorState(page);
    console.log("OPTIONS", JSON.stringify(sel?.options, null, 2));
  } finally {
    await browser.close();
  }
};
run();