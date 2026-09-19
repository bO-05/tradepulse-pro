/**
 * QA15 live smoke: normal award/unaward/re-award, fresh contractor edit,
 * normal file delete, normal RFQ dispatch, RFI submit. Records pageerrors.
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
  setInputValue,
} from "./qa6-lib.mjs";
import { BASE_URL } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, sleep } from "./qa15-lib.mjs";

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
const UNLINKED = "AUDIT-QA15-Unlinked.txt";
const DISPATCH_EMAIL = "qa15.dispatch@qa15.invalid";
const RFI_SUBJECT = "AUDIT-QA15 RFI smoke probe";

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

async function poll(fn, predicate, timeoutMs = 30000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(600);
  }
  return last;
}

async function clickPackageCardButton(page, packageNeedle, buttonText) {
  return page.evaluate(
    ({ packageNeedle, buttonText }) => {
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      const cards = [...document.querySelectorAll("main div")].filter(
        (d) => vis(d) && (d.innerText || "").includes(packageNeedle) && d.querySelector("button")
      );
      const card = cards.sort((a, b) => a.innerText.length - b.innerText.length)[0];
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
      return { ok: true, title: btn.getAttribute("title") };
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
      buttons: top ? [...top.querySelectorAll("button")].map((b) => (b.innerText || "").trim().replace(/\s+/g, " ")) : [],
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

async function selectPackageByAria(page, packageName) {
  const res = await page.evaluate((name) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => vis(x) && (x.innerText || "").includes(name));
    if (!b) return { ok: false };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80) };
  }, packageName);
  if (res.ok) await delay(1600);
  return res;
}

async function closeLevelingModal(page) {
  const closed = await page.evaluate(() => {
    const holders = [...document.querySelectorAll("div.fixed.inset-0")].filter((d) => /A401-style Subcontract Draft/.test(d.innerText || ""));
    const d = holders[holders.length - 1];
    if (!d) return false;
    const buttons = [...d.querySelectorAll("button")].filter((b) => !((b.innerText || "").trim()));
    const x = buttons[buttons.length - 1];
    if (!x) return false;
    x.click();
    return true;
  });
  await delay(800);
  return closed;
}

async function smokePackageNow() {
  return await c.query("tradePackages:getPackage", { tradePackageId: F.smoke.packageId });
}

async function smokeBidNow() {
  const bids = (await c.query("bids:listByPackage", { tradePackageId: F.smoke.packageId })) || [];
  return bids.find((b) => b._id === F.smoke.bidId) || null;
}

async function main() {
  // repair any drift from a prior partial run of this smoke script
  {
    const smokeCtrs = (await c.query("contractors:listByPackage", { tradePackageId: F.smoke.packageId })) || [];
    const bidder = smokeCtrs.find((x) => x._id === F.smoke.bidderId);
    if (bidder && bidder.companyName !== F.smoke.bidderName) {
      await c.mutation("contractors:updateContractor", {
        contractorId: bidder._id,
        companyName: F.smoke.bidderName,
        contactEmail: bidder.contactEmail,
        phone: bidder.phone,
        licenseNumber: bidder.licenseNumber,
        licenseStatus: bidder.licenseStatus,
        sourceUrl: bidder.sourceUrl,
        rfqStatus: bidder.rfqStatus,
      });
      say(`repaired smoke bidder name -> ${F.smoke.bidderName}`);
    }
  }

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, F.mainProjectTitle);
  await delay(2400);

  // ---------- normal dispatch (needs a "discovered" contractor)
  const existingDispatch = ((await c.query("contractors:listByPackage", { tradePackageId: F.smoke.packageId })) || []).find(
    (x) => x.contactEmail === DISPATCH_EMAIL
  );
  if (existingDispatch) {
    try { await c.mutation("contractors:deleteContractor", { contractorId: existingDispatch._id }); } catch (err) { say(`dispatch ctr reset failed: ${err?.data ?? err?.message}`); }
  }
  const dispatchCtrId = await c.mutation("contractors:createContractor", {
    tradePackageId: F.smoke.packageId,
    companyName: "AUDIT-QA15 Dispatch Target",
    contactEmail: DISPATCH_EMAIL,
    phone: "+1 (212) 555-0166",
    licenseNumber: "NY-QA15-D1",
    licenseStatus: "Active / Verified (QA15)",
    sourceUrl: "https://qa15.example.invalid/dispatch",
    rfqStatus: "discovered",
  });
  await delay(600);

  await clickHeaderTab(page, "01: CSI Scoping");
  await delay(1800);
  const dispatchClick = await clickPackageCardButton(page, F.smoke.packageName, "Dispatch RFQs");
  const dispatchToast = await waitToast(page, /RFQs delivered|RFQs recorded|No RFQ invitations|dispatch failed|Something went wrong/i, 90000);
  await shot(page, "fix4-qa15-smoke-dispatch.png");
  const dispatchCtr = await poll(
    async () => ((await c.query("contractors:listByPackage", { tradePackageId: F.smoke.packageId })) || []).find((x) => x._id === dispatchCtrId),
    (x) => x && x.rfqStatus !== "discovered",
    20000
  );
  record(
    "SMOKE-normal-dispatch",
    dispatchClick.ok &&
      typeof dispatchToast === "string" &&
      !/dispatch failed|Something went wrong/i.test(dispatchToast) &&
      dispatchCtr &&
      dispatchCtr.rfqStatus === "invited" &&
      Boolean(dispatchCtr.dispatchedAt),
    `click=${JSON.stringify(dispatchClick)}; toast=${JSON.stringify(dispatchToast)}; ctr=${dispatchCtr ? `${dispatchCtr.rfqStatus}:${dispatchCtr.dispatchedAt}` : null}`
  );

  // ---------- normal file delete
  {
    const files = (await c.query("files:listFilesByProject", { projectId: F.mainProjectId })) || [];
    for (const f of files.filter((x) => x.fileName === UNLINKED)) {
      try { await c.mutation("files:deleteFile", { fileId: f._id }); } catch (err) { say(`file prepurge failed: ${err?.data ?? err?.message}`); }
    }
  }
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const specPath = path.join(TMP_DIR, UNLINKED);
  fs.writeFileSync(specPath, "QA15 unlinked document. No bid content. Division 08 reference only.\n", "utf8");
  await page.select('select[aria-label="Document type for upload"]', "spec");
  const input = await page.$("#convex-file-upload");
  if (!input) throw new Error("file input not found");
  await input.uploadFile(specPath);
  const uploadBanner = await waitBodyText(page, /Successfully uploaded \d+ file\(s\) to Convex Storage/i, 30000);
  await delay(1500);
  const delClick = await clickFileRowButton(page, UNLINKED, "Delete file from storage");
  await delay(800);
  const delDialog = await probeAlertDialog(page);
  const delConfirm = await clickDialogButton(page, "Delete file");
  await delay(2600);
  const filesAfter = (await c.query("files:listFilesByProject", { projectId: F.mainProjectId })) || [];
  const gone = !filesAfter.some((f) => f.fileName === UNLINKED);
  await shot(page, "fix4-qa15-smoke-file-delete.png");
  record(
    "SMOKE-normal-file-delete",
    uploadBanner && delClick.ok && delDialog.dialogOpen && delConfirm && gone && !delDialog.inlineAlert,
    `upload=${uploadBanner}; click=${JSON.stringify(delClick)}; dialog=${JSON.stringify({ title: delDialog.title, alert: delDialog.inlineAlert })}; confirm=${delConfirm}; gone=${gone}`
  );

  // ---------- normal fresh contractor edit
  await clickHeaderTab(page, "02: Discovery");
  await delay(1800);
  const discSel = await selectPackageByAria(page, F.smoke.packageName);
  await waitBodyText(page, new RegExp(F.smoke.freshContractorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), 20000);
  const opened = await page.evaluate((needle) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const nameEl = [...document.querySelectorAll("h1,h2,h3,h4,h5,p,span,div,strong,a")]
      .filter((e) => vis(e) && (e.innerText || "").trim() === needle)
      .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length)[0];
    if (!nameEl) return { ok: false, reason: "name element not found" };
    let n = nameEl;
    for (let i = 0; i < 10 && n; i++) {
      n = n.parentElement;
      if (!n) break;
      const btns = [...n.querySelectorAll('button[title="Edit contractor info"]')];
      if (btns.length === 1) {
        btns[0].scrollIntoView({ block: "center" });
        btns[0].click();
        return { ok: true, depth: i + 1 };
      }
      if (btns.length > 1) break;
    }
    return { ok: false, reason: "scoped edit button not found" };
  }, F.smoke.freshContractorName);
  if (!opened.ok) throw new Error("fresh contractor edit button not found");
  await page.waitForSelector('input[aria-label="Company name"]', { timeout: 15000 });
  const RENAMED = "AUDIT-QA15 Fresh Edit Target Renamed";
  await setInputValue(page, 'input[aria-label="Company name"]', RENAMED);
  const saveClick = await page.evaluate(() => {
    const dialog = document.querySelector('[aria-labelledby="edit-contractor-title"]');
    const btn = dialog ? [...dialog.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Save Changes")) : null;
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true };
  });
  await delay(2000);
  const freshAfter = await poll(
    async () => ((await c.query("contractors:listByPackage", { tradePackageId: F.smoke.packageId })) || []).find((x) => x._id === F.smoke.freshContractorId),
    (x) => x && x.companyName === RENAMED,
    15000
  );
  const editUi = await page.evaluate(() => {
    const dialog = document.querySelector('[aria-labelledby="edit-contractor-title"]');
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((e) => (e.innerText || "").trim()).filter(Boolean);
    return { modalOpen: Boolean(dialog), alerts };
  });
  await shot(page, "fix4-qa15-smoke-contractor-edit.png");
  record(
    "SMOKE-normal-contractor-edit-fresh",
    opened.ok && saveClick.ok && freshAfter && freshAfter.companyName === RENAMED && !editUi.modalOpen && editUi.alerts.length === 0,
    `opened=${opened.ok}; save=${JSON.stringify(saveClick)}; backend=${freshAfter ? freshAfter.companyName : null}; modalOpen=${editUi.modalOpen}; alerts=${JSON.stringify(editUi.alerts)}`
  );

  // ---------- RFI submit
  await clickHeaderTab(page, "03: Pre-Bid Q&A");
  await delay(2000);
  const rfiSelect = await page.evaluate(({ pkgId, pkgName }) => {
    const sel = document.querySelector('select[aria-label="Target trade package for this RFI"]');
    if (!sel) return { ok: false, reason: "select not found" };
    const opt = [...sel.options].find((o) => o.value === pkgId) || [...sel.options].find((o) => o.textContent.includes(pkgName));
    if (!opt) return { ok: false, reason: "option not found", options: [...sel.options].map((o) => `${o.value}|${o.textContent.trim()}`) };
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: opt.value, text: opt.textContent.trim() };
  }, { pkgId: F.smoke.packageId, pkgName: F.smoke.packageName });
  await delay(1200);
  await setInputValue(page, 'input[aria-label="RFI subject or scope topic"]', RFI_SUBJECT);
  await setInputValue(page, 'textarea[aria-label="Subcontractor question"]', "QA15 smoke probe: confirm door hardware finish schedule substitution approval path.");
  const rfiSubmit = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Submit RFI for Clarification"));
    if (!btn) return { ok: false };
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return { ok: true };
  });
  const persisted = await poll(
    async () => (await c.query("rfq:listConversations", { tradePackageId: F.smoke.packageId })) || [],
    (list) => Array.isArray(list) && list.some((x) => x.inboundSubject === RFI_SUBJECT),
    30000
  );
  const convo = (persisted || []).find((x) => x.inboundSubject === RFI_SUBJECT) || null;
  await shot(page, "fix4-qa15-smoke-rfi-submit.png");
  record(
    "SMOKE-rfi-submit",
    rfiSelect.ok && rfiSubmit.ok && Boolean(convo),
    `select=${JSON.stringify(rfiSelect)}; submit=${JSON.stringify(rfiSubmit)}; conversation=${convo ? `${convo._id}:${convo.status}:${convo.inboundSubject}` : null}`
  );

  // ---------- award / unaward / re-award
  const preBid = await smokeBidNow();
  if (preBid && preBid.isAwarded) {
    try { await c.mutation("bids:unawardContract", { bidId: F.smoke.bidId, tradePackageId: F.smoke.packageId }); } catch (err) { say(`lifecycle reset unaward failed: ${err?.data ?? err?.message}`); }
    await delay(800);
  }
  await clickHeaderTab(page, "04: Bid Leveling");
  await delay(2000);
  const lvlSel = await selectPackageByAria(page, F.smoke.packageName);
  const clickAward = async () =>
    page.evaluate((needle) => {
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      const cards = [...document.querySelectorAll("main div")].filter(
        (d) => vis(d) && (d.innerText || "").includes(needle) && [...d.querySelectorAll("button")].some((b) => /Award/i.test(b.innerText || ""))
      );
      const card = cards.sort((a, b) => a.innerText.length - b.innerText.length)[0];
      if (!card) return { ok: false, reason: "bid card not found" };
      const btn = [...card.querySelectorAll("button")].find((b) => /Award/i.test(b.innerText || "") && !b.disabled);
      if (!btn) return { ok: false, reason: "award button not found" };
      btn.scrollIntoView({ block: "center" });
      btn.click();
      return { ok: true, label: (btn.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80) };
    }, "AUDIT-QA15 Smoke Bidder");

  const award1 = await clickAward();
  const bid1 = await poll(smokeBidNow, (b) => b && b.isAwarded === true, 25000);
  await delay(1200);
  const modalClosed1 = await closeLevelingModal(page);
  const pkg1 = await smokePackageNow();
  await shot(page, "fix4-qa15-smoke-award.png");

  const unawardClick = await page.evaluate((needle) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const cards = [...document.querySelectorAll("main div")].filter(
      (d) => vis(d) && (d.innerText || "").includes(needle) && [...d.querySelectorAll("button")].some((b) => (b.innerText || "").trim() === "Unaward")
    );
    const card = cards.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!card) return { ok: false };
    const b = [...card.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Unaward");
    if (!b) return { ok: false };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true };
  }, "AUDIT-QA15 Smoke Bidder");
  await delay(900);
  const unawardDialog = await probeAlertDialog(page);
  const unawardConfirm = await clickDialogButton(page, "Unaward proposal");
  const bid2 = await poll(smokeBidNow, (b) => b && b.isAwarded === false, 25000);
  await delay(800);

  const award2 = await clickAward();
  const bid3 = await poll(smokeBidNow, (b) => b && b.isAwarded === true, 25000);
  await delay(1000);
  const modalClosed2 = await closeLevelingModal(page);
  const pkg3 = await smokePackageNow();
  const agrs = (await c.query("agreements:listAgreements", { projectId: F.mainProjectId })) || [];
  const activeAgr = agrs.find((a) => a.bidId === F.smoke.bidId && a.status !== "superseded") || null;
  await shot(page, "fix4-qa15-smoke-reaward.png");
  record(
    "SMOKE-normal-award-unaward-reaward",
    lvlSel.ok &&
      award1.ok &&
      bid1 &&
      bid1.isAwarded === true &&
      pkg1.status === "awarded" &&
      unawardClick.ok &&
      unawardDialog.dialogOpen &&
      unawardConfirm &&
      bid2 &&
      bid2.isAwarded === false &&
      award2.ok &&
      bid3 &&
      bid3.isAwarded === true &&
      pkg3.status === "awarded" &&
      Boolean(activeAgr),
    `sel=${JSON.stringify(lvlSel)}; award1=${JSON.stringify(award1)}; bid1=${bid1 ? bid1.isAwarded : null}; pkg1=${pkg1.status}; modalClosed1=${modalClosed1}; unaward=${JSON.stringify(unawardClick)}; dialog=${JSON.stringify({ title: unawardDialog.title, alert: unawardDialog.inlineAlert })}; confirm=${unawardConfirm}; bid2=${bid2 ? bid2.isAwarded : null}; award2=${JSON.stringify(award2)}; bid3=${bid3 ? bid3.isAwarded : null}; pkg3=${pkg3.status}; activeAgr=${activeAgr ? activeAgr.agreementNumber : null}; modalClosed2=${modalClosed2}`
  );

  const diagnostics = {
    consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 200)),
    pageErrors: diag.pageErrors.slice(0, 20),
    pageErrorCount: diag.pageErrors.length,
    failedRequests: diag.failedRequests.slice(0, 10),
  };
  say(`diagnostics: ${JSON.stringify({ consoleErrors: diagnostics.consoleErrors.length, pageErrors: diagnostics.pageErrorCount, failedRequests: diagnostics.failedRequests.length })}`);
  record("SMOKE-zero-pageerrors", diagnostics.pageErrorCount === 0, `pageErrors=${diagnostics.pageErrorCount}; consoleErrors=${diagnostics.consoleErrors.length}`);

  writeEvidence("smoke", { results, dispatch: { dispatchClick, dispatchToast, dispatchCtr: dispatchCtr ? { rfqStatus: dispatchCtr.rfqStatus, dispatchedAt: dispatchCtr.dispatchedAt } : null }, fileDelete: { uploadBanner, delClick, delDialog, delConfirm, gone }, contractorEdit: { opened, saveClick, backend: freshAfter ? freshAfter.companyName : null, editUi }, rfi: { rfiSelect, rfiSubmit, conversation: convo ? { id: convo._id, subject: convo.inboundSubject, status: convo.status } : null }, lifecycle: { award1, bid1Awarded: bid1 ? bid1.isAwarded : null, pkg1: pkg1.status, unawardClick, unawardDialog, unawardConfirm, bid2Awarded: bid2 ? bid2.isAwarded : null, award2, bid3Awarded: bid3 ? bid3.isAwarded : null, pkg3: pkg3.status, activeAgreement: activeAgr ? activeAgr.agreementNumber : null }, diagnostics });
  writeLog("smoke", log);
  console.log(`\nresults: ${results.filter((r) => r.pass).length}/${results.length} passed`);
  await browser.close();
  try { fs.unlinkSync(specPath); } catch {}
}

main().catch((e) => {
  console.error(e);
  writeLog("smoke-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});