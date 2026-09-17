import { launchBrowser, waitForAppReady, delay } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  try {
    await page.goto(process.env.REM_BASE_URL || "http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1500);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click(); });
    await delay(800);
    const info = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return [...dlg.querySelectorAll("input")].map((i) => ({
        type: i.type,
        value: i.value,
        min: i.min,
        max: i.max,
        step: i.step,
        valid: i.checkValidity(),
        msg: i.validationMessage,
        validity: {
          badInput: i.validity.badInput,
          rangeUnderflow: i.validity.rangeUnderflow,
          rangeOverflow: i.validity.rangeOverflow,
          stepMismatch: i.validity.stepMismatch,
          valueMissing: i.validity.valueMissing,
          typeMismatch: i.validity.typeMismatch,
        },
      }));
    });
    console.log(JSON.stringify(info, null, 2));
  } finally {
    await browser.close();
  }
};
run();