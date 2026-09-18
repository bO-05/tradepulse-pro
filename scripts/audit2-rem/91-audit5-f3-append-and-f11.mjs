import { setTimeout as delay } from "node:timers/promises";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const R = { startedAt: new Date().toISOString() };
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const FIXTURE = "AUDIT-5-APPEND-BEFORE-2026-09-18";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  const closeTour = async () => {
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
  };
  const realClick = async (t) => {
    const b = await page.evaluate((needle) => {
      const el = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim().includes(needle));
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (el.textContent || "").trim() };
    }, t);
    if (!b) return { ok: false };
    await page.mouse.click(b.x, b.y);
    return { ok: true, ...b };
  };
  const fieldBox = async (frag) => page.evaluate((f) => {
    const dlg = document.querySelector('[role="dialog"]');
    const el = [...dlg.querySelectorAll("input,textarea")].find((x) => ((x.closest("div")?.querySelector("label")?.textContent || "") + (x.getAttribute("placeholder") || "")).includes(f));
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, frag);
  const appendTo = async (frag, text) => {
    const box = await fieldBox(frag);
    await page.mouse.click(box.x, box.y);
    await page.keyboard.press("End");
    await page.keyboard.type(text, { delay: 10 });
  };
  const readFields = () => page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const out = {};
    [...dlg.querySelectorAll("input,textarea")].forEach((el) => {
      const label = (el.closest("div")?.querySelector("label")?.textContent || "").trim();
      out[label || "?"] = el.value;
    });
    return out;
  });

  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1000);
    await closeTour();

    // ---------- F3 append-and-submit
    R.f3 = {};
    await realClick("New Project");
    await delay(700);
    const titleBox = await fieldBox("Project Title");
    await page.mouse.click(titleBox.x, titleBox.y);
    await page.keyboard.type(FIXTURE, { delay: 8 });
    await appendTo("Location", "Dallas, TX");
    await appendTo("Project Type", "Data Center");
    await appendTo("General Contractor", "ACME Builders");
    await appendTo("Estimated Budget", "14200000");
    R.f3.append = { fields: await readFields() };
    await shot(page, "fix4-before-F3-append-submit.png");
    await realClick("Create Commercial Project");
    await delay(3500);
    R.f3.submitResult = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return { created: true };
      const budgetInput = [...dlg.querySelectorAll("input")].find((x) => x.getAttribute("type") === "number");
      return { created: false, validationMessage: budgetInput?.validationMessage || null, invalid: budgetInput?.checkValidity?.() };
    });
    const projects0 = await http.query("projects:listProjects", {});
    const created0 = projects0.find((p) => p.title.includes(FIXTURE));
    R.f3.createdWithAppendedBudget = created0 ? { title: created0.title, location: created0.location, type: created0.projectType, gc: created0.generalContractorName, budget: created0.estBudget } : null;
    if (!created0) {
      // recover budget only, keep appended text fields, submit again
      const b = await fieldBox("Estimated Budget");
      await page.mouse.click(b.x, b.y);
      await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
      await page.keyboard.type("14200000", { delay: 8 });
      R.f3.recoveredBudget = (await readFields())["Estimated Budget ($)"];
      await realClick("Create Commercial Project");
      await delay(5000);
      const projects = await http.query("projects:listProjects", {});
      const created = projects.find((p) => p.title.includes(FIXTURE));
      R.f3.createdAfterRecovery = created ? { title: created.title, location: created.location, type: created.projectType, gc: created.generalContractorName, budget: created.estBudget } : null;
      R.f3.projectId = created?._id;
      await shot(page, "fix4-before-F3-created.png");
    }

    // ---------- F11 inventory: all tabs, all trade-selector-ish controls
    const tabs = ["01:", "02:", "03:", "04:", "05:", "06:", "07:"];
    const inventory = {};
    for (const prefix of tabs) {
      await page.evaluate((p) => { const b = [...document.querySelectorAll("button,select")].find((x) => (x.getAttribute("title") || "").startsWith(p) || (x.textContent || "").includes(p === "07:" ? "Live Activity Audit" : "zzz")); b?.click(); }, prefix);
      await delay(900);
      inventory[prefix] = await page.evaluate(() => {
        const rows = [];
        [...document.querySelectorAll("main button, main select, main [role='tab']")].forEach((el) => {
          const t = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 110);
          const aria = el.getAttribute?.("aria-label") || "";
          if (/Select Trade/i.test(t) || /\b\d{2} 00 00\b/.test(t) || /trade package/i.test(aria) || /Div\s?\d{2}/i.test(t)) {
            rows.push({ tag: el.tagName, text: t, aria });
          }
        });
        const headings = [...document.querySelectorAll("main h3, main h4")].map((h) => (h.textContent || "").trim()).filter((t) => /package|trade/i.test(t));
        return { rows, headings };
      });
    }
    R.f11 = inventory;

    // ---------- §4.10 LD copy (expand Why GCs Care on leveling)
    await page.evaluate(() => { const b = [...document.querySelectorAll("button,select")].find((x) => (x.getAttribute("title") || "").startsWith("04:")); b?.click(); });
    await delay(900);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Why GCs Care")); b?.click(); });
    await delay(500);
    R.s4_ld = await page.evaluate(() => {
      const t = document.body.innerText;
      const i = t.indexOf("schedule-impact rate");
      return i >= 0 ? t.slice(Math.max(0, i - 120), i + 180) : null;
    });

    R.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").length, pageErrors: diag.pageErrors.length };
    writeJson("fix4-before-f3-f11.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-before-f3-f11.json", R);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 18000));
};
run();