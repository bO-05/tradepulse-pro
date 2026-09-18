import { launchBrowser, attachDiagnostics, waitForAppReady, selectProjectByTitle, shot, writeJson, writeLog, delay } from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";

const DOWNLOAD_DIR = "C:/Users/user/AppData/Local/Temp/opencode/qa3-downloads3";
const FIX_A = "AUDIT-QA3-fixture-2026-09-18";

function parseCsv(text) {
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
  return records;
}

const run = async () => {
  fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const out = { startedAt: new Date().toISOString() };
  const { browser } = await launchBrowser(1600, 1000);
  const page = await browser.newPage();
  attachDiagnostics(page);
  const bcdp = await browser.target().createCDPSession();
  await bcdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOAD_DIR, eventsEnabled: true });
  const events = [];
  bcdp.on("Browser.downloadWillBegin", (e) => events.push({ ev: "willBegin", file: e.suggestedFilename }));
  bcdp.on("Browser.downloadProgress", (e) => events.push({ ev: "progress", state: e.state }));

  await page.goto(process.env.REM_BASE_URL || "https://brainy-skunk-440.convex.site", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);

  // ---- Controlled A/B: immediate revoke vs delayed revoke ----
  const ab = await page.evaluate(async () => {
    const mk = (name, body) => {
      const blob = new Blob([body], { type: "text/plain;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return url;
    };
    const urlImmediate = mk("qa3-ab-immediate.txt", "QA3 immediate revoke payload");
    URL.revokeObjectURL(urlImmediate);
    const urlDelayed = mk("qa3-ab-delayed.txt", "QA3 delayed revoke payload");
    setTimeout(() => URL.revokeObjectURL(urlDelayed), 5000);
    return { immediate: !!urlImmediate, delayed: !!urlDelayed };
  });
  await delay(6000);
  out.ab = { ...ab, files: fs.readdirSync(DOWNLOAD_DIR) };

  // ---- Capture real export bytes (fetch blob before revoke) ----
  // ---- Update fixture bid with leading-= formula payload via public mutation ----
  const { ConvexHttpClient } = await import("convex/browser");
  const cc = new ConvexHttpClient(process.env.REM_CONVEX_URL || "https://brainy-skunk-440.convex.cloud");
  const projects0 = await cc.query("projects:listProjects", {});
  const fixA = projects0.find((p) => p.title === FIX_A);
  const pkgs0 = await cc.query("tradePackages:listByProject", { projectId: fixA._id });
  const racePkg = pkgs0.find((p) => p.csiDivision === "24 00 00");
  const cons0 = await cc.query("contractors:listByProject", { projectId: fixA._id });
  const csvCon = cons0.find((x) => x.tradePackageId === racePkg._id);
  const HOSTILE = {
    tradePackageId: racePkg._id, contractorId: csvCon._id,
    subcontractorName: '=HYPERLINK("http://evil.example","QA3") "CSV,Name"\nQA3 second line',
    baseBidAmount: 123456.78, longLeadEquipmentWeeks: 9,
    identifiedExclusions: [{ description: 'Excl "A", line1\nline2', costImpact: 5000, severity: "critical", isWaived: false }],
    leadTimePenalty: 6000, coiPenalty: 1500, coiComplianceStatus: 'compliant" =1+1\nthird',
  };
  out.hostileUpsert = await cc.mutation("bids:submitDirectBid", HOSTILE).catch((e) => ({ error: String(e.message) }));
  out.storedBid = (await cc.query("bids:listByPackage", { tradePackageId: racePkg._id })).map((b) => ({ name: b.subcontractorName, coi: b.coiComplianceStatus }));

  await selectProjectByTitle(page, FIX_A);
  await delay(1500);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:"))?.click());
  await delay(1200);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("24 00 00"))?.click());
  await delay(1000);
  await page.evaluate(() => {
    window.__qa3Text = null;
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.href && this.href.startsWith("blob:")) {
        const u = this.href;
        fetch(u).then((r) => r.text()).then((t) => { window.__qa3Text = { name: this.download, text: t }; }).catch((e) => { window.__qa3Text = { error: String(e) }; });
      }
      return origClick.call(this);
    };
  });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Export Leveling CSV"))?.click());
  await delay(1500);
  const captured = await page.evaluate(() => window.__qa3Text);
  out.captured = captured ? { name: captured.name, length: captured.text ? captured.text.length : null, text: captured.text, error: captured.error } : null;
  out.downloadEvents = events;
  await delay(1500);
  out.filesAfterExport = fs.readdirSync(DOWNLOAD_DIR);
  await shot(page, "fix4-qa3-04c-after-ab.png");

  if (captured && captured.text) {
    const text = captured.text;
    const bytes = Buffer.from(text, "utf8");
    fs.writeFileSync(path.join("evidence", "fix4-qa3-04-leveling-export.csv"), bytes);
    const records = parseCsv(text);
    out.csvAnalysis = {
      bytes: bytes.length,
      crlfCount: (text.match(/\r\n/g) || []).length,
      loneLfCount: (text.match(/(?<!\r)\n/g) || []).length,
      headerFieldCount: records[0]?.length,
      rowFieldCounts: records.slice(1).map((r) => r.length),
      records: records.map((r) => r.map((f) => f.slice(0, 60))),
      checks: {
        noCRLF: (text.match(/\r\n/g) || []).length === 0,
        formulaInjectionInSubName: text.includes('"=HYPERLINK'),
        coiQuoteUnescaped: text.includes('compliant" =1+1'),
        embeddedNewlineUnquotedBreak: records.slice(1).some((r) => r.length !== records[0].length),
      },
    };
  } else if (out.filesAfterExport.some((f) => f.endsWith(".csv"))) {
    const f = out.filesAfterExport.find((x) => x.endsWith(".csv"));
    const bytes = fs.readFileSync(path.join(DOWNLOAD_DIR, f));
    const text = bytes.toString("utf8");
    fs.copyFileSync(path.join(DOWNLOAD_DIR, f), path.join("evidence", "fix4-qa3-04-leveling-export.csv"));
    const records = parseCsv(text);
    out.csvAnalysis = {
      bytes: bytes.length,
      crlfCount: (text.match(/\r\n/g) || []).length,
      headerFieldCount: records[0]?.length,
      rowFieldCounts: records.slice(1).map((r) => r.length),
      checks: {
        noCRLF: (text.match(/\r\n/g) || []).length === 0,
        formulaInjectionInSubName: text.includes('"=HYPERLINK'),
        coiQuoteUnescaped: text.includes('compliant" =1+1'),
        embeddedNewlineUnquotedBreak: records.slice(1).some((r) => r.length !== records[0].length),
      },
    };
  }
  writeJson("fix4-qa3-04c-ab-csv.json", out);
  writeLog("fix4-qa3-04c-ab-csv.log", (out.csvAnalysis?.records || []).map((r) => JSON.stringify(r)));
  console.log(JSON.stringify({ ab: out.ab, filesAfterExport: out.filesAfterExport, downloadEvents: out.downloadEvents, csvAnalysis: out.csvAnalysis ? { bytes: out.csvAnalysis.bytes, crlfCount: out.csvAnalysis.crlfCount, headerFieldCount: out.csvAnalysis.headerFieldCount, rowFieldCounts: out.csvAnalysis.rowFieldCounts, checks: out.csvAnalysis.checks } : null }, null, 2));
  await browser.close();
};
run().catch((e) => { console.error("ERR", e && e.stack ? e.stack : e); process.exit(1); });