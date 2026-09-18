import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay, getSelectorState } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const EV = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/evidence";
const DL = path.join(EV, "audit6-downloads");
fs.mkdirSync(DL, { recursive: true });
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const FIXTURE = "AUDIT-6-2026-09-18";
const R = { startedAt: new Date().toISOString(), fixture: FIXTURE };

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const client = await page.target().createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL }).catch(() => {});

  const clickText = async (t, exact = false) => page.evaluate(({ t, exact }) => { const b = [...document.querySelectorAll("button")].find((x) => { const s = (x.textContent || "").trim(); return exact ? s === t : s.includes(t); }); if (!b) return { ok: false }; b.click(); return { ok: true, text: (b.textContent || "").trim() }; }, { t, exact });
  const tab = async (p) => { await page.evaluate((pp) => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(pp)); b?.click(); }, p); await delay(900); };
  const waitModal = async (ms) => { for (let i = 0; i < ms / 250; i++) { const ok = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("Extract & Level Bid"))); if (ok) return true; await delay(250); } return false; };

  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);

    // setup
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click(); });
    await delay(600);
    await page.evaluate((v) => { const dlg = document.querySelector('[role="dialog"]'); const input = [...dlg.querySelectorAll("input")].find((i) => (i.placeholder || "").toLowerCase().includes("innovation")) || dlg.querySelector("input"); const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; iset.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); }, FIXTURE);
    await delay(200);
    await page.evaluate(() => { const dlg = document.querySelector('[role="dialog"]'); [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"))?.click(); });
    await delay(5000);
    const sel = await getSelectorState(page);
    const fixture = sel.options.find((o) => o.text.includes(FIXTURE));
    if (!fixture) throw new Error("fixture not created");
    R.fixtureId = fixture.value;
    await page.evaluate((v) => { const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]'); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); }, fixture.value);
    await delay(1500);
    await clickText("Create Trade Package");
    await delay(700);
    await page.evaluate(() => {
      const h = [...document.querySelectorAll("h3")].find((el) => (el.textContent || "").includes("Create CSI Trade Package"));
      let dlg = h; for (let i = 0; i < 6 && dlg && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("input")) break; }
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      for (const el of dlg.querySelectorAll("input,textarea")) {
        const label = (el.closest("div")?.querySelector("label")?.textContent || "").toLowerCase();
        if (label.includes("csi division")) { iset.call(el, "26 00 00"); el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (label.includes("trade package name")) { iset.call(el, "AUDIT-6 Electrical"); el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (label.includes("scope summary")) { tset.call(el, "Deep pass scope."); el.dispatchEvent(new Event("input", { bubbles: true })); }
      }
    });
    await delay(300);
    await clickText("Create Package", true);
    await delay(3000);
    const pkgs0 = await http.query("tradePackages:listByProject", { projectId: fixture.value });
    R.package = pkgs0[0];
    R.activePackageUi = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("AUDIT-6 Electrical"));
      return cards.length;
    });
    await tab("04:");

    const BIDS = [
      { name: "AUDIT-6 Clean", text: "PROPOSAL AND QUOTATION\nSubcontractor: AUDIT-6 Clean\nDivision 26 Electrical\nBase Bid Price: $1,225,000.00\nAll crane hoisting, UL 1479 firestopping, and seismic bracing INCLUDED.\nLead time: 10 weeks.\nInsurance: fully compliant ACORD 25 with $5M umbrella." },
      { name: "AUDIT-6 Deceptive", text: "PROPOSAL AND QUOTATION\nSubcontractor: AUDIT-6 Deceptive\nDivision 26 Electrical\nBase Bid Price: $1,100,000.00\nEXCLUSIONS:\n- Crane hoisting and rigging to the penthouse excluded ($45,000 impact)\n- UL 1479 floor penetration firestopping excluded ($22,000 impact)\n- Seismic engineered structural bracing excluded ($55,000 impact)\nLead time: 16 weeks.\nInsurance: Standard statutory limits only; umbrella endorsement not provided." },
      { name: "AUDIT-6 Absurd", text: "PROPOSAL AND QUOTATION\nSubcontractor: AUDIT-6 Absurd\nDivision 26 Electrical\nBase Bid Price: $250,000.00\nEverything included. Lead time: 8 weeks. Insurance: fully compliant." },
    ];
    R.ingests = [];
    for (const bid of BIDS) {
      await tab("04:");
      let click = await clickText("Ingest Quote / PDF", true);
      let modal = await waitModal(4000);
      if (!modal) { click = await clickText("Ingest Quote / PDF"); modal = await waitModal(4000); }
      if (!modal) { click = await clickText("Ingest"); modal = await waitModal(6000); }
      if (!modal) { R.ingests.push({ bid: bid.name, modalOpened: false, click, buttons: await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter((t) => t.includes("Ingest"))) }); await shot(page, "audit6-modal-missing.png"); continue; }
      await page.evaluate(({ name, text }) => {
        const submit = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Extract & Level Bid"));
        let dlg = submit; for (let i = 0; i < 8 && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("textarea")) break; }
        const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        const s = dlg.querySelector("select");
        if (s) { s.value = "new_contractor"; s.dispatchEvent(new Event("change", { bubbles: true })); }
        for (const el of dlg.querySelectorAll("input")) {
          const ph = (el.placeholder || "").toLowerCase();
          if (ph.includes("company name")) { iset.call(el, name); el.dispatchEvent(new Event("input", { bubbles: true })); }
        }
        const ta = dlg.querySelector("textarea");
        tset.call(ta, text); ta.dispatchEvent(new Event("input", { bubbles: true }));
      }, { name: bid.name, text: bid.text });
      await delay(300);
      await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Extract & Level Bid"))?.click(); });
      let appeared = false;
      for (let i = 0; i < 70; i++) { await delay(1000); appeared = await page.evaluate((n) => document.body.innerText.includes(n), bid.name); if (appeared) break; }
      const all = await http.query("bids:listAllProjectBids", { projectId: fixture.value });
      const byPkg = await http.query("bids:listByPackage", { tradePackageId: R.package._id });
      R.ingests.push({ bid: bid.name, modalOpened: true, appeared, backendAll: all.map((b) => ({ n: b.subcontractorName, pkg: b.tradePackageId, base: b.baseBidAmount, leveled: b.leveledTotalCost })), backendByPackage: byPkg.length });
      await shot(page, `audit6-ingest-${R.ingests.length}.png`, { full: true });
    }

    // matrix math
    const bids = await http.query("bids:listByPackage", { tradePackageId: R.package._id });
    R.matrix = {
      count: bids.length,
      bids: bids.map((b) => ({
        name: b.subcontractorName, base: b.baseBidAmount,
        exclusions: (b.identifiedExclusions || []).reduce((s, e) => s + (e.isWaived ? 0 : e.costImpact || 0), 0),
        lead: b.leadTimePenalty, coi: b.coiPenalty, ve: (b.valueEngineeringAlternatives || []).reduce((s, x) => s + (x.isAccepted ? x.costDeduct : 0), 0),
        leveled: b.leveledTotalCost,
        handCalc: b.baseBidAmount + (b.identifiedExclusions || []).reduce((s, e) => s + (e.isWaived ? 0 : e.costImpact || 0), 0) + (b.leadTimePenalty || 0) + (b.coiPenalty || 0) - (b.valueEngineeringAlternatives || []).reduce((s, x) => s + (x.isAccepted ? x.costDeduct : 0), 0),
      })),
      ranking: bids.map((b) => ({ n: b.subcontractorName, leveled: b.leveledTotalCost })).sort((a, b) => a.leveled - b.leveled).map((b, i) => `#${i + 1} ${b.n} $${b.leveled.toLocaleString()}`),
    };
    await shot(page, "audit6-matrix-final.png", { full: true });

    // CSV
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Export Leveling CSV"))?.click(); });
    await delay(3000);
    const csvFiles = fs.existsSync(DL) ? fs.readdirSync(DL).filter((f) => f.endsWith(".csv")) : [];
    R.csv = csvFiles.length ? { file: csvFiles[csvFiles.length - 1], content: fs.readFileSync(path.join(DL, csvFiles[csvFiles.length - 1]), "utf8").split(/\r?\n/).slice(0, 6) } : { exported: false };

    // award the Clean bid (not the absurd one) + agreement + execute + lock
    R.award = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("AUDIT-6 Clean") && (d.innerText || "").includes("Award Subcontract"));
      const card = cards[cards.length - 1];
      const btn = card ? [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Award Subcontract & Generate AIA A401")) : null;
      if (!btn) return { ok: false };
      btn.click();
      return { ok: true };
    });
    await delay(1500);
    await page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].pop(); if (d) [...d.querySelectorAll("button")].find((b) => /generate|award|confirm/i.test(b.textContent || ""))?.click(); });
    await delay(3000);
    const agr1 = await http.query("agreements:listAgreements", { projectId: fixture.value });
    R.awardBackend = agr1.map((a) => ({ n: a.agreementNumber, sub: a.subcontractorName, sum: a.contractSum, status: a.status, ld: a.liquidatedDamagesDaily }));
    await tab("06:");
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Record Execution Status"))?.click(); });
    await delay(900);
    await page.evaluate(() => { const d = [...document.querySelectorAll('[role="alertdialog"]')].pop(); if (d) [...d.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Record"))?.click(); });
    await delay(3000);
    const agr2 = await http.query("agreements:listAgreements", { projectId: fixture.value });
    const kpi = await page.evaluate(() => { const t = document.body.innerText; return { exec: (t.match(/EXECUTION STATUS RECORDED\s*(\d+\s*\/\s*\d+)/) || []).slice(1), sum: (t.match(/ACTIVE CONTRACTED SUM\s*\$?([\d,]+)/) || [])[1] || null, buyout: (t.match(/Buyout: (\d+)\/(\d+) Awarded/) || []).slice(1) }; });
    await tab("04:");
    R.lock = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")].filter((b) => /Adjust Leveling/.test(b.textContent || ""));
      return { adjustButtons: btns.length, disabled: btns.filter((b) => b.disabled).length, lockedText: /Leveling locked|executed agreement/i.test(document.body.innerText) };
    });
    await shot(page, "audit6-executed.png", { full: true });
    R.execute = { agreements: agr2.map((a) => ({ n: a.agreementNumber, status: a.status, sum: a.contractSum })), kpi };

    // cleanup
    await http.mutation("projects:deleteProject", { projectId: fixture.value });
    R.remaining = (await http.query("projects:listProjects", {})).map((p) => p.title);
    R.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 120)).slice(0, 8) };
    writeJson("audit6-deep-pass.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("audit6-deep-pass.json", R);
    try { if (R.fixtureId) await http.mutation("projects:deleteProject", { projectId: R.fixtureId }); } catch {}
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 14000));
};
run();