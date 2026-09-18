/**
 * QA8 focused recheck — Project Files truthfulness (correct status-banner capture)
 * and fresh-project Audit empty state.
 * Fixture: AUDIT-QA8-files-2026-09-18.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachDiagnostics, clickHeaderTab, delay, gotoDemo, launchBrowser, selectProjectByTitle, writeJson } from "./qa6-lib.mjs";
import { shot } from "./lib.mjs";
import { client, fixtureName, writeEvidence } from "./qa8-lib.mjs";

const c = client();
const prefix = fixtureName("files");
const out = { ranAt: new Date().toISOString(), checks: [], files: {}, audit: {} };
const checks = [];
const addCheck = (id, label, ok, observed) => {
  checks.push({ id, label, ok, observed: String(observed).slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id} ${label} :: ${String(observed).slice(0, 220)}`);
};

const tmpDir = path.join(os.tmpdir(), "opencode", "qa8-files2");
fs.mkdirSync(tmpDir, { recursive: true });
const files = {
  normal: path.join(tmpDir, "AUDIT-QA8-normal-spec.txt"),
  fakePdf: path.join(tmpDir, "AUDIT-QA8-quote-proposal.pdf"),
  wrongTxt: path.join(tmpDir, "AUDIT-QA8-coi.txt"),
  exe: path.join(tmpDir, "AUDIT-QA8-unsupported.exe"),
};
fs.writeFileSync(files.normal, "Division 26 00 00 Electrical specification for QA8 verification.\n", "utf8");
fs.writeFileSync(files.fakePdf, "This is plain text content stored inside a .pdf-named file for QA8.\n", "utf8");
fs.writeFileSync(files.wrongTxt, "QA8 text file that must not pass as an ACORD 25 COI certificate.\n", "utf8");
fs.writeFileSync(files.exe, "MZ qa8 unsupported binary placeholder\n", "utf8");

const bannerText = async (page) => {
  return page.evaluate(() => {
    const banners = [...document.querySelectorAll("div")].filter((d) => {
      const t = d.innerText?.trim() || "";
      return /^(Successfully uploaded|Upload failed:|File deleted from storage\.|Delete failed:|Upload unavailable)/.test(t) && d.children.length <= 3;
    });
    return banners.length ? banners[0].innerText.trim().replace(/\s+/g, " ").slice(0, 240) : null;
  });
};
const waitBanner = async (page, re, ms = 12000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const t = await bannerText(page);
    if (t && re.test(t)) return t;
    await delay(300);
  }
  return await bannerText(page);
};

let projectId;
try {
  projectId = await c.mutation("projects:createProject", {
    title: prefix,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 400_000,
    targetCompletionWeeks: 20,
    specDocumentText: "QA8 files fixture.",
    isDemoProject: false,
  });
  await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: "26 00 00",
    tradeName: "QA8 Files Electrical",
    budgetEstimate: 400_000,
    scopeSummary: "QA8 files scope.",
    mandatoryInclusions: ["Code compliance"],
    bidDeadline: "2026-10-31",
  });
  out.fixture = { projectId };

  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diagnostics = attachDiagnostics(page);
  try {
    await gotoDemo(page);
    await selectProjectByTitle(page, prefix);
    await delay(1800);
    await clickHeaderTab(page, "Live Activity Audit");
    await delay(1800);
    const auditText = await page.evaluate(() => document.body.innerText);
    out.audit.freshProjectText = auditText.slice(0, 1200);
    const empty = /No activity records in audit stream yet\./.test(auditText);
    const eventCount = (auditText.match(/Activity Events \((\d+)\)/) || [])[1] ?? null;
    out.audit.empty = empty;
    out.audit.eventCount = eventCount;
    await shot(page, "fix4-qa8-32-audit-fresh.png");
    addCheck("R-AUDIT-1", "fresh Convex project shows empty audit state", empty, `empty=${empty} count=${eventCount}`);

    await clickHeaderTab(page, "01: CSI Scoping");
    await delay(1200);

    // normal txt as spec
    await page.select('select[aria-label="Document type for upload"]', "spec");
    await (await page.$("#convex-file-upload")).uploadFile(files.normal);
    const okMsg = await waitBanner(page, /Successfully uploaded/);
    await delay(600);
    const recs = await c.query("files:listFilesByProject", { projectId });
    out.files.normalMsg = okMsg;
    out.files.normalRecord = recs.find((f) => f.fileName === "AUDIT-QA8-normal-spec.txt") ?? null;
    addCheck("R-FILES-1", "txt spec upload succeeds and persists", /Successfully uploaded/.test(okMsg || "") && !!out.files.normalRecord, `msg=${okMsg} persisted=${!!out.files.normalRecord}`);

    // preview + download + delete
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("div")].find((d) => d.innerText?.startsWith("AUDIT-QA8-normal-spec.txt"));
      const btn = row && [...row.querySelectorAll("button")].find((b) => b.getAttribute("title") === "Preview authentic specification/document text");
      if (btn) btn.click();
    });
    await delay(700);
    const preview = await page.evaluate(() => {
      const text = document.body.innerText;
      return { open: text.includes("Close document preview"), hasBodyText: text.includes("Electrical specification for QA8 verification") };
    });
    await shot(page, "fix4-qa8-32-files-preview.png");
    await page.keyboard.press("Escape");
    await delay(400);
    addCheck("R-FILES-2", "txt preview shows stored content", preview.open && preview.hasBodyText, JSON.stringify(preview));

    const downloadDir = path.resolve("evidence", "fix4-qa8-downloads");
    fs.mkdirSync(downloadDir, { recursive: true });
    const cdp = await page.createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir, eventsEnabled: true });
    const names = [];
    cdp.on("Browser.downloadWillBegin", (e) => names.push(e.suggestedFilename));
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("div")].find((d) => d.innerText?.startsWith("AUDIT-QA8-normal-spec.txt"));
      const btn = row && [...row.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "").startsWith("Download"));
      if (btn) btn.click();
    });
    await delay(1400);
    out.files.downloadNames = names;
    addCheck("R-FILES-3", "download keeps stored file name", names.includes("AUDIT-QA8-normal-spec.txt"), JSON.stringify(names));

    await page.evaluate(() => {
      const row = [...document.querySelectorAll("div")].find((d) => d.innerText?.startsWith("AUDIT-QA8-normal-spec.txt"));
      const btn = row && [...row.querySelectorAll("button")].find((b) => b.getAttribute("title") === "Delete file from storage");
      if (btn) btn.click();
    });
    await delay(500);
    await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="alertdialog"]')].filter((e) => e.getBoundingClientRect().width > 0).pop();
      const b = dlg && [...dlg.querySelectorAll("button")].find((x) => /Delete file/.test(x.innerText));
      if (b) b.click();
    });
    const delMsg = await waitBanner(page, /File deleted|Delete failed/);
    await delay(800);
    const after = await c.query("files:listFilesByProject", { projectId });
    out.files.deleteMsg = delMsg;
    addCheck(
      "R-FILES-4",
      "delete removes record and reports truthfully",
      !after.some((f) => f.fileName === "AUDIT-QA8-normal-spec.txt") && /File deleted from storage\./.test(delMsg || ""),
      `msg=${delMsg} gone=${!after.some((f) => f.fileName === "AUDIT-QA8-normal-spec.txt")}`
    );

    // wrong type: coi + txt
    await page.select('select[aria-label="Document type for upload"]', "coi_certificate");
    await (await page.$("#convex-file-upload")).uploadFile(files.wrongTxt);
    const wrongMsg = await waitBanner(page, /must use|Upload failed|Successfully uploaded/);
    out.files.wrongTypeMsg = wrongMsg;
    addCheck("R-FILES-5", "txt rejected for ACORD COI with specific message", /must use \.pdf/i.test(wrongMsg || ""), wrongMsg);

    // unsupported exe
    await page.select('select[aria-label="Document type for upload"]', "spec");
    await (await page.$("#convex-file-upload")).uploadFile(files.exe);
    const exeMsg = await waitBanner(page, /upload PDF|Upload failed|Successfully uploaded/);
    out.files.exeMsg = exeMsg;
    addCheck("R-FILES-6", "unsupported .exe rejected with specific message", /upload PDF, DWG, DXF, or TXT/i.test(exeMsg || ""), exeMsg);

    // oversize synthetic
    const beforeReqs = diagnostics.requests.length;
    const overMsg = await page.evaluate(async () => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(51 * 1024 * 1024)], "AUDIT-QA8-oversize.txt", { type: "text/plain" }));
      const input = document.querySelector("#convex-file-upload");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1800));
      const banners = [...document.querySelectorAll("div")].filter((d) => /Upload failed:|Successfully uploaded/.test(d.innerText || "") && d.children.length <= 3);
      return banners.length ? banners[0].innerText.trim().replace(/\s+/g, " ").slice(0, 240) : null;
    });
    await delay(600);
    out.files.overMsg = overMsg;
    addCheck("R-FILES-7", "51MB rejected client-side before network", /50 MB/i.test(overMsg || "") && diagnostics.requests.length === beforeReqs, `msg=${overMsg} reqDelta=${diagnostics.requests.length - beforeReqs}`);

    // fake pdf content-vs-extension
    await page.select('select[aria-label="Document type for upload"]', "quote_pdf");
    await (await page.$("#convex-file-upload")).uploadFile(files.fakePdf);
    const pdfMsg = await waitBanner(page, /Successfully uploaded|Upload failed/);
    const fakeRec = (await c.query("files:listFilesByProject", { projectId })).find((f) => f.fileName === "AUDIT-QA8-quote-proposal.pdf");
    out.files.pdfMsg = pdfMsg;
    out.files.pdfRecord = fakeRec ? { fileType: fakeRec.fileType, contentType: fakeRec.contentType ?? null, hasText: !!fakeRec.textContent, text: (fakeRec.textContent || "").slice(0, 60) } : null;
    addCheck(
      "R-FILES-8",
      "pdf-named text file stores with extension-labeled type (content-vs-extension evidence)",
      !!fakeRec,
      `msg=${pdfMsg} record=${JSON.stringify(out.files.pdfRecord)}`
    );
  } finally {
    await browser.close();
  }
} catch (err) {
  out.fatal = String(err?.stack ?? err);
  console.error("FATAL", err);
} finally {
  const all = await c.query("projects:listProjects", {});
  out.cleanup = { deleted: [], leftover: [] };
  for (const p of all.filter((p) => p.title.startsWith("AUDIT-QA8-"))) {
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      out.cleanup.deleted.push(p._id);
    } catch (err) {
      out.cleanup.deleted.push(`${p._id}:FAILED:${err?.message ?? err}`);
    }
  }
  await delay(1200);
  out.cleanup.leftover = (await c.query("projects:listProjects", {})).filter((p) => p.title.startsWith("AUDIT-QA8-")).map((p) => p._id);
  out.checks = checks;
  writeEvidence("32-files-recheck", out);
  writeJson("fix4-qa8-32-files-recheck.json", out);
  const failed = checks.filter((k) => !k.ok);
  console.log(`\nQA8-32 done. checks=${checks.length} failed=${failed.length} cleanupLeftover=${out.cleanup.leftover.length}`);
  for (const f of failed) console.log(`  FAIL ${f.id} ${f.label}: observed=${f.observed}`);
}