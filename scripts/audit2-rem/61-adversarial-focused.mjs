import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay, getSelectorState } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const FIXTURE = "AUDIT-ADV2-2026-09-18";
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const results = { startedAt: new Date().toISOString() };

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

    // ---------- double-submit with the ref guard
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
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"));
      btn.click(); btn.click(); btn.click();
    });
    await delay(5000);
    const after = await getSelectorState(page);
    const fixtureOptions = after.options.filter((o) => o.text.includes(FIXTURE));
    results.doubleSubmit = { delta: after.options.length - before.options.length, fixtureInstances: fixtureOptions.length };
    await shot(page, "adv2-double-submit.png");

    if (fixtureOptions.length === 0) throw new Error("fixture not created");
    await page.evaluate((val) => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      s.value = val; s.dispatchEvent(new Event("change", { bubbles: true }));
    }, fixtureOptions[0].value);
    await delay(1200);

    // ---------- zero-contractor dispatch: UI + backend truth
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("01:")); b?.click(); });
    await delay(900);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Create Trade Package")?.click(); });
    await delay(700);
    await page.evaluate(() => {
      const h = [...document.querySelectorAll("h3")].find((el) => (el.textContent || "").includes("Create CSI Trade Package"));
      let dlg = h;
      for (let i = 0; i < 6 && dlg && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("input")) break; }
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      for (const el of dlg.querySelectorAll("input,textarea")) {
        const label = (el.closest("div")?.querySelector("label")?.textContent || "").toLowerCase();
        if (label.includes("csi division")) { iset.call(el, "23 00 00"); el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (label.includes("trade package name")) { iset.call(el, "AUDIT-ADV2 Zero"); el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (label.includes("scope summary")) { tset.call(el, "Zero-recipient dispatch proof."); el.dispatchEvent(new Event("input", { bubbles: true })); }
      }
    });
    await delay(300);
    await page.evaluate(() => { const dlg = [...document.querySelectorAll('[role="dialog"]')].pop(); [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Create Package")?.click(); });
    await delay(2500);
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("AUDIT-ADV2 Zero") && (d.innerText || "").includes("Dispatch RFQs"));
      const card = cards[cards.length - 1];
      const btn = card ? [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Dispatch RFQs")) : null;
      if (btn) { btn.click(); btn.click(); }
    });
    await delay(2500);
    const uiToast = await page.evaluate(() => document.querySelector('[role="status"]')?.textContent || null);
    const cards = await page.evaluate(() => {
      const idx = document.body.innerText.indexOf("AUDIT-ADV2 Zero");
      return idx >= 0 ? document.body.innerText.slice(idx, idx + 220).replace(/\n+/g, " | ") : null;
    });
    await shot(page, "adv2-zero-dispatch.png");

    // backend truth
    const projects = await http.query("projects:listProjects", {});
    const fixture = projects.find((p) => p._id === fixtureOptions[0].value);
    const packages = await http.query("tradePackages:listByProject", { projectId: fixture._id });
    const zeroPkg = packages.find((p) => p.tradeName === "AUDIT-ADV2 Zero");
    const logs = await http.query("auditLogs:listRecentLogs", { projectId: fixture._id, limit: 30 });
    results.zeroDispatch = {
      uiToast,
      statusLine: cards,
      backendPackageStatus: zeroPkg?.status,
      rfqDispatchedEvents: logs.filter((l) => l.eventType === "rfq_dispatched").length,
      logTitles: logs.map((l) => l.title),
    };

    // ---------- cleanup all AUDIT fixtures on prod
    const remaining = await http.query("projects:listProjects", {});
    const deleted = [];
    for (const p of remaining) {
      if (p.title.startsWith("AUDIT-")) {
        await http.mutation("projects:deleteProject", { projectId: p._id });
        deleted.push(p.title);
      }
    }
    const finalList = await http.query("projects:listProjects", {});
    results.cleanup = { deleted, remaining: finalList.map((p) => p.title) };

    results.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 6), pageErrors: diag.pageErrors.slice(0, 4) };
    writeJson("fix-adversarial-focused.json", results);
  } catch (e) {
    results.error = String(e && e.stack ? e.stack : e);
    writeJson("fix-adversarial-focused.json", results);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 2).slice(0, 9000));
};
run();