import { ConvexHttpClient } from "convex/browser";
import { launchBrowser, attachDiagnostics, waitForAppReady, selectProjectByTitle, shot, writeJson, writeLog, delay } from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";

const c = new ConvexHttpClient(process.env.REM_CONVEX_URL || "https://brainy-skunk-440.convex.cloud");
const FIX_A = "AUDIT-QA3-fixture-2026-09-18";
const DOWNLOAD_DIR = "C:/Users/user/AppData/Local/Temp/opencode/qa3-downloads";

async function call(fn, args) {
  try { return { threw: false, value: await c.mutation(fn, args) }; }
  catch (e) { return { threw: true, data: e && e.data !== undefined ? e.data : null, message: e && e.message ? e.message : String(e) }; }
}
async function query(fn, args) {
  try { return { threw: false, value: await c.query(fn, args) }; }
  catch (e) { return { threw: true, data: e && e.data !== undefined ? e.data : null, message: e && e.message ? e.message : String(e) }; }
}
const errText = (r) => (r.data && typeof r.data === "string" ? r.data : r.data ? JSON.stringify(r.data) : r.message);

const HOSTILE_NAME = 'QA3=2+2 "CSV,Name"\nQA3 second line';
const HOSTILE_COI = 'compliant" =1+1\nthird';

const run = async () => {
  const out = { startedAt: new Date().toISOString(), downloadDir: DOWNLOAD_DIR };
  fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const projects = (await query("projects:listProjects", {})).value;
  const fixA = projects.find((p) => p.title === FIX_A);
  if (!fixA) throw new Error("fixture A missing");
  const pkgs = (await query("tradePackages:listByProject", { projectId: fixA._id })).value;
  const racePkg = pkgs.find((p) => p.csiDivision === "24 00 00");
  if (!racePkg) throw new Error("race package missing");
  out.package = { id: racePkg._id, csi: racePkg.csiDivision, budget: racePkg.budgetEstimate };

  let con = (await query("contractors:listByProject", { projectId: fixA._id })).value.find((x) => x.tradePackageId === racePkg._id && x.companyName.startsWith("QA3 CSV"));
  if (!con) {
    const r = await call("contractors:createContractor", {
      tradePackageId: racePkg._id, companyName: "QA3 CSV Hostile Co", contactEmail: "csv@tradepulse-pro.test",
      licenseNumber: "TX-CSV", licenseStatus: "Active", sourceUrl: "s", rfqStatus: "discovered",
    });
    if (r.threw) throw new Error("contractor: " + errText(r));
    con = { _id: r.value };
  }
  const bid = await call("bids:submitDirectBid", {
    tradePackageId: racePkg._id, contractorId: con._id, subcontractorName: HOSTILE_NAME,
    baseBidAmount: 123456.78, longLeadEquipmentWeeks: 9,
    identifiedExclusions: [{ description: 'Excl "A", line1\nline2', costImpact: 5000, severity: "critical", isWaived: false }],
    leadTimePenalty: 6000, coiPenalty: 1500, coiComplianceStatus: HOSTILE_COI,
  });
  out.bid = bid.threw ? { error: errText(bid) } : bid.value;
  out.storedBid = (await query("bids:listByPackage", { tradePackageId: racePkg._id })).value.map((b) => ({ id: b._id, name: b.subcontractorName, coi: b.coiComplianceStatus, leveled: b.leveledTotalCost }));

  const { browser } = await launchBrowser(1600, 1000);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  try {
    const cdp = await browser.target().createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOAD_DIR, eventsEnabled: true });
    await page.goto(process.env.REM_BASE_URL || "https://brainy-skunk-440.convex.site", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await selectProjectByTitle(page, FIX_A);
    await delay(1500);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:"));
      b?.click();
    });
    await delay(1200);
    const pkgSel = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("24 00 00"));
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.textContent || "").trim()).filter(Boolean).slice(0, 40) };
      b.click();
      return { ok: true, text: (b.textContent || "").trim() };
    });
    out.packageSelect = pkgSel;
    await delay(1200);
    await shot(page, "fix4-qa3-04-csv-before-export.png");
    const exportClick = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Export Leveling CSV"));
      if (!b) return { ok: false };
      b.click();
      return { ok: true, disabled: b.disabled };
    });
    out.exportClick = exportClick;
    let csvPath = null;
    for (let i = 0; i < 20; i++) {
      await delay(500);
      const files = fs.readdirSync(DOWNLOAD_DIR).filter((f) => f.toLowerCase().endsWith(".csv"));
      if (files.length) { csvPath = path.join(DOWNLOAD_DIR, files[0]); break; }
    }
    out.csvPath = csvPath;
    if (csvPath) {
      const bytes = fs.readFileSync(csvPath);
      out.bytesLength = bytes.length;
      const text = bytes.toString("utf8");
      out.crlfCount = (text.match(/\r\n/g) || []).length;
      out.lfCount = (text.match(/\n/g) || []).length;
      out.lines = text.split("\n");
      out.header = out.lines[0];
      // RFC4180 parser to count fields per logical record
      const records = [];
      let cur = [];
      let field = "";
      let inQuotes = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
          if (ch === '"') {
            if (text[i + 1] === '"') { field += '"'; i++; }
            else inQuotes = false;
          } else field += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === ",") { cur.push(field); field = ""; }
        else if (ch === "\n") { cur.push(field); records.push(cur); cur = []; field = ""; }
        else if (ch !== "\r") field += ch;
      }
      if (field.length || cur.length) { cur.push(field); records.push(cur); }
      out.records = records.map((r) => r.length);
      out.parsedRecords = records.slice(0, 4);
      out.headerFieldCount = records[0]?.length;
      out.rowFieldCounts = records.slice(1).map((r) => r.length);
      const raw = bytes.toString("utf8");
      out.checks = {
        headerPresent: raw.startsWith("Rank,Subcontractor Name,"),
        noCRLF: out.crlfCount === 0,
        formulaInjectionPresent: raw.includes("QA3=2+2"),
        coiQuoteNotEscaped: raw.includes('compliant" =1+1'),
        embeddedNewlinePreserved: raw.includes("QA3 second line"),
        malformedRowShiftsColumns: (out.rowFieldCounts || []).some((n) => n !== out.headerFieldCount),
      };
      fs.copyFileSync(csvPath, path.join("evidence", "fix4-qa3-04-leveling-export.csv"));
    }
    await shot(page, "fix4-qa3-04-csv-after-export.png");
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
  } finally {
    out.diag = { pageErrors: diag.pageErrors.slice(0, 5), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 5) };
    await browser.close();
  }
  writeJson("fix4-qa3-04-csv-upload.json", out);
  writeLog("fix4-qa3-04-csv-upload.log", JSON.stringify(out, null, 2).split("\n"));
  console.log(JSON.stringify({ package: out.package, bid: out.bid, csvPath: out.csvPath, bytesLength: out.bytesLength, crlf: out.crlfCount, headerFieldCount: out.headerFieldCount, rowFieldCounts: out.rowFieldCounts, checks: out.checks }, null, 2));
};
run().catch((e) => { console.error("ERR", e && e.stack ? e.stack : e); process.exit(1); });