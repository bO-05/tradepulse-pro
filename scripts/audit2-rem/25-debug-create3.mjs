import { launchBrowser, waitForAppReady, delay } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 300)));
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  try {
    await page.goto(process.env.REM_BASE_URL || "http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click(); });
    await delay(800);
    const setup = await page.evaluate(() => {
      window.__dbg = [];
      const dlg = document.querySelector('[role="dialog"]');
      const inputs = [...dlg.querySelectorAll("input")];
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      iset.call(inputs[0], "AUDIT-DEBUG3-2026-09-17");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      const form = inputs[0].closest("form");
      form.addEventListener("submit", () => window.__dbg.push("native submit fired"), true);
      form.addEventListener("invalid", (e) => window.__dbg.push("invalid: " + (e.target.name || e.target.type)), true);
      return { forms: document.querySelectorAll("form").length, formOuterStart: form.outerHTML.slice(0, 120), portalRoot: dlg.parentElement?.parentElement?.tagName };
    });
    console.log("SETUP", JSON.stringify(setup));
    await delay(400);
    const clicked = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"));
      const valid = btn.form ? btn.form.checkValidity() : null;
      btn.click();
      return { valid, disabledAfter: btn.disabled };
    });
    console.log("CLICKED", JSON.stringify(clicked));
    await delay(800);
    const mid = await page.evaluate(() => ({ dbg: window.__dbg, dialogOpen: !!document.querySelector('[role="dialog"]'), dialogText: document.querySelector('[role="dialog"]')?.innerText.slice(-300) }));
    console.log("MID", JSON.stringify(mid, null, 2));
    await delay(6000);
    const end = await page.evaluate(() => ({ dbg: window.__dbg, dialogOpen: !!document.querySelector('[role="dialog"]'), toast: document.querySelector('[role="status"]')?.textContent || null }));
    console.log("END", JSON.stringify(end, null, 2));
  } finally {
    await browser.close();
  }
};
run();