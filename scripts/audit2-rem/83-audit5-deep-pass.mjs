import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay, getSelectorState } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const EV = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/evidence";
const DL = path.join(EV, "audit5-downloads");
fs.mkdirSync(DL, { recursive: true });
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const FIXTURE = "AUDIT-5-2026-09-18";
const R = { startedAt: new Date().toISOString(), fixture: FIXTURE, phases: {} };

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const client = await page.target().createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL }).catch(() => {});

  const T = async (name, fn) => { try { R.phases[name] = await fn(); } catch (e) { R.phases[name] = { error: String(e && e.message ? e.message : e) }; } };
  const clickText = async (t, exact = false) => page.evaluate(({ t, exact }) => { const b = [...document.querySelectorAll("button")].find((x) => { const s = (x.textContent || "").trim(); return exact ? s === t : s.includes(t); }); if (!b) return { ok: false }; b.click(); return { ok: true, text: (b.textContent || "").trim() }; }, { t, exact });
  const tab = async (p) => { await page.evaluate((pp) => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(pp)); b?.click(); }, p); await delay(900); };
  const closeTour = async () => { await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); }); await delay(300); };

  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await closeTour();

    // ---------- Setup fixture + package
    await T("setup", async () => {
      await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click(); });
      await delay(600);
      await page.evaluate((v) => { const dlg = document.querySelector('[role="dialog"]'); const input = [...dlg.querySelectorAll("input")].find((i) => (i.placeholder || "").toLowerCase().includes("innovation")) || dlg.querySelector("input"); const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; iset.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); }, FIXTURE);
      await delay(200);
      await page.evaluate(() => { const dlg = document.querySelector('[role="dialog"]'); [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"))?.click(); });
      await delay(5000);
      const sel = await getSelectorState(page);
      const fixture = sel.options.find((o) => o.text.includes(FIXTURE));
      if (!fixture) throw new Error("fixture not created");
      await page.evaluate((v) => { const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]'); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); }, fixture.value);
      await delay(1200);
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
          if (label.includes("trade package name")) { iset.call(el, "AUDIT-5 Electrical"); el.dispatchEvent(new Event("input", { bubbles: true })); }
          if (label.includes("scope summary")) { tset.call(el, "Audit deep-pass scope."); el.dispatchEvent(new Event("input", { bubbles: true })); }
        }
      });
      await delay(300);
      await clickText("Create Package", true);
      await delay(2500);
      const pkgs = await http.query("tradePackages:listByProject", { projectId: fixture.value });
      R.fixtureId = fixture.value;
      return { project: fixture.value, packages: pkgs.map((p) => ({ id: p._id, name: p.tradeName, budget: p.budgetEstimate })) };
    });
    if (!R.fixtureId) throw new Error("no fixture");

    // ---------- Bid ingestion x3
    const BIDS = [
      { name: "AUDIT-5 Clean Electric", file: "AUDIT5_Clean.pdf", text: "PROPOSAL AND QUOTATION\nSubcontractor: AUDIT-5 Clean Electric\nDivision 26 Electrical\nBase Bid Price: $1,225,000.00\nAll crane hoisting, UL 1479 firestopping, and seismic bracing are INCLUDED in the base bid.\nLead time: 10 weeks.\nInsurance: Fully compliant ACORD 25 with $5,000,000 umbrella." , expected: 1225000 },
      { name: "AUDIT-5 Deceptive Electric", file: "AUDIT5_Deceptive.pdf", text: "PROPOSAL AND QUOTATION\nSubcontractor: AUDIT-5 Deceptive Electric\nDivision 26 Electrical\nBase Bid Price: $1,100,000.00\nEXCLUSIONS:\n- Crane hoisting and rigging to the penthouse excluded ($45,000 impact)\n- UL 1479 floor penetration firestopping excluded ($22,000 impact)\n- Seismic engineered structural bracing excluded ($55,000 impact)\nLead time: 16 weeks.\nInsurance: Standard statutory limits only; umbrella endorsement not provided.", expected: 1286000 },
      { name: "AUDIT-5 Absurd Lowball", file: "AUDIT5_Absurd.pdf", text: "PROPOSAL AND QUOTATION\nSubcontractor: AUDIT-5 Absurd Lowball\nDivision 26 Electrical\nBase Bid Price: $250,000.00\nEverything included. Lead time: 8 weeks. Insurance: fully compliant.", expected: 250000 },
    ];
    await T("ingest", async () => {
      const results = [];
      for (const bid of BIDS) {
        await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:")); b?.click(); });
        await delay(900);
        await clickText("Ingest Quote / PDF");
        await delay(800);
        const filled = await page.evaluate(({ name, file, text }) => {
          const btns = [...document.querySelectorAll("button")];
          const submit = btns.find((b) => (b.textContent || "").includes("Extract & Level Bid"));
          if (!submit) return { ok: false, reason: "submit not found" };
          let dlg = submit;
          for (let i = 0; i < 8 && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("textarea")) break; }
          const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
          const sel = dlg.querySelector("select");
          if (sel) {
            const opt = [...sel.options].find((o) => o.value === "new_contractor");
            sel.value = "new_contractor"; sel.dispatchEvent(new Event("change", { bubbles: true }));
            if (!opt) return { ok: false, reason: "new_contractor option missing" };
          }
          for (const el of dlg.querySelectorAll("input")) {
            const ph = (el.placeholder || "").toLowerCase();
            if (ph.includes("company name")) { iset.call(el, name); el.dispatchEvent(new Event("input", { bubbles: true })); }
            if (ph.includes("filename") || ph.includes("revision")) { iset.call(el, file); el.dispatchEvent(new Event("input", { bubbles: true })); }
          }
          const ta = dlg.querySelector("textarea");
          if (!ta) return { ok: false, reason: "textarea not found" };
          tset.call(ta, text); ta.dispatchEvent(new Event("input", { bubbles: true }));
          return { ok: true };
        }, { name: bid.name, file: bid.file, text: bid.text });
        if (!filled.ok) { results.push({ bid: bid.name, ...filled }); continue; }
        await delay(200);
        await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Extract & Level Bid"))?.click(); });
        let appeared = false;
        for (let i = 0; i < 70; i++) {
          await delay(1000);
          appeared = await page.evaluate((n) => document.body.innerText.includes(n), bid.name);
          if (appeared) break;
        }
        results.push({ bid: bid.name, appeared, expectedLeveled: bid.expected });
      }
      return results;
    });

    // ---------- Backend bid verification + matrix UI
    await T("matrix", async () => {
      const bids = await http.query("bids:listByPackage", { tradePackageId: R.phases.setup.packages[0].id });
      const ui = await page.evaluate(() => {
        const t = document.body.innerText;
        return { ranked: (t.match(/Rank #\d+/g) || []).length, banners: (t.match(/True Variance[^\n]*|Deceptive Low Bid Flagged[^\n]*/g) || []).slice(0, 4), firstTable: t.slice(0, 0) };
      });
      return {
        backendBids: bids.map((b) => ({ name: b.subcontractorName, base: b.baseBidAmount, leveled: b.leveledTotalCost, exclusions: (b.identifiedExclusions || []).length, leadWeeks: b.longLeadEquipmentWeeks, leadPenalty: b.leadTimePenalty, coiPenalty: b.coiPenalty, coi: b.coiComplianceStatus, ve: (b.valueEngineeringAlternatives || []).length, awarded: b.isAwarded })),
        ui,
      };
    });
    await shot(page, "audit5-leveling-matrix.png", { full: true });

    // ---------- CSV export
    await T("csv", async () => {
      await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Export Leveling CSV"))?.click(); });
      await delay(3000);
      const files = fs.existsSync(DL) ? fs.readdirSync(DL).filter((f) => f.endsWith(".csv")) : [];
      if (files.length === 0) return { exported: false };
      const name = files[files.length - 1];
      const content = fs.readFileSync(path.join(DL, name), "utf8");
      const lines = content.split(/\r?\n/).filter(Boolean);
      return { exported: true, file: name, header: lines[0], rows: lines.slice(1, 5) };
    });

    // ---------- Award clean bid + agreement + execution
    await T("award", async () => {
      const cards = await page.evaluate(() => {
        const out = [];
        const all = [...document.querySelectorAll("div")];
        for (const d of all) {
          const t = d.innerText || "";
          if (/AUDIT-5 Clean Electric/.test(t) && /Award Subcontract/.test(t) && t.length < 2200) out.push(true);
        }
        const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Award Subcontract & Generate AIA A401"));
        if (!btn) return { ok: false };
        btn.click();
        return { ok: true, candidates: out.length };
      });
      await delay(1500);
      // possible confirm
      await page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].pop(); if (d) [...d.querySelectorAll("button")].find((b) => /generate|award|confirm/i.test(b.textContent || ""))?.click(); });
      await delay(2500);
      const agreements = await http.query("agreements:listAgreements", { projectId: R.fixtureId });
      const bids = await http.query("bids:listByPackage", { tradePackageId: R.phases.setup.packages[0].id });
      const awarded = bids.find((b) => b.isAwarded);
      return { agreements: agreements.map((a) => ({ n: a.agreementNumber, sub: a.subcontractorName, sum: a.contractSum, status: a.status, ld: a.liquidatedDamagesDaily })), awardedBid: awarded ? { name: awarded.subcontractorName, leveled: awarded.leveledTotalCost } : null };
    });

    // open contracts, record execution
    await T("execute", async () => {
      await tab("06:");
      await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Record Execution Status")); b?.click(); });
      await delay(900);
      await page.evaluate(() => { const d = [...document.querySelectorAll('[role="alertdialog"]')].pop(); if (d) [...d.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Record"))?.click(); });
      await delay(2500);
      const agreements = await http.query("agreements:listAgreements", { projectId: R.fixtureId });
      const ui = await page.evaluate(() => { const t = document.body.innerText; return { exec: (t.match(/EXECUTION STATUS RECORDED[^\n]*/) || [])[0] || null, sum: (t.match(/ACTIVE CONTRACTED SUM\s*\$?([\d,]+)/) || [])[1] || null }; });
      // leveling lock check
      await tab("04:");
      const lock = await page.evaluate(() => { const t = document.body.innerText; const disabled = [...document.querySelectorAll("button")].filter((b) => /Adjust Leveling/.test(b.textContent || "") && b.disabled).length; return { lockedText: /Leveling locked|executed agreement/i.test(t), disabledAdjustButtons: disabled }; });
      await shot(page, "audit5-executed-lock.png", { full: true });
      return { agreements: agreements.map((a) => ({ n: a.agreementNumber, status: a.status, sum: a.contractSum })), ui, lock };
    });

    // ---------- Addendum + file delete
    await T("addendum", async () => {
      await tab("03:");
      const s = await page.$('input[placeholder*="Hoisting responsibility"]');
      const q = await page.$('textarea[placeholder*="scope coordination question"]');
      await s.click({ clickCount: 3 });
      await page.keyboard.type("AUDIT-5 DEEP: switchgear delivery sequencing");
      await q.click({ clickCount: 3 });
      await page.keyboard.type("AUDIT-5 deep-pass question: please confirm the delivery sequencing responsibility for the main switchgear.");
      await delay(300);
      await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Submit RFI"))?.click(); });
      let count = "0";
      for (let i = 0; i < 50; i++) { await delay(1500); count = await page.evaluate(() => (document.body.innerText.match(/All RFIs \((\d+)\)/) || [])[1] || "0"); if (Number(count) > 0) break; }
      await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Approve for Addendum"); b?.click(); });
      await delay(2500);
      await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Issue Legal Addendum"))?.click(); });
      await delay(10000);
      const res = await page.evaluate(() => { const t = document.body.innerText; return { success: (t.match(/Pre-Bid Addendum NO\. 01 Successfully Issued[^\n]*/) || [])[0] || null, filename: (t.match(/ADDENDUM[A-Z0-9_.]*\.md/) || [])[0] || null, mentionsRfi: t.includes("AUDIT-5 DEEP") }; });
      await shot(page, "audit5-addendum.png", { full: true });
      return { rfiCount: count, ...res };
    });

    await T("fileDelete", async () => {
      await tab("01:");
      await delay(800);
      const rowInfo = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("ADDENDUM") && (d.innerText || "").includes("Delete file from storage"));
        const row = rows[rows.length - 1];
        if (!row) return { ok: false };
        const trash = [...row.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "").includes("Delete file"));
        trash.click();
        return { ok: true };
      });
      await delay(800);
      const confirmText = await page.evaluate(() => (document.querySelector('[role="alertdialog"]')?.innerText || "").slice(0, 220));
      // cancel first
      await page.evaluate(() => { const d = document.querySelector('[role="alertdialog"]'); if (d) [...d.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Cancel")?.click(); });
      await delay(600);
      const stillThere = await page.evaluate(() => document.body.innerText.includes("ADDENDUM_NO_01_CLARIFICATIONS.md"));
      // confirm delete
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("ADDENDUM") && (d.innerText || "").includes("Delete file from storage"));
        const row = rows[rows.length - 1];
        const trash = row ? [...row.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "").includes("Delete file")) : null;
        trash?.click();
      });
      await delay(700);
      await page.evaluate(() => { const d = document.querySelector('[role="alertdialog"]'); if (d) [...d.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Delete file"))?.click(); });
      await delay(2500);
      const files = await http.query("files:listFilesByProject", { projectId: R.fixtureId });
      return { rowInfo, confirmText, cancelKeep: stillThere, remainingFiles: files.map((f) => f.fileName) };
    });

    // ---------- Clash empty state, contrast, soak
    await T("clashEmpty", async () => {
      await tab("05:");
      await delay(1000);
      return await page.evaluate(() => { const t = document.body.innerText; return { items: (t.match(/(\d+) items awaiting resolution/) || [])[1] || null, doubleBuys: (t.match(/Redundant Double-Buys\s*\$?([\d,]*)/) || [])[1] || null, zeroState: /No (?:open|detected)|Resolved/i.test(t) }; });
    });

    await T("contrast", async () => {
      return await page.evaluate(() => {
        const parse = (c) => { const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
        const lum = (rgb) => { const s = rgb.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
        const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
        const blend = (fg, bg, e) => { const a = fg[3] * (e ?? 1); return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]; };
        const bgOf = (el) => { let cur = el; while (cur) { const cs = getComputedStyle(cur); if (cs.backgroundImage && cs.backgroundImage !== "none") return null; if (cs.backgroundColor && !cs.backgroundColor.includes("rgba(0, 0, 0, 0)")) { const bg = parse(cs.backgroundColor); if (bg && bg[3] > 0.9) return bg; } cur = cur.parentElement; } return [10, 15, 29, 1]; };
        const fails = [];
        for (const el of document.querySelectorAll("span,p,div,li,td,th,label,code")) {
          const txt = (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 3)) ? el.innerText : "";
          if (!txt || txt.length > 100) continue;
          const bg = bgOf(el); if (!bg) continue;
          const fs = parseFloat(getComputedStyle(el).fontSize); if (fs > 12.5) continue;
          const fg0 = parse(getComputedStyle(el).color); if (!fg0) continue;
          let o = 1, cur = el; while (cur && cur !== document.body) { o *= parseFloat(getComputedStyle(cur).opacity || "1"); cur = cur.parentElement; }
          const fg = blend(fg0, bg, o);
          const r = ratio(fg, bg);
          if (r < 4.5) fails.push({ text: txt.slice(0, 45), ratio: Math.round(r * 100) / 100, fontSize: getComputedStyle(el).fontSize });
        }
        return { failCount: fails.length, sample: fails.slice(0, 5) };
      });
    });

    await T("soak", async () => {
      const startErrors = diag.consoleLogs.filter((l) => l.type === "error").length;
      for (let i = 0; i < 3; i++) {
        for (const p of ["01:", "02:", "03:", "04:", "05:", "06:"]) { await tab(p); await delay(250); }
        await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Live Activity Audit"))?.click(); });
        await delay(400);
        await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Evals & Architecture"))?.click(); });
        await delay(400);
        await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Evals & Architecture"))?.click(); });
        await delay(600);
      }
      return { consoleErrorsDuringSoak: diag.consoleLogs.filter((l) => l.type === "error").length - startErrors };
    });

    // ---------- Cleanup
    await T("cleanup", async () => {
      await http.mutation("projects:deleteProject", { projectId: R.fixtureId });
      const after = await http.query("projects:listProjects", {});
      return { remaining: after.map((p) => p.title) };
    });

    R.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 100)).slice(0, 8) };
    writeJson("audit5-deep-pass.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("audit5-deep-pass.json", R);
    try { if (R.fixtureId) await http.mutation("projects:deleteProject", { projectId: R.fixtureId }); } catch {}
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 16000));
};
run();