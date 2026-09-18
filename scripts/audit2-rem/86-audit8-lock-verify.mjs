import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay, getSelectorState } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const FIXTURE = "AUDIT-8-2026-09-18";
const R = { startedAt: new Date().toISOString() };

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
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
        if (label.includes("trade package name")) { iset.call(el, "AUDIT-8 Electrical"); el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (label.includes("scope summary")) { tset.call(el, "Lock test."); el.dispatchEvent(new Event("input", { bubbles: true })); }
      }
    });
    await delay(300);
    await page.evaluate(() => { const dlg = [...document.querySelectorAll('[role="dialog"]')].pop(); [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Create Package")?.click(); });
    await delay(3000);
    const pkg = (await http.query("tradePackages:listByProject", { projectId: fixture.value }))[0];
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:")); b?.click(); });
    await delay(900);
    // ingest clean bid
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Ingest Quote / PDF")?.click(); });
    await delay(1200);
    await page.evaluate(() => {
      const submit = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Extract & Level Bid"));
      let dlg = submit; for (let i = 0; i < 8 && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("textarea")) break; }
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      for (const el of dlg.querySelectorAll("input")) { const ph = (el.placeholder || "").toLowerCase(); if (ph.includes("company name")) { iset.call(el, "AUDIT-8 Clean"); el.dispatchEvent(new Event("input", { bubbles: true })); } }
      const ta = dlg.querySelector("textarea");
      tset.call(ta, "PROPOSAL AND QUOTATION\nSubcontractor: AUDIT-8 Clean\nDivision 26 Electrical\nBase Bid Price: $1,225,000.00\nEverything included. Lead time: 10 weeks. Insurance: fully compliant ACORD 25 with $5M umbrella.");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await delay(300);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Extract & Level Bid"))?.click(); });
    let bids = [];
    for (let i = 0; i < 75; i++) { await delay(1000); bids = await http.query("bids:listByPackage", { tradePackageId: pkg._id }); if (bids.length > 0) break; }
    R.bid = bids[0] ? { name: bids[0].subcontractorName, base: bids[0].baseBidAmount, leveled: bids[0].leveledTotalCost, id: bids[0]._id } : null;

    // award + execute via UI
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("AUDIT-8 Clean") && (d.innerText || "").includes("Award Subcontract"));
      const card = cards[cards.length - 1];
      card ? [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Award Subcontract & Generate AIA A401"))?.click() : null;
    });
    await delay(1500);
    await page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].pop(); if (d) [...d.querySelectorAll("button")].find((b) => /generate|award|confirm/i.test(b.textContent || ""))?.click(); });
    await delay(3000);
    let agrs = await http.query("agreements:listAgreements", { projectId: fixture.value });
    R.afterAward = agrs.map((a) => ({ n: a.agreementNumber, status: a.status, bidId: a.bidId, sum: a.contractSum }));
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("06:")); b?.click(); });
    await delay(1000);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Record Execution Status"))?.click(); });
    await delay(900);
    await page.evaluate(() => { const d = [...document.querySelectorAll('[role="alertdialog"]')].pop(); if (d) [...d.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Record"))?.click(); });
    await delay(4000);
    agrs = await http.query("agreements:listAgreements", { projectId: fixture.value });
    R.afterExecute = agrs.map((a) => ({ n: a.agreementNumber, status: a.status, executedAt: a.executedAt || null }));
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:")); b?.click(); });
    await delay(1500);
    R.controls = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")].filter((b) => /Adjust|Leveling Locked/i.test(b.textContent || ""));
      return { count: btns.length, texts: btns.map((b) => ({ t: (b.textContent || "").trim().slice(0, 40), disabled: b.disabled, title: (b.getAttribute("title") || "").slice(0, 60) })) };
    });
    await shot(page, "audit8-lock-verified.png", { full: true });

    await http.mutation("projects:deleteProject", { projectId: fixture.value });
    R.remaining = (await http.query("projects:listProjects", {})).map((p) => p.title);
    R.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").length };
    writeJson("audit8-lock-verified.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("audit8-lock-verified.json", R);
    try { if (R.fixtureId) await http.mutation("projects:deleteProject", { projectId: R.fixtureId }); } catch {}
  } finally { await browser.close(); }
  console.log(JSON.stringify(R, null, 2).slice(0, 7000));
};
run();