/**
 * QA9 Journey 5: file workflows — upload spec/quote txt, Auto-Scope from spec file,
 * Extract & Level from quote file, download + inspect, delete one file.
 * Evidence: evidence/fix4-qa9-j5-*.json + fix4-qa9-j5-downloads/
 */
import fs from "node:fs";
import path from "node:path";
import {
  client, launchBrowser, attachDiagnostics, diagnosticsSummary, waitForAppReady, delay,
  selectProjectByTitle, clickByText, tmpFile, shot, writeEvidence, EVIDENCE_DIR, FIXTURE_TAG,
} from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J5-FILES`;
const log = []; const problems = [];
const step = (s) => { log.push(s); console.log("STEP:", s); };

for (const p of (await c.query("projects:listProjects", {})).filter((x) => x.title === PROJECT)) {
  try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
}
const projId = await c.mutation("projects:createProject", {
  title: PROJECT, location: "Portland, OR", projectType: "Commercial Lab",
  estBudget: 2600000, targetCompletionWeeks: 44, specDocumentText: "QA9 J5 fixture.", isDemoProject: false,
});
const pkgSeed = await c.mutation("tradePackages:createTradePackage", {
  projectId: projId, csiDivision: "26 00 00", tradeName: "QA9 J5 Electrical Seed",
  budgetEstimate: 800000, scopeSummary: "Seed package for file extraction.",
  mandatoryInclusions: ["Seismic bracing"], bidDeadline: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
});
const SPEC_TEXT = [
  "SECTION 03 30 00 CAST-IN-PLACE CONCRETE: footings, slab-on-grade, elevated decks.",
  "SECTION 04 20 00 UNIT MASONRY: CMU core walls and brick veneer.",
  "SECTION 05 12 00 STRUCTURAL STEEL: moment frames, metal deck, fireproofing.",
  "SECTION 23 00 00 HVAC: rooftop AHUs, VAV boxes, BACnet controls.",
  "SECTION 26 00 00 ELECTRICAL: switchgear, emergency lighting, fire alarm.",
].join("\n");
const QUOTE_TEXT = [
  "SUBCONTRACTOR PROPOSAL",
  "Subcontractor: QA9 J5 File Electric",
  "Base Bid: $742,000",
  "Lead Time: 11 weeks",
  "COI Compliance: compliant",
  "EXCLUSIONS:",
  "- Crane hoisting and rigging to penthouse: $48,000",
  "- UL 1479 firestopping: $21,000",
].join("\n");
const specPath = tmpFile("QA9_J5_Spec.txt", SPEC_TEXT);
const quotePath = tmpFile("QA9_J5_Quote.txt", QUOTE_TEXT);

const result = { journey: "J5", ids: { projectId: projId, pkgSeed }, steps: log, data: {} };
const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
const files = async () => c.query("files:listFilesByProject", { projectId: projId });
const packages = async () => c.query("tradePackages:listByProject", { projectId: projId });
const bids = async () => c.query("bids:listAllProjectBids", { projectId: projId });

async function clickFileRowButton(fileName, title) {
  const hit = await page.evaluate((fn, t) => {
    const rows = [...document.querySelectorAll("div")]
      .filter((d) => (d.textContent || "").includes(fn) && d.querySelector(`button[title="${t}"]`))
      .sort((a, b) => a.textContent.length - b.textContent.length);
    const row = rows[0];
    if (!row) return { ok: false };
    const b = row.querySelector(`button[title="${t}"]`);
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, fileName, title);
  if (hit.ok) await page.mouse.click(hit.x, hit.y);
  return hit;
}

try {
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, PROJECT);
  await delay(1500);
  await page.keyboard.press("Digit1");
  await page.waitForSelector('select[aria-label="Document type for upload"]', { timeout: 15000 });
  await delay(600);

  // upload spec
  await page.evaluate(() => {
    const s = document.querySelector('select[aria-label="Document type for upload"]');
    s.value = "spec"; s.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await (await page.$("#convex-file-upload")).uploadFile(specPath);
  await delay(4000);
  // upload quote
  await page.evaluate(() => {
    const s = document.querySelector('select[aria-label="Document type for upload"]');
    s.value = "quote_pdf"; s.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await (await page.$("#convex-file-upload")).uploadFile(quotePath);
  await delay(4000);
  let fList = await files();
  result.data.uploaded = fList.map((f) => ({ name: f.fileName, type: f.fileType, size: f.fileSize, hasText: Boolean(f.textContent) }));
  step(`uploaded files=${JSON.stringify(result.data.uploaded)}`);
  if (!fList.some((f) => f.fileName === "QA9_J5_Spec.txt")) problems.push({ id: "A9-70", sev: "High", title: "Spec .txt upload did not create a file record" });
  if (!fList.some((f) => f.fileName === "QA9_J5_Quote.txt")) problems.push({ id: "A9-71", sev: "High", title: "Quote .txt upload did not create a file record" });
  const emptySize = fList.filter((f) => !f.fileSize || f.fileSize <= 0);
  if (emptySize.length) problems.push({ id: "A9-72", sev: "Medium", title: "Uploaded file has zero size in register", detail: JSON.stringify(emptySize.map((f) => f.fileName)) });
  await shot(page, "fix4-qa9-j5-uploaded.png");

  // auto-scope from spec file
  const pkgCountBefore = (await packages()).length;
  const scopeClick = await clickFileRowButton("QA9_J5_Spec.txt", "Parse CSI specification and generate trade packages with dynamic inboxes");
  const scoped = await (async () => {
    const start = Date.now();
    while (Date.now() - start < 170000) {
      const list = await packages();
      if (list.length > pkgCountBefore) return list;
      await delay(4000);
    }
    return null;
  })();
  result.data.autoScope = { click: scopeClick, before: pkgCountBefore, after: scoped ? scoped.length : null, created: scoped ? scoped.slice(pkgCountBefore).map((p) => `${p.csiDivision} ${p.tradeName}`) : null };
  step(`auto-scope ${JSON.stringify(result.data.autoScope)}`);
  if (!scoped) problems.push({ id: "A9-73", sev: "High", title: "Auto-Scope Packages from spec file created nothing in 170s" });
  await shot(page, "fix4-qa9-j5-scoped.png");

  // extract & level from quote file
  const bidCountBefore = (await bids()).length;
  const extractClick = await clickFileRowButton("QA9_J5_Quote.txt", "Forensically extract line items, fine-print exclusions, and level into matrix");
  const extracted = await (async () => {
    const start = Date.now();
    while (Date.now() - start < 170000) {
      const list = await bids();
      if (list.length > bidCountBefore) return list;
      await delay(4000);
    }
    return null;
  })();
  result.data.extract = { click: extractClick, before: bidCountBefore, after: extracted ? extracted.length : null, bid: extracted ? extracted.map((b) => ({ name: b.subcontractorName, base: b.baseBidAmount, leveled: b.leveledTotalCost, exclusions: (b.identifiedExclusions || []).length })) : null };
  step(`extract ${JSON.stringify(result.data.extract)}`);
  if (!extracted) problems.push({ id: "A9-74", sev: "High", title: "Extract & Level Bid from quote file produced no bid in 170s" });
  await shot(page, "fix4-qa9-j5-extracted.png");

  // downloads
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa9-j5-downloads");
  fs.mkdirSync(dlDir, { recursive: true });
  const cdp = await page.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir, eventsEnabled: true });
  for (const [name, expect] of [["QA9_J5_Spec.txt", SPEC_TEXT], ["QA9_J5_Quote.txt", QUOTE_TEXT]]) {
    await clickFileRowButton(name, "Download file from Convex Storage");
    await delay(2500);
    const saved = fs.existsSync(path.join(dlDir, name)) ? fs.readFileSync(path.join(dlDir, name), "utf8") : null;
    result.data[`download_${name}`] = saved == null ? null : { bytes: saved.length, matches: saved.includes(expect.split("\n")[0].slice(0, 30)) };
    step(`download ${name}: ${JSON.stringify(result.data[`download_${name}`])}`);
    if (saved == null) problems.push({ id: "A9-75", sev: "Medium", title: `Download control produced no file for ${name}` });
    else if (!result.data[`download_${name}`].matches) problems.push({ id: "A9-76", sev: "Medium", title: `Downloaded ${name} content mismatch`, detail: saved.slice(0, 120) });
  }

  // delete the quote file
  const del = await clickFileRowButton("QA9_J5_Quote.txt", "Delete file from storage");
  await delay(700);
  const delConfirm = await clickByText(page, "Delete file", { exact: true });
  await delay(3000);
  fList = await files();
  const gone = !fList.some((f) => f.fileName === "QA9_J5_Quote.txt");
  result.data.delete = { open: del, confirm: delConfirm, gone, remaining: fList.map((f) => f.fileName) };
  step(`delete quote: gone=${gone} remaining=${JSON.stringify(result.data.delete.remaining)}`);
  if (!gone) problems.push({ id: "A9-77", sev: "Medium", title: "Delete file did not remove the record" });
  await shot(page, "fix4-qa9-j5-deleted.png");
  result.console = diagnosticsSummary(diag);
} catch (err) {
  problems.push({ id: "A9-90", sev: "High", title: "J5 crashed: " + (err?.message ?? String(err)).split("\n")[0] });
  await shot(page, "fix4-qa9-j5-crash.png").catch(() => {});
} finally {
  result.findings = problems;
  result.verdict = problems.some((p) => p.sev === "High") ? "blocked" : problems.length ? "complete-with-issues" : "complete";
  writeEvidence("j5-files", result);
  await browser.close();
}
console.log(`J5 verdict=${result.verdict} findings=${problems.length}`);