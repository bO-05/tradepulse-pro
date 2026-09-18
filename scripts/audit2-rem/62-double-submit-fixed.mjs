import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay, getSelectorState } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const FIXTURE = "AUDIT-ADV3-2026-09-18";
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const results = {};

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
    const before = await getSelectorState(page);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click(); });
    await delay(700);
    await page.evaluate((v) => {
      const dlg = document.querySelector('[role="dialog"]');
      const input = [...dlg.querySelectorAll("input")].find((i) => (i.placeholder || "").toLowerCase().includes("innovation")) || dlg.querySelector("input");
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      iset.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, FIXTURE);
    await delay(200);
    const state = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"));
      btn.click(); btn.click(); btn.click();
      return { disabledAfterFirstTick: btn.disabled };
    });
    results.clickState = state;
    await delay(6000);
    const after = await getSelectorState(page);
    results.doubleSubmit = {
      delta: after.options.length - before.options.length,
      fixtureInstances: after.options.filter((o) => o.text.includes(FIXTURE)).length,
    };
    await shot(page, "adv3-double-submit-fixed.png");

    // cleanup
    const projects = await http.query("projects:listProjects", {});
    const deleted = [];
    for (const p of projects) {
      if (p.title.startsWith("AUDIT-")) { await http.mutation("projects:deleteProject", { projectId: p._id }); deleted.push(p.title); }
    }
    const remaining = await http.query("projects:listProjects", {});
    results.cleanup = { deleted, remaining: remaining.map((p) => p.title) };
    results.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").length, pageErrors: diag.pageErrors.length };
    writeJson("fix-adversarial-double-submit.json", results);
  } catch (e) {
    results.error = String(e && e.stack ? e.stack : e);
    writeJson("fix-adversarial-double-submit.json", results);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 2));
};
run();