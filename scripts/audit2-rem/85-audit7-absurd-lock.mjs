import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay, getSelectorState } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const EV = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/evidence";
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const FIXTURE = "AUDIT-7-2026-09-18";
const R = { startedAt: new Date().toISOString(), fixture: FIXTURE };

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

    // fixture + package
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click(); });
    await delay(600);
    await page.evaluate((v) => { const dlg = document.querySelector('[role="dialog"]'); const input = [...dlg.querySelectorAll("input")].find((i) => (i.placeholder || "").toLowerCase().includes("innovation")) || dlg.querySelector("input"); const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; iset.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); }, FIXTURE);
    await delay(200);
    await page.evaluate(() => { const dlg = document.querySelector('[role="dialog"]'); [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"))?.click(); });
    await delay(5000);
    const sel = await getSelectorState(page);
    const fixture = sel.options.find((o) => o.text.includes(FIXTURE));
    R.fixtureId = fixture.value;
    await page.evaluate((v) => { const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]'); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); }, fixture.value);
    await delay(1500);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Create Trade Package")?.click(); });
    await delay(700);
    await page.evaluate(() => {
      const h = [...document.querySelectorAll("h3")].find((el) => (el.textContent || "").includes("Create CSI Trade Package"));
      let dlg = h; for (let i = 0; i < 6 && dlg && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("input")) break; }
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      for (const el of dlg.querySelectorAll("input,textarea")) {
        const label = (el.closest("div")?.querySelector("label")?.textContent || "").toLowerCase();
        if (label.includes("csi division")) { iset.call(el, "26 00 00"); el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (label.includes("trade package name")) { iset.call(el, "AUDIT-7 Electrical"); el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (label.includes("scope summary")) { tset.call(el, "Absurd bid test."); el.dispatchEvent(new Event("input", { bubbles: true })); }
      }
    });
    await delay(300);
    await page.evaluate(() => { const dlg = [...document.querySelectorAll('[role="dialog"]')].pop(); [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Create Package")?.click(); });
    await delay(3000);
    const pkgs = await http.query("tradePackages:listByProject", { projectId: fixture.value });
    const pkg = pkgs[0];
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:")); b?.click(); });
    await delay(900);

    // absurd bid only
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Ingest Quote / PDF")?.click(); });
    await delay(1200);
    await page.evaluate(() => {
      const submit = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Extract & Level Bid"));
      let dlg = submit; for (let i = 0; i < 8 && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("textarea")) break; }
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      for (const el of dlg.querySelectorAll("input")) {
        const ph = (el.placeholder || "").toLowerCase();
        if (ph.includes("company name")) { iset.call(el, "AUDIT-7 Absurd"); el.dispatchEvent(new Event("input", { bubbles: true })); }
      }
      const ta = dlg.querySelector("textarea");
      tset.call(ta, "PROPOSAL AND QUOTATION\nSubcontractor: AUDIT-7 Absurd\nDivision 26 Electrical\nBase Bid Price: $250,000.00\nEverything included. Lead time: 8 weeks. Insurance: fully compliant.");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await delay(300);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Extract & Level Bid"))?.click(); });
    // poll BACKEND, not DOM
    let backend = [];
    for (let i = 0; i < 75; i++) { await delay(1000); backend = await http.query("bids:listByPackage", { tradePackageId: pkg._id }); if (backend.length > 0) break; }
    R.absurdBid = { stored: backend[0] ? { name: backend[0].subcontractorName, base: backend[0].baseBidAmount, leveled: backend[0].leveledTotalCost } : null };
    R.absurdUi = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        rank1: (t.match(/#1[^\n]*/) || [])[0] || null,
        absurdVisible: t.includes("AUDIT-7 Absurd"),
        sanityWarning: /suspicious|implausibly low|below .*budget|out.?of.?band|unusually low/i.test(t),
        varianceBanner: (t.match(/\+\$?[\d,]+ True Variance[^\n]*/) || [])[0] || null,
      };
    });
    await shot(page, "audit7-absurd-bid.png", { full: true });

    // award the absurd bid, execute, then inspect lock controls behaviorally
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("AUDIT-7 Absurd") && (d.innerText || "").includes("Award Subcontract"));
      const card = cards[cards.length - 1];
      card ? [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Award Subcontract & Generate AIA A401"))?.click() : null;
    });
    await delay(1500);
    await page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].pop(); if (d) [...d.querySelectorAll("button")].find((b) => /generate|award|confirm/i.test(b.textContent || ""))?.click(); });
    await delay(3000);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("06:")); b?.click(); });
    await delay(900);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Record Execution Status"))?.click(); });
    await delay(900);
    await page.evaluate(() => { const d = [...document.querySelectorAll('[role="alertdialog"]')].pop(); if (d) [...d.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Record"))?.click(); });
    await delay(3000);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:")); b?.click(); });
    await delay(1200);
    R.lock = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")].filter((b) => /Adjust Leveling/.test(b.textContent || ""));
      return { count: btns.length, disabled: btns.filter((b) => b.disabled).length, texts: btns.map((b) => ({ t: (b.textContent || "").trim().slice(0, 40), disabled: b.disabled })) };
    });
    // click the first Adjust Leveling and inspect the modal's save control
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Adjust Leveling/.test(x.textContent || "")); b?.click(); });
    await delay(1000);
    R.lockModal = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      if (!dlg) return { open: false };
      const btns = [...dlg.querySelectorAll("button")].map((b) => ({ t: (b.textContent || "").trim().slice(0, 44), disabled: b.disabled }));
      return { open: true, lockedText: /lock|executed|immutable/i.test(dlg.innerText), buttons: btns.slice(0, 8) };
    });
    await shot(page, "audit7-lock-modal.png", { full: true });

    // cleanup
    await http.mutation("projects:deleteProject", { projectId: fixture.value });
    R.remaining = (await http.query("projects:listProjects", {})).map((p) => p.title);
    R.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 110)).slice(0, 6) };
    writeJson("audit7-absurd-and-lock.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("audit7-absurd-and-lock.json", R);
    try { if (R.fixtureId) await http.mutation("projects:deleteProject", { projectId: R.fixtureId }); } catch {}
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 9000));
};
run();