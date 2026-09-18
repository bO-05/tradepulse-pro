import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay } from "./lib.mjs";
import { findButton, findField, findHandles, realClick, typeInto, typeIntoField, selectProject, projectOptionState, clickTab, waitForText, dismissTour } from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const TITLE = "AUDIT-QA1-BIDS-2026-09-18";
const R = { at: new Date().toISOString() };

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await dismissTour(page);
    R.select = await selectProject(page, TITLE);
    await delay(2500);
    await dismissTour(page);
    await clickTab(page, "01:");
    await delay(1500);
    await dismissTour(page);
    const state = await projectOptionState(page);
    R.active = state;
    R.toastBefore = await page.evaluate(() => document.querySelector('[role="status"]')?.textContent || null);
    const cp = await findButton(page, "Create Trade Package");
    await realClick(page, cp);
    await waitForText(page, "Create CSI Trade Package", 8000);
    R.csi = await typeIntoField(page, "e.g. 26 00 00", "26 00 00");
    R.name = await typeIntoField(page, "e.g. Electrical & Lighting Systems", "AUDIT-QA1 Electrical");
    const budgetField = await findHandles(page, "input", (m) => m.value === "1250000" && m.visible, null);
    R.budgetFieldFound = budgetField.length;
    if (budgetField[0]) await typeInto(page, budgetField[0], "1000000");
    R.scope = await typeIntoField(page, "Scope details...", "QA1 electrical distribution scope.");
    const incl = await findHandles(page, "textarea", (m) => m.visible && m.value === "", null);
    R.emptyTextareas = incl.length;
    const dateField = (await findHandles(page, "input", (m) => /^\d{4}-\d{2}-\d{2}$/.test(m.value) && m.visible, null))[0];
    if (dateField) await typeInto(page, dateField, "12/31/2026");
    await delay(300);
    R.formValues = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return [...dlg.querySelectorAll("input,textarea")].map((el) => ({ tag: el.tagName, type: el.type, value: el.value, valid: el.checkValidity() }));
    });
    await shot(page, "fix4-qa1-debug-pkgform.png");
    const pkgBtn = await findButton(page, "Create Package");
    R.click = await realClick(page, pkgBtn);
    await delay(6000);
    R.toastAfter = await page.evaluate(() => document.querySelector('[role="status"]')?.textContent || null);
    R.modalStillOpen = await page.evaluate(() => !!document.querySelector('[aria-labelledby="create-package-title"]'));
    const projects = await http.query("projects:listProjects", {});
    const proj = projects.find((p) => p.title === TITLE);
    R.packages = proj ? await http.query("tradePackages:listByProject", { projectId: proj._id }) : null;
    R.consoleErrors = diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 300));
    R.pageErrors = diag.pageErrors.slice(0, 5);
    await shot(page, "fix4-qa1-debug-after-pkg.png");
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
  } finally {
    await browser.close();
    writeJson("fix4-qa1-debug-package.json", R);
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 8000));
};
run();