/**
 * QA17-03: A16-01 UTC-labeled legal dates.
 * Backend: generateAgreement contractText, syncAgreementForBid rewrite, addendum issuance date,
 * and the alternate runFullProcurementCycle generator (gap hunt).
 * UI: contracts register viewer + txt download for the same agreement.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, longDateUtc, utcDate, EVIDENCE_DIR } from "./qa17-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${JSON.stringify(detail).slice(0, 400)}`);
};

const utcToday = utcDate(new Date());
const utcLong = longDateUtc(utcToday);
const EXPECTED = `${utcLong} (UTC)`;

function dateAudit(text) {
  const madeAsOf = text.match(/AGREEMENT made as of the ([^.\n]+)\./i);
  const bare = (text.match(new RegExp(utcLong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?! \\(UTC\\))", "g")) || []).length;
  const labeled = (text.match(new RegExp(utcLong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\(UTC\\)", "g")) || []).length;
  const signatureDates = (text.match(new RegExp("Date: " + utcLong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\(UTC\\)", "g")) || []).length;
  return { madeAsOf: madeAsOf ? madeAsOf[1].trim() : null, labeledOccurrences: labeled, bareOccurrences: bare, signatureDates };
}

async function main() {
  // --- create a dedicated bidder/agreement on package short5 ---
  const pkgId = F.name.packages.short5;
  const ctrId = await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName: "AUDIT-QA17 Date Probe Bidder",
    contactEmail: "qa17.date@qa17.invalid",
    phone: "+1 (212) 555-0188",
    licenseNumber: "NY-QA17-DATE",
    licenseStatus: "Active / Verified (QA17)",
    sourceUrl: "https://qa17.example.invalid/date",
    rfqStatus: "invited",
  });
  const bidRes = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId,
    contractorId: ctrId,
    subcontractorName: "AUDIT-QA17 Date Probe Bidder",
    baseBidAmount: 125_000,
    lineItems: [{ item: "QA17 date probe", unit: "LS", quantity: 1, unitCost: 125_000, totalCost: 125_000 }],
    identifiedExclusions: [],
    valueEngineeringAlternates: [],
    longLeadEquipmentWeeks: 3,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  });

  const agr = await c.mutation("agreements:generateAgreement", { bidId: bidRes.bidId, tradePackageId: pkgId });
  const genAudit = dateAudit(agr.contractText);
  record("A16-01.contractText-explicit-UTC", genAudit.madeAsOf === EXPECTED && genAudit.labeledOccurrences >= 1 && genAudit.bareOccurrences === 0 && genAudit.signatureDates >= 2, { agreementNumber: agr.agreementNumber, expected: EXPECTED, ...genAudit });

  // --- syncAgreementForBid rewrite path (adjustments) ---
  await c.mutation("bids:updateBidAdjustments", {
    bidId: bidRes.bidId,
    identifiedExclusions: [],
    valueEngineeringAlternates: [],
    coiComplianceStatus: "compliant",
  });
  const agrs1 = (await c.query("agreements:listAgreements", { projectId: F.name.id })) || [];
  const synced = agrs1.find((a) => a._id === agr._id);
  const syncAudit = dateAudit(synced.contractText);
  record("A16-01.sync-rewrite-keeps-UTC", syncAudit.madeAsOf === EXPECTED && syncAudit.bareOccurrences === 0, { ...syncAudit });

  // --- addendum issuance date ---
  let addendum = null;
  try {
    const res = await c.action("files:generatePreBidAddendum", { projectId: F.name.id });
    const hasLabeled = res.addendumText.includes(`Issuance Date:** ${EXPECTED}`);
    const bare = (res.addendumText.match(new RegExp(utcLong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?! \\(UTC\\))", "g")) || []).length;
    addendum = { success: res.success, fileName: res.fileName, hasLabeled, bare, head: res.addendumText.slice(0, 260) };
  } catch (err) {
    addendum = { error: String(err?.data ?? err?.message ?? err) };
  }
  record("A16-01.addendum-UTC", Boolean(addendum.success) && addendum.hasLabeled === true && addendum.bare === 0, addendum);

  // --- alternate generator: runFullProcurementCycle (touched-area hunt) ---
  let simulation = null;
  try {
    const res = await c.mutation("simulation:runFullProcurementCycle", { projectId: F.name.id, tradePackageId: F.name.packages.short3 });
    await delay(1200);
    const agrs2 = (await c.query("agreements:listAgreements", { projectId: F.name.id })) || [];
    const simAgr = agrs2.find((a) => a._id === res.agreementId);
    const simAudit = simAgr ? dateAudit(simAgr.contractText) : null;
    simulation = { ok: true, agreementId: res.agreementId, agreementNumber: simAgr ? simAgr.agreementNumber : null, ...simAudit };
  } catch (err) {
    simulation = { ok: false, error: String(err?.data ?? err?.message ?? err) };
  }
  record("A16-01.alternate-simulation-generator-UTC", simulation.ok && simulation.madeAsOf === EXPECTED && simulation.bareOccurrences === 0, simulation);

  // --- UI viewer + download ---
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa17-downloads");
  fs.mkdirSync(dlDir, { recursive: true });
  for (const f of fs.readdirSync(dlDir)) fs.unlinkSync(path.join(dlDir, f));

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
  const ui = {};
  try {
    await page.goto(`https://brainy-skunk-440.convex.site/?project=${F.name.id}&tab=contracts&qa17=date`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(900);

    const rowClick = await page.evaluate((num) => {
      const trs = [...document.querySelectorAll("tr")];
      const tr = trs.find((t) => (t.innerText || "").includes(num));
      if (!tr) return { ok: false, reason: "row not found" };
      const btn = [...tr.querySelectorAll("button")].find((b) => (b.innerText || "").includes("Inspect Draft"));
      if (!btn) return { ok: false, reason: "inspect not found" };
      btn.scrollIntoView({ block: "center" });
      btn.click();
      return { ok: true };
    }, agr.agreementNumber);
    await delay(1000);
    const viewer = await page.evaluate((expected) => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.innerText || "").includes("A401-style Subcontract Draft"));
      const text = dlg ? dlg.innerText : "";
      const m = text.match(/AGREEMENT made as of the ([^.\n]+)\./i);
      return {
        found: Boolean(dlg),
        docDate: m ? m[1].trim() : null,
        hasExpected: text.includes(expected),
        hasDownloadButton: Boolean(dlg && [...dlg.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "").includes("Download"))),
      };
    }, EXPECTED);
    await shot(page, "fix4-qa17-contract-viewer.png");

    let download = null;
    if (viewer.found) {
      await page.evaluate(() => {
        const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.innerText || "").includes("A401-style Subcontract Draft"));
        const b = dlg && [...dlg.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Download"));
        b?.click();
      });
      for (let i = 0; i < 20; i++) {
        await delay(400);
        const files = fs.existsSync(dlDir) ? fs.readdirSync(dlDir).filter((f) => f.endsWith(".txt")) : [];
        if (files.length) {
          const p = path.join(dlDir, files[files.length - 1]);
          const content = fs.readFileSync(p, "utf8");
          const audit = dateAudit(content);
          download = { file: files[files.length - 1], expected: EXPECTED, ...audit, pass: audit.madeAsOf === EXPECTED && audit.bareOccurrences === 0 && content.length > 1000 };
          break;
        }
      }
    }
    ui.viewer = viewer;
    ui.download = download;
    ui.click = rowClick;
    ui.pageErrors = diag.pageErrors.slice(0, 5);
    ui.consoleErrors = diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 160)).slice(0, 5);
    record("A16-01.viewer-explicit-UTC", viewer.found && viewer.docDate === EXPECTED && viewer.hasExpected, viewer);
    record("A16-01.download-explicit-UTC", Boolean(download && download.pass), download);
  } finally {
    await browser.close();
  }

  writeEvidence("contract-date", {
    capturedAt: new Date().toISOString(),
    utcToday,
    expected: EXPECTED,
    agreement: { id: agr._id, number: agr.agreementNumber, createdAtUtc: new Date(agr.createdAt).toISOString() },
    generation: genAudit,
    syncRewrite: syncAudit,
    addendum,
    simulation,
    ui,
    results,
  });
  writeLog("contract-date", log);
  console.log(`results: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("contract-date-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});