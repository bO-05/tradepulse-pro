import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1600, 1000);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(process.env.REM_BASE_URL || "https://brainy-skunk-440.convex.site", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(1000);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click());
  await delay(700);
  // Real typing into the title
  const titleSel = 'input[placeholder*="Innovation"]';
  await page.click(titleSel);
  await page.keyboard.type("   ");
  // real typing into budget
  await page.click('input[aria-label="Estimated budget in dollars"]');
  await page.keyboard.type("100");
  const vals = await page.evaluate((sel) => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => (x.textContent || "").includes("Create New Construction Project"));
    return { title: d.querySelector(sel).value, budget: d.querySelector('input[aria-label="Estimated budget in dollars"]').value };
  }, titleSel);
  // Real mouse click on submit
  const box = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => (x.textContent || "").includes("Create New Construction Project"));
    const b = [...d.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Create Commercial Project"));
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  await delay(1000);
  const after = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => (x.textContent || "").includes("Create New Construction Project"));
    return {
      dialogOpen: !!d,
      ps: d ? [...d.querySelectorAll("p")].map((p) => ({ cls: (p.className || "").toString().slice(0, 60), text: (p.textContent || "").trim() })) : null,
      bodyHasRequired: document.body.innerText.includes("required") || document.body.innerText.includes("must be"),
    };
  });
  console.log(JSON.stringify({ vals, box, after, pageErrors: diag.pageErrors, consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text).slice(0, 10) }, null, 1));
  await shot(page, "fix4-qa3-05-debug-realtype.png");
  await browser.close();
};
run().catch((e) => { console.error(e); process.exit(1); });