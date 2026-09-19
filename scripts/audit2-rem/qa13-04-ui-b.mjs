import fs from "node:fs";
import path from "node:path";
import {
  attachDiagnostics,
  clickHeaderTab,
  delay,
  launchBrowser,
  selectProjectByTitle,
  shot,
  waitForAppReady,
} from "./qa6-lib.mjs";
import { BASE_URL } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa13-lib.mjs";

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

async function clickPackageCardButton(page, packageNeedle, buttonText) {
  return page.evaluate(
    ({ packageNeedle, buttonText }) => {
      const cards = [...document.querySelectorAll("main div")].filter(
        (d) => (d.innerText || "").includes(packageNeedle) && d.querySelector("button")
      );
      const card = cards[cards.length - 1];
      if (!card) return { ok: false, reason: "card not found" };
      const btn = [...card.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === buttonText);
      if (!btn) return { ok: false, reason: "button not found", buttons: [...card.querySelectorAll("button")].map((b) => b.innerText.trim()) };
      btn.scrollIntoView({ block: "center" });
      btn.click();
      return { ok: true };
    },
    { packageNeedle, buttonText }
  );
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
      return { ok: true };
    },
    { fileName, titleOrText }
  );
}

async function probeAlertDialog(page) {
  return page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const ds = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis);
    const top = ds[ds.length - 1] || null;
    const alert = top ? top.querySelector('[role="alert"]') : null;
    return {
      dialogOpen: Boolean(top),
      title: top ? ((top.querySelector("h2") || {}).innerText || "").trim() : null,
      inlineAlert: alert ? alert.innerText.trim() : null,
      alertVisible: alert ? vis(alert) : null,
    };
  });
}

async function clickDialogButton(page, label) {
  return page.evaluate((needle) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const ds = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis);
    const top = ds[ds.length - 1];
    if (!top) return false;
    const b = [...top.querySelectorAll("button")].find((x) => (x.innerText || "").trim().replace(/\s+/g, " ") === needle);
    if (!b) return false;
    b.click();
    return true;
  }, label);
}

async function main() {
  // purge any files/bids left by a previous run of this script on the INGEST fixture
  {
    const files = (await c.query("files:listFilesByProject", { projectId: F.ingestProjectId })) || [];
    const bids = (await c.query("bids:listByPackage", { tradePackageId: F.ingestPackageId })) || [];
    for (const f of files) {
      const linked = bids.find((b) => b.sourceFileId === f._id);
      if (linked) {
        try { await c.mutation("bids:deleteBid", { bidId: linked._id }); } catch (err) { say(`prepurge deleteBid failed: ${err?.message ?? err}`); }
      }
      try { await c.mutation("files:deleteFile", { fileId: f._id }); } catch (err) { say(`prepurge deleteFile failed (${f.fileName}): ${err?.data ?? err?.message ?? err}`); }
    }
    say(`prepurge done: files=${files.length} bids=${bids.length}`);
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });
  const quotePath = path.join(TMP_DIR, "AUDIT-QA13-Quote.txt");
  const specPath = path.join(TMP_DIR, "AUDIT-QA13-Unlinked.txt");
  fs.writeFileSync(
    quotePath,
    [
      "SUBCONTRACTOR PROPOSAL AND QUOTATION",
      "Prepared By: AUDIT-QA13 Ingest Electric",
      "Base Bid Price: $780,000.00",
      "Division 26 Electrical: switchgear, feeders, branch power, lighting.",
      "Exclusions: crane hoisting by GC.",
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(specPath, "QA13 unlinked document. No bid content. Division 26 reference only.\n", "utf8");

  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);

  // ================================================== A11-05 zero-contractor dispatch
  await selectProjectByTitle(page, "AUDIT-QA13-ZERO");
  await delay(2200);
  await clickHeaderTab(page, "01: CSI Scoping");
  await delay(1500);
  const errBefore = diag.pageErrors.length;
  const dispatchClick = await clickPackageCardButton(page, "QA13 Electrical Zero", "Dispatch RFQs");
  const zeroToast = await waitToast(page, /No (RFQ|contractors)|Something went wrong|dispatch/i, 15000);
  await shot(page, "fix4-qa13-A11-05-zero-dispatch.png");
  await delay(800);
  const errAfter = diag.pageErrors.length;
  record(
    "A11-05-zero-contractor-dispatch",
    dispatchClick.ok &&
      typeof zeroToast === "string" &&
      /No (RFQ invitations were sent|contractors have been discovered)|no contractors require dispatch/i.test(zeroToast) &&
      !/Something went wrong/i.test(zeroToast) &&
      errAfter === errBefore,
    `click=${JSON.stringify(dispatchClick)}; toast=${JSON.stringify(zeroToast)}; pageErrorsBefore=${errBefore}; after=${errAfter}${errAfter > errBefore ? ` :: ${diag.pageErrors.slice(errBefore).join(" | ")}` : ""}`
  );

  // ================================================== A11-02 file upload + extract + delete guard
  await selectProjectByTitle(page, "AUDIT-QA13-INGEST");
  await delay(2200);
  await clickHeaderTab(page, "01: CSI Scoping");
  await delay(1500);

  await page.select('select[aria-label="Document type for upload"]', "quote_pdf");
  const input = await page.$("#convex-file-upload");
  if (!input) throw new Error("file input not found");
  await input.uploadFile(quotePath);
  const uploadBanner = await waitBodyText(page, /Successfully uploaded \d+ file\(s\) to Convex Storage/i, 30000);
  say(`upload banner: ${uploadBanner}`);
  await delay(1500);
  const rowAppeared = await page.evaluate(() => document.body.innerText.includes("AUDIT-QA13-Quote.txt"));
  record("A11-02-upload-txt-quote", rowAppeared && uploadBanner, `row=${rowAppeared}; banner=${uploadBanner}`);

  const extractClick = await clickFileRowButton(page, "AUDIT-QA13-Quote.txt", "Extract & Level Bid");
  const extractToast = await waitToast(page, /Forensically extracted and leveled|Bid extraction failed|extracted and normalized/i, 180000);
  await shot(page, "fix4-qa13-A11-02-extract.png");
  const ingestFiles = (await c.query("files:listFilesByProject", { projectId: F.ingestProjectId })) || [];
  const quoteFile = ingestFiles.find((f) => f.fileName === "AUDIT-QA13-Quote.txt");
  const ingestBids = await c.query("bids:listByPackage", { tradePackageId: F.ingestPackageId });
  const linkedBid = (ingestBids || []).find((b) => b.sourceFileId === (quoteFile ? quoteFile._id : "none"));
  record(
    "A11-02-extract-creates-linked-bid",
    extractClick.ok && Boolean(linkedBid),
    `extractClick=${JSON.stringify(extractClick)}; toast=${JSON.stringify(extractToast)}; fileId=${quoteFile ? quoteFile._id : null}; linkedBid=${linkedBid ? linkedBid._id : null}`
  );

  // app navigates to leveling after extraction; return to CSI Scoping for the file row
  await clickHeaderTab(page, "01: CSI Scoping");
  await delay(1800);
  const delClick = await clickFileRowButton(page, "AUDIT-QA13-Quote.txt", "Delete file from storage");
  await delay(800);
  const delDialogBefore = await probeAlertDialog(page);
  await clickDialogButton(page, "Delete file");
  await delay(2600);
  const delDialogAfter = await probeAlertDialog(page);
  await shot(page, "fix4-qa13-A11-02-delete-guard-inline.png");
  const filesAfterGuard = (await c.query("files:listFilesByProject", { projectId: F.ingestProjectId })) || [];
  const fileStill = filesAfterGuard.some((f) => f._id === (quoteFile ? quoteFile._id : ""));
  record(
    "A11-02-delete-linked-file-guard-inline",
    delClick.ok &&
      delDialogBefore.dialogOpen &&
      delDialogAfter.dialogOpen &&
      typeof delDialogAfter.inlineAlert === "string" &&
      /linked to a bid/i.test(delDialogAfter.inlineAlert) &&
      fileStill,
    `delClick=${JSON.stringify(delClick)}; title=${JSON.stringify(delDialogAfter.title)}; alert=${JSON.stringify(delDialogAfter.inlineAlert)}; fileStill=${fileStill}`
  );
  await clickDialogButton(page, "Cancel");
  await delay(500);

  // regression: normal (unlinked) file delete still works
  await page.select('select[aria-label="Document type for upload"]', "spec");
  const input2 = await page.$("#convex-file-upload");
  await input2.uploadFile(specPath);
  await waitBodyText(page, /Successfully uploaded \d+ file\(s\) to Convex Storage/i, 30000);
  await delay(1500);
  const delUnlinked = await clickFileRowButton(page, "AUDIT-QA13-Unlinked.txt", "Delete file from storage");
  await delay(800);
  await clickDialogButton(page, "Delete file");
  await delay(2600);
  const unlinkedToast = await page.evaluate(() => {
    const els = [...document.querySelectorAll("span,div,p")].filter(
      (e) => /File deleted from storage|Delete failed/i.test(e.innerText || "") && e.getBoundingClientRect().width > 0
    );
    const el = els[els.length - 1];
    return el ? el.innerText.trim().split("\n")[0] : null;
  });
  const filesAfterDelete = (await c.query("files:listFilesByProject", { projectId: F.ingestProjectId })) || [];
  const unlinkedGone = !filesAfterDelete.some((f) => f.fileName === "AUDIT-QA13-Unlinked.txt");
  record(
    "HUNT-normal-unlinked-file-delete",
    delUnlinked.ok && unlinkedGone && /File deleted from storage/i.test(unlinkedToast || ""),
    `click=${JSON.stringify(delUnlinked)}; toast=${JSON.stringify(unlinkedToast)}; gone=${unlinkedGone}`
  );

  const consoleErrors = diag.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 200));
  const diagnostics = {
    consoleErrors,
    pageErrors: diag.pageErrors.slice(0, 10),
    pageErrorCount: diag.pageErrors.length,
    failedRequests: diag.failedRequests.slice(0, 10),
  };
  say(`UI-B diagnostics: ${JSON.stringify({ consoleErrors: consoleErrors.length, pageErrors: diagnostics.pageErrors.length, failedRequests: diagnostics.failedRequests.length })}`);

  writeEvidence("ui-b", {
    results,
    zero: { dispatchClick, toast: zeroToast, pageErrorsBefore: errBefore, pageErrorsAfter: errAfter },
    upload: { uploadBanner, rowAppeared },
    extract: { extractClick, extractToast, fileId: quoteFile ? quoteFile._id : null, linkedBidId: linkedBid ? linkedBid._id : null },
    deleteGuard: { delClick, delDialogBefore, delDialogAfter, fileStill },
    unlinkedDelete: { delUnlinked, toast: unlinkedToast, gone: unlinkedGone },
    diagnostics,
  });
  writeLog("ui-b", log);
  console.log(`\nUI-B results: ${results.filter((r) => r.pass).length}/${results.length} passed`);
  await browser.close();
  for (const p of [quotePath, specPath]) {
    try { fs.unlinkSync(p); } catch {}
  }
}

main().catch(async (e) => {
  console.error(e);
  writeLog("ui-b-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});