/**
 * AUDIT7 CONV-A round 1 — Step 6: exported CSV row must match the backend exactly.
 * Drives the real "Export Leveling CSV" button via CDP download capture, parses the
 * downloaded file, and compares every column against bids:listByPackage.
 */
import fs from "node:fs";
import path from "node:path";
import {
  delay, openApp, q, clickTab, selectProject, clickText, poll, writeEvidence, PREFIX, DAILY,
} from "./lib.mjs";

const TITLE = `${PREFIX}CONV-A-${DAILY}`;
const PKG_NAME = "AUDIT7-CONV-A Div 22 Plumbing & Booster Systems";
const out = { startedAt: new Date().toISOString(), assertions: {}, csvText: null, csvPath: null };

const evidenceDir = path.join(process.cwd(), "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

const proj = ((await q("projects:listProjects", {})) || []).find((p) => p.title === TITLE);
if (!proj) throw new Error("CONV-A fixture missing");
const pkgs = (await q("tradePackages:listByProject", { projectId: proj._id })) || [];
const pkg = pkgs.find((p) => p.tradeName === PKG_NAME);
if (!pkg) throw new Error("manual Div 22 package missing");
const backendBids = ((await q("bids:listByPackage", { tradePackageId: pkg._id })) || []).sort(
  (a, b) => a.leveledTotalCost - b.leveledTotalCost
);

const { browser, page } = await openApp(1440, 900);
try {
  await selectProject(page, proj._id);
  await clickTab(page, "01:");
  await delay(1500);
  const selected = await page.evaluate((name) => {
    const h = [...document.querySelectorAll("h3")].find((x) => x.textContent.trim() === name);
    if (!h) return false;
    h.click();
    return true;
  }, PKG_NAME);
  out.assertions.packageSelected = selected;
  await delay(1500);
  await clickTab(page, "04:");
  await delay(1500);

  const client = await page.createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: evidenceDir }).catch(async () => {
    await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: evidenceDir });
  });

  const click = await clickText(page, "Export Leveling CSV");
  out.assertions.exportClicked = click.ok;
  const file = await poll(
    () => {
      const names = fs.readdirSync(evidenceDir).filter((f) => /^TradePulse_Bid_Leveling_CSI_220000.*\.csv$/i.test(f));
      return names.length ? names.sort().pop() : null;
    },
    (n) => Boolean(n),
    30000,
    700
  );
  out.csvPath = file ? path.join(evidenceDir, file) : null;
  out.assertions.downloadCaptured = Boolean(file);
  if (file) {
    const raw = fs.readFileSync(path.join(evidenceDir, file), "utf8");
    // keep a stable evidence copy for this round
    const stable = path.join(evidenceDir, "a7conv-a-step6-export.csv");
    fs.writeFileSync(stable, raw, "utf8");
    out.csvPath = stable;
    out.csvText = raw;
    const rows = parseCsv(raw);
    const headers = rows[0];
    const dataRows = rows.slice(1);
    out.headers = headers;
    out.rows = dataRows;

    const col = (name) => headers.indexOf(name);
    const rowFor = (name) => dataRows.find((r) => r[col("Subcontractor Name")] === name);
    const compare = (bid, rankIndex) => {
      const r = rowFor(bid.subcontractorName);
      if (!r) return { found: false };
      const exclusions = bid.identifiedExclusions || [];
      const activeExclusions = exclusions.reduce((s, x) => (x.isWaived ? s : s + (x.costImpact || 0)), 0);
      const alternates = bid.valueEngineeringAlternates || [];
      const acceptedVe = alternates.reduce((s, x) => (x.isAccepted ? s + x.costDeduct : s), 0);
      const top = backendBids[0]?.leveledTotalCost ?? bid.leveledTotalCost;
      const expected = {
        Rank: `#${rankIndex + 1}`,
        "Subcontractor Name": bid.subcontractorName,
        "CSI Division": pkg.csiDivision,
        "Trade Package": pkg.tradeName,
        "Submitted Base Bid ($)": bid.baseBidAmount,
        "Scope Gaps / Exclusions Count": exclusions.length,
        "Total Scope Gap Cost ($)": activeExclusions,
        "Value Engineering Alternates Count": alternates.length,
        "Accepted VE Deduct ($)": acceptedVe,
        "Lead Time (Weeks)": bid.longLeadEquipmentWeeks,
        "Lead Time Penalty ($)": bid.leadTimePenalty,
        "ACORD 25 COI Status": bid.coiComplianceStatus,
        "COI Penalty ($)": bid.coiPenalty,
        "True Leveled Total Cost ($)": bid.leveledTotalCost,
        "Cost Variance vs Rank 1 ($)": rankIndex === 0 ? 0 : bid.leveledTotalCost - top,
        "Subcontract Status": bid.isAwarded ? "AWARDED" : "UNAWARDED",
      };
      const mismatches = [];
      for (const [k, v] of Object.entries(expected)) {
        const csvVal = r[col(k)];
        const numericKeys = [
          "Submitted Base Bid ($)", "Scope Gaps / Exclusions Count", "Total Scope Gap Cost ($)",
          "Value Engineering Alternates Count", "Accepted VE Deduct ($)", "Lead Time (Weeks)",
          "Lead Time Penalty ($)", "COI Penalty ($)", "True Leveled Total Cost ($)", "Cost Variance vs Rank 1 ($)",
        ];
        const matches = numericKeys.includes(k) ? Number(csvVal) === Number(v) : String(csvVal) === String(v);
        if (!matches) mismatches.push({ column: k, csv: csvVal, backend: v });
      }
      return { found: true, exact: mismatches.length === 0, mismatches };
    };
    out.assertions.rowCascade = compare(backendBids[0], 0);
    out.assertions.rowQuickflow = compare(backendBids[1], 1);
    out.assertions.rankOrderMatchesUi =
      dataRows[0]?.[col("Subcontractor Name")] === backendBids[0]?.subcontractorName &&
      dataRows[1]?.[col("Subcontractor Name")] === backendBids[1]?.subcontractorName;
    out.assertions.rowCount = dataRows.length;
    out.assertions.backendCount = backendBids.length;
  }
  await page.screenshot({ path: path.join(evidenceDir, "a7conv-a-step6-leveling.png") });
} catch (err) {
  out.error = String(err?.stack ?? err);
  console.error(err);
} finally {
  await browser.close();
}
await writeEvidence("a7conv-a-step6.json", out);
console.log(JSON.stringify({ assertions: out.assertions, headers: out.headers, rows: out.rows }, null, 2));