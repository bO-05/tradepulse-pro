import { setTimeout as delay } from "node:timers/promises";
import { launchBrowser, waitForAppReady, shot, writeJson } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const R = { startedAt: new Date().toISOString() };
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const FIXTURE = `AUDIT-5-F3-AFTER-${Date.now().toString().slice(-6)}`;

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const closeTour = async () => {
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
  };
  const fieldBox = async (frag) => page.evaluate((f) => {
    const dlg = document.querySelector('[role="dialog"]');
    const el = [...dlg.querySelectorAll("input,textarea")].find((x) => ((x.closest("div")?.querySelector("label")?.textContent || "") + (x.getAttribute("placeholder") || "") + (x.getAttribute("aria-label") || "")).includes(f));
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, frag);
  const typeInto = async (frag, text) => {
    const b = await fieldBox(frag);
    if (!b) throw new Error("field not found: " + frag);
    await page.mouse.click(b.x, b.y);
    await page.keyboard.type(text, { delay: 8 });
  };
  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await closeTour();
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "New Project"); b?.click(); });
    await delay(700);

    R.initial = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return [...dlg.querySelectorAll("input,textarea")].map((el) => ({
        label: (el.closest("div")?.querySelector("label")?.textContent || "").trim(),
        value: el.value,
        placeholder: el.getAttribute("placeholder"),
      }));
    });

    await typeInto("Project Title", FIXTURE);
    await typeInto("Location", "Tampa, FL");
    await typeInto("Project Type", "Healthcare / Surgical");
    await typeInto("General Contractor", "AUDIT GC LLC");
    await typeInto("Estimated Budget", "14200000");
    await typeInto("Duration", "78");
    R.typed = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const out = {};
      [...dlg.querySelectorAll("input,textarea")].forEach((el) => {
        const label = (el.closest("div")?.querySelector("label")?.textContent || "").trim();
        out[label || "?"] = el.value;
      });
      return out;
    });
    await shot(page, "fix4-after-F3-typed-no-clearing.png");
    await page.evaluate(() => { const dlg = document.querySelector('[role="dialog"]'); [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"))?.click(); });
    let created = null;
    for (let i = 0; i < 20; i++) {
      await delay(700);
      const projects = await http.query("projects:listProjects", {});
      created = projects.find((p) => p.title === FIXTURE);
      if (created) break;
    }
    R.saved = created ? { title: created.title, location: created.location, projectType: created.projectType, gc: created.generalContractorName, budget: created.estBudget, weeks: created.targetCompletionWeeks } : null;
    R.matchesTyped =
      created &&
      created.location === "Tampa, FL" &&
      created.projectType === "Healthcare / Surgical" &&
      created.generalContractorName === "AUDIT GC LLC" &&
      created.estBudget === 14200000 &&
      created.targetCompletionWeeks === 78;
    await shot(page, "fix4-after-F3-created.png");

    // Oversized budget shows a visible app-level message
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "New Project"); b?.click(); });
    await delay(700);
    await typeInto("Project Title", "AUDIT-5-OVERSIZE");
    await typeInto("Location", "Austin, TX");
    await typeInto("Project Type", "Mixed-Use");
    await typeInto("General Contractor", "Audit GC");
    await typeInto("Estimated Budget", "550000014200000");
    await typeInto("Duration", "52");
    await page.evaluate(() => { const dlg = document.querySelector('[role="dialog"]'); [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"))?.click(); });
    await delay(700);
    R.oversize = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return {
        stillOpen: !!dlg,
        errorVisible: (dlg?.innerText || "").includes("extra digit"),
        errorText: (dlg?.innerText || "").match(/Estimated budget[^\n]*/)?.[0] || null,
      };
    });
    await shot(page, "fix4-after-F3-oversize-error.png");
    await page.keyboard.press("Escape");
    await delay(400);

    R.fixtureTitle = FIXTURE;
    writeJson("fix4-after-f3.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-after-f3.json", R);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 9000));
};
run();