import { launchBrowser, waitForAppReady, delay, getSelectorState } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 200)));
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  try {
    await page.goto(process.env.REM_BASE_URL || "http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click(); });
    await delay(800);
    const info = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const inputs = [...dlg.querySelectorAll("input")];
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      iset.call(inputs[0], "AUDIT-DEBUG2-2026-09-17");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"));
      return { hasForm: !!btn.form, buttonType: btn.type, formId: btn.form?.id || null };
    });
    console.log("INFO", JSON.stringify(info));
    await delay(400);
    const viaRequestSubmit = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"));
      if (!btn.form) return { ok: false };
      btn.form.requestSubmit();
      return { ok: true };
    });
    console.log("REQSUBMIT", JSON.stringify(viaRequestSubmit));
    await delay(5000);
    const after = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return { dialogOpen: !!dlg, dlgText: dlg ? dlg.innerText.slice(-400) : null, toast: document.querySelector('[role="status"]')?.textContent || null };
    });
    console.log("AFTER", JSON.stringify(after, null, 2));
    const sel = await getSelectorState(page);
    console.log("OPTIONS", JSON.stringify(sel?.options));
  } finally {
    await browser.close();
  }
};
run();