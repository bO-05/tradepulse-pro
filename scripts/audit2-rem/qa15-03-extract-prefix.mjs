/**
 * QA15 live UI: A13-03 canonical contractor name on the extract path.
 * Upload a quote whose parsed name is "<record> LLC", extract through the UI,
 * then verify stored bid, leveling card, CSV export, and contract all use the
 * canonical contractor-record name.
 */
import fs from "node:fs";
import path from "node:path";
import {
  attachDiagnostics,
  clickHeaderTab,
  delay,
  launchBrowser,
  selectProjectByTitle,
  waitForAppReady,
  shot,
} from "./qa6-lib.mjs";
import { BASE_URL } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, call } from "./qa15-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${detail}`);
};

const TMP_DIR = "C:/Users/user/AppData/Local/Temp/opencode";
const QUOTE_NAME = "AUDIT-QA15-Quote.txt";

async function statusText(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('[role="status"]')]
      .filter((e) => e.getBoundingClientRect().width > 0 && (e.innerText || "").trim());
    const el = els[els.length - 1];
    return el ? el.innerText.trim() : null;
  });
}

async function waitToast(page, pattern, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await statusText(page);
    if (t && pattern.test(t)) return t;
    await delay(300);
  }
  return await statusText(page);
}

async function waitBodyText(page, pattern, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ok = await page.evaluate((p) => new RegExp(p).test(document.body.innerText), pattern.source);
    if (ok) return true;
    await delay(300);
  }
  return false;
}

async function clickFileRowButton(page, fileName, titleOrText) {
  return page.evaluate(
    ({ fileName, titleOrText }) => {
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      const h = [...document.querySelectorAll("h4")].find((x) => (x.innerText || "").includes(fileName) && vis(x));
      if (!h) return { ok: false, reason: "file header not found" };
      let node = h;
      for (let i = 0; i < 6 && node; i++) {
        if (node.querySelector && node.querySelector("button")) break;
        node = node.parentElement;
      }
      const btns = [...(node ? node.querySelectorAll("button") : [])];
      const btn =
        btns.find((b) => (b.getAttribute("title") || "") === titleOrText) ||
        btns.find((b) => (b.innerText || "").includes(titleOrText));
      if (!btn) return { ok: false, reason: "button not found", buttons: btns.map((b) => `${b.getAttribute("title")}|${b.innerText.trim()}`) };
      btn.scrollIntoView({ block: "center" });
      btn.click();
      return { ok: true, title: btn.getAttribute("title") };
    },
    { fileName, titleOrText }
  );
}

async function selectScopingPackage(page, packageName) {
  return page.evaluate((name) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const cards = [...document.querySelectorAll("main div")].filter(
      (d) => vis(d) && (d.innerText || "").includes(name) && d.querySelector("button")
    );
    const card = cards.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!card) return { ok: false, reason: "card not found" };
    const b = [...card.querySelectorAll("button")].find((x) => /Inspect Package|Active Package/.test(x.innerText || ""));
    if (!b) return { ok: false, reason: "select button not found" };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, label: (b.innerText || "").trim() };
  }, packageName);
}

async function switchLevelingPackage(page, packageName) {
  const res = await page.evaluate((name) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const b = [...document.querySelectorAll("main button[aria-pressed]")].find((x) => vis(x) && (x.innerText || "").includes(name));
    if (!b) return { ok: false };
    b.click();
    return { ok: true, text: (b.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80) };
  }, packageName);
  await delay(1600);
  return res;
}

async function main() {
  const prefixName = F.prefix.contractorName;
  const parsedName = F.prefix.parsedName;

  // ---- pre-purge previous run artifacts on the prefix package
  {
    const bids = (await c.query("bids:listByPackage", { tradePackageId: F.prefix.packageId })) || [];
    for (const b of bids) {
      if (b.isAwarded) {
        try { await c.mutation("bids:unawardContract", { bidId: b._id, tradePackageId: F.prefix.packageId }); } catch (err) { say(`prepurge unaward failed: ${err?.data ?? err?.message}`); }
      }
      try { await c.mutation("bids:deleteBid", { bidId: b._id }); } catch (err) { say(`prepurge deleteBid failed: ${err?.data ?? err?.message ?? err}`); }
    }
    const files = (await c.query("files:listFilesByProject", { projectId: F.mainProjectId })) || [];
    for (const f of files) {
      if (f.tradePackageId === F.prefix.packageId) {
        try { await c.mutation("files:deleteFile", { fileId: f._id }); } catch (err) { say(`prepurge deleteFile failed: ${err?.data ?? err?.message ?? err}`); }
      }
    }
    say(`prepurge done: bids=${bids.length} files=${files.length}`);
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });
  const quotePath = path.join(TMP_DIR, QUOTE_NAME);
  fs.writeFileSync(
    quotePath,
    [
      "SUBCONTRACTOR PROPOSAL AND QUOTATION",
      `Prepared By: ${parsedName}`,
      "Base Bid Price: $780,000.00",
      "Division 27 Communications: structured cabling, racks, and pathway infrastructure.",
      "Exclusions: firestopping by GC.",
    ].join("\n"),
    "utf8"
  );

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, F.mainProjectTitle);
  await delay(2400);

  await clickHeaderTab(page, "01: CSI Scoping");
  await delay(1800);
  const selectedPkg = await selectScopingPackage(page, F.prefix.packageName);
  await delay(1000);
  say(`selected scoping package: ${JSON.stringify(selectedPkg)}`);

  await page.select('select[aria-label="Document type for upload"]', "quote_pdf");
  const input = await page.$("#convex-file-upload");
  if (!input) throw new Error("file input not found");
  await input.uploadFile(quotePath);
  const uploadBanner = await waitBodyText(page, /Successfully uploaded \d+ file\(s\) to Convex Storage/i, 30000);
  await delay(1500);
  const rowAppeared = await page.evaluate((n) => document.body.innerText.includes(n), QUOTE_NAME);
  record("A13-03-upload-quote", uploadBanner && rowAppeared, `banner=${uploadBanner}; row=${rowAppeared}`);

  const extractClick = await clickFileRowButton(page, QUOTE_NAME, "Extract & Level Bid");
  const extractToast = await waitToast(page, /Forensically extracted and leveled|extracted and normalized|Bid extraction failed|extraction failed/i, 200000);
  await shot(page, "fix4-qa15-A13-03-extract.png");
  const extractFailed = /failed/i.test(extractToast || "");
  say(`extract click=${JSON.stringify(extractClick)}; toast=${JSON.stringify(extractToast)}`);

  const files = (await c.query("files:listFilesByProject", { projectId: F.mainProjectId })) || [];
  const quoteFile = files.find((f) => f.fileName === QUOTE_NAME && f.tradePackageId === F.prefix.packageId);
  const bids = (await c.query("bids:listByPackage", { tradePackageId: F.prefix.packageId })) || [];
  const bid = quoteFile ? bids.find((b) => b.sourceFileId === quoteFile._id) || bids[0] || null : bids[0] || null;
  const contractors = (await c.query("contractors:listByPackage", { tradePackageId: F.prefix.packageId })) || [];
  const recordCtr = contractors.find((x) => x._id === F.prefix.contractorId) || null;
  record(
    "A13-03-stored-bid-name-is-canonical",
    !extractFailed &&
      Boolean(bid) &&
      bid.contractorId === F.prefix.contractorId &&
      bid.subcontractorName === prefixName,
    `extractFailed=${extractFailed}; bidName=${JSON.stringify(bid ? bid.subcontractorName : null)}; recordName=${JSON.stringify(recordCtr ? recordCtr.companyName : prefixName)}; contractorId=${bid ? bid.contractorId : null}; linked=${bid ? bid.contractorId === F.prefix.contractorId : false}; rawProposalHead=${JSON.stringify((bid && bid.rawProposalText ? bid.rawProposalText : "").slice(0, 60))}`
  );

  // ---- leveling card + CSV (UI)
  await clickHeaderTab(page, "04: Bid Leveling");
  await delay(2000);
  const switched = await switchLevelingPackage(page, F.prefix.packageName);
  const levelingProbe = await page.evaluate((needle) => ({
    hasCanonical: document.body.innerText.includes(needle),
    hasParsedName: document.body.innerText.includes(`${needle} LLC`),
    bodyLen: document.body.innerText.length,
  }), prefixName);
  await page.evaluate(() => {
    const orig = URL.createObjectURL;
    window.__qa15CsvBlob = null;
    URL.createObjectURL = function (blob) {
      window.__qa15CsvBlob = blob;
      return orig.call(URL, blob);
    };
  });
  const csvClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "") === "Export full ADR-0003 leveling matrix to CSV");
    if (!b) return false;
    b.scrollIntoView({ block: "center" });
    b.click();
    return true;
  });
  await delay(900);
  const csvText = await page.evaluate(async () => {
    if (!window.__qa15CsvBlob) return null;
    try {
      return await window.__qa15CsvBlob.text();
    } catch (err) {
      return `ERR:${String(err)}`;
    }
  });
  await shot(page, "fix4-qa15-A13-03-leveling-csv.png");
  const csvOk =
    typeof csvText === "string" &&
    csvText.includes(prefixName) &&
    !csvText.toLowerCase().includes(`${prefixName} llc`.toLowerCase());
  record(
    "A13-03-leveling-card-and-csv-canonical",
    switched.ok && levelingProbe.hasCanonical && !levelingProbe.hasParsedName && csvClick && csvOk,
    `switch=${JSON.stringify(switched)}; leveling=${JSON.stringify(levelingProbe)}; csvClick=${csvClick}; csvLen=${csvText ? csvText.length : null}; csvOk=${csvOk}; csvHead=${JSON.stringify((csvText || "").split("\n").slice(0, 3))}`
  );

  // ---- contract (backend award after extraction, then register row)
  const gen = await call("generate agreement for extracted bid", () =>
    c.mutation("agreements:generateAgreement", { bidId: bid._id, tradePackageId: F.prefix.packageId })
  );
  const award = await call("award extracted bid", () =>
    c.mutation("bids:awardContract", { bidId: bid._id, tradePackageId: F.prefix.packageId })
  );
  await delay(1500);
  const agr = ((await c.query("agreements:listAgreements", { projectId: F.mainProjectId })) || []).find((a) => a.bidId === bid._id) || null;
  const contractCanonical =
    Boolean(agr) &&
    agr.subcontractorName === prefixName &&
    agr.contractText.includes(prefixName) &&
    !agr.contractText.toLowerCase().includes(`${prefixName} llc`.toLowerCase());

  let contractRow = null;
  if (agr) {
    await clickHeaderTab(page, "06: Subcontracts");
    await delay(2400);
    contractRow = await page.evaluate((agrNo) => {
      const rows = [...document.querySelectorAll("main tr")].filter((tr) => (tr.innerText || "").includes(agrNo));
      const row = rows[0];
      return row ? (row.innerText || "").replace(/\s+/g, " ").slice(0, 260) : null;
    }, agr.agreementNumber);
  }
  record(
    "A13-03-contract-canonical-name",
    gen.ok &&
      award.ok &&
      contractCanonical &&
      typeof contractRow === "string" &&
      contractRow.includes(prefixName) &&
      !contractRow.toLowerCase().includes(`${prefixName} llc`.toLowerCase()),
    `gen=${gen.ok}; award=${award.ok}; agreement=${agr ? agr.agreementNumber : null}; agrName=${JSON.stringify(agr ? agr.subcontractorName : null)}; contractHasCanonical=${agr ? agr.contractText.includes(prefixName) : null}; contractHasParsed=${agr ? agr.contractText.toLowerCase().includes(`${prefixName} llc`.toLowerCase()) : null}; row=${JSON.stringify(contractRow)}`
  );

  const diagnostics = {
    consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 200)),
    pageErrors: diag.pageErrors.slice(0, 10),
    pageErrorCount: diag.pageErrors.length,
    failedRequests: diag.failedRequests.slice(0, 10),
  };
  say(`diagnostics: ${JSON.stringify({ consoleErrors: diagnostics.consoleErrors.length, pageErrors: diagnostics.pageErrorCount })}`);

  writeEvidence("extract-prefix", {
    results,
    parsedName,
    prefixName,
    selectedPkg,
    upload: { uploadBanner, rowAppeared },
    extract: { extractClick, extractToast, fileId: quoteFile ? quoteFile._id : null, bidId: bid ? bid._id : null, bidName: bid ? bid.subcontractorName : null },
    levelingProbe,
    csv: { csvClick, csvLen: csvText ? csvText.length : null, csvOk, head: (csvText || "").split("\n").slice(0, 3) },
    agreement: agr ? { id: agr._id, number: agr.agreementNumber, subcontractorName: agr.subcontractorName, status: agr.status } : null,
    contractRow,
    diagnostics,
  });
  writeLog("extract-prefix", log);
  console.log(`\nresults: ${results.filter((r) => r.pass).length}/${results.length} passed`);
  await browser.close();
  try { fs.unlinkSync(quotePath); } catch {}
}

main().catch(async (e) => {
  console.error(e);
  writeLog("extract-prefix-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});