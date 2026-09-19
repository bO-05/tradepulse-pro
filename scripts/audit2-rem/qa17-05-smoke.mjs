/**
 * QA17-05 smoke: dispatch, file upload/delete, RFI submit, award/unaward/re-award.
 * Fixture: AUDIT-QA17-NAME / AUDIT-QA17 Short HVAC. Records pageerrors.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, setInputValue } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, sleep } from "./qa17-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${JSON.stringify(detail).slice(0, 420)}`);
};

const TMP_DIR = "C:/Users/user/AppData/Local/Temp/opencode";
const UNLINKED = "AUDIT-QA17-Unlinked.txt";
const DISPATCH_EMAIL = "qa17.dispatch@qa17.invalid";
const RFI_SUBJECT = "AUDIT-QA17 RFI smoke probe";

async function statusText(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('[role="status"]')].filter((e) => e.getBoundingClientRect().width > 0 && (e.innerText || "").trim());
    const el = els[els.length - 1];
    return el ? el.innerText.trim() : null;
  });
}
async function waitToast(page, pattern, timeout = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await statusText(page);
    if (t && pattern.test(t)) return t;
    await delay(400);
  }
  return await statusText(page);
}
async function waitBodyText(page, pattern, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ok = await page.evaluate((p) => new RegExp(p).test(document.body.innerText), pattern.source);
    if (ok) return true;
    await delay(350);
  }
  return false;
}
async function poll(fn, predicate, timeoutMs = 30000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(700);
  }
  return last;
}
async function clickHeaderTab(page, label) {
  await page.evaluate((t) => {
    const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes(t) || (x.innerText || "").includes(t));
    if (b) b.click();
  }, label);
  await delay(800);
}
async function clickPackageCardButton(page, packageNeedle, buttonText) {
  return page.evaluate(
    ({ packageNeedle, buttonText }) => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const cards = [...document.querySelectorAll("main div")].filter((d) => vis(d) && (d.innerText || "").includes(packageNeedle) && d.querySelector("button"));
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
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const h = [...document.querySelectorAll("h4")].find((x) => (x.innerText || "").includes(fileName) && vis(x));
      if (!h) return { ok: false, reason: "file header not found" };
      let node = h;
      for (let i = 0; i < 6 && node; i++) {
        if (node.querySelector && node.querySelector("button")) break;
        node = node.parentElement;
      }
      const btns = [...(node ? node.querySelectorAll("button") : [])];
      const btn = btns.find((b) => (b.getAttribute("title") || "") === titleOrText) || btns.find((b) => (b.innerText || "").includes(titleOrText));
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
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
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
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
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
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => vis(x) && (x.innerText || "").includes(name));
    if (!b) return { ok: false };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80) };
  }, packageName);
  if (res.ok) await delay(1800);
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

async function smokeBidNow() {
  const bids = (await c.query("bids:listByPackage", { tradePackageId: F.smoke.packageId })) || [];
  return bids.find((b) => b._id === F.smoke.bidId) || null;
}
async function smokePackageNow() {
  return await c.query("tradePackages:getPackage", { tradePackageId: F.smoke.packageId });
}

async function main() {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  await page.goto(`https://brainy-skunk-440.convex.site/?project=${F.name.id}&tab=packages&qa17=smoke`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
    b?.click();
  });
  await delay(1200);

  // ---------- dispatch ----------
  const existingDispatch = ((await c.query("contractors:listByPackage", { tradePackageId: F.smoke.packageId })) || []).find((x) => x.contactEmail === DISPATCH_EMAIL);
  if (existingDispatch) {
    try { await c.mutation("contractors:deleteContractor", { contractorId: existingDispatch._id }); } catch (err) { say(`dispatch ctr reset failed: ${err?.data ?? err?.message}`); }
  }
  const dispatchCtrId = await c.mutation("contractors:createContractor", {
    tradePackageId: F.smoke.packageId,
    companyName: "AUDIT-QA17 Dispatch Target",
    contactEmail: DISPATCH_EMAIL,
    phone: "+1 (212) 555-0199",
    licenseNumber: "NY-QA17-D1",
    licenseStatus: "Active / Verified (QA17)",
    sourceUrl: "https://qa17.example.invalid/dispatch",
    rfqStatus: "discovered",
  });
  await delay(700);

  await clickHeaderTab(page, "01: CSI Scoping");
  await delay(1600);
  const dispatchClick = await clickPackageCardButton(page, F.smoke.packageName, "Dispatch RFQs");
  const dispatchToast = await waitToast(page, /RFQs delivered|RFQs recorded|No RFQ invitations|dispatch failed|Something went wrong/i, 90000);
  await shot(page, "fix4-qa17-smoke-dispatch.png");
  const dispatchCtr = await poll(
    async () => ((await c.query("contractors:listByPackage", { tradePackageId: F.smoke.packageId })) || []).find((x) => x._id === dispatchCtrId),
    (x) => x && x.rfqStatus !== "discovered",
    25000
  );
  record(
    "SMOKE-dispatch",
    dispatchClick.ok && typeof dispatchToast === "string" && !/dispatch failed|Something went wrong/i.test(dispatchToast) && dispatchCtr && dispatchCtr.rfqStatus === "invited" && Boolean(dispatchCtr.dispatchedAt),
    `click=${JSON.stringify(dispatchClick)}; toast=${JSON.stringify(dispatchToast)}; ctr=${dispatchCtr ? `${dispatchCtr.rfqStatus}:${dispatchCtr.dispatchedAt}` : null}`
  );

  // ---------- file upload/delete ----------
  {
    const files = (await c.query("files:listFilesByProject", { projectId: F.name.id })) || [];
    for (const f of files.filter((x) => x.fileName === UNLINKED)) {
      try { await c.mutation("files:deleteFile", { fileId: f._id }); } catch (err) { say(`file prepurge failed: ${err?.data ?? err?.message}`); }
    }
  }
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const specPath = path.join(TMP_DIR, UNLINKED);
  fs.writeFileSync(specPath, "QA17 unlinked document. No bid content. Division 08 reference only.\n", "utf8");
  await clickHeaderTab(page, "01: CSI Scoping");
  await delay(1200);
  await page.select('select[aria-label="Document type for upload"]', "spec");
  const input = await page.$("#convex-file-upload");
  if (!input) throw new Error("file input not found");
  await input.uploadFile(specPath);
  const uploadBanner = await waitBodyText(page, /Successfully uploaded \d+ file\(s\) to Convex Storage/i, 40000);
  await delay(1500);
  const delClick = await clickFileRowButton(page, UNLINKED, "Delete file from storage");
  await delay(800);
  const delDialog = await probeAlertDialog(page);
  const delConfirm = await clickDialogButton(page, "Delete file");
  await delay(2600);
  const filesAfter = (await c.query("files:listFilesByProject", { projectId: F.name.id })) || [];
  const gone = !filesAfter.some((f) => f.fileName === UNLINKED);
  await shot(page, "fix4-qa17-smoke-file-delete.png");
  record(
    "SMOKE-file-upload-delete",
    uploadBanner && delClick.ok && delDialog.dialogOpen && delConfirm && gone && !delDialog.inlineAlert,
    `upload=${uploadBanner}; click=${JSON.stringify(delClick)}; dialog=${JSON.stringify({ title: delDialog.title, alert: delDialog.inlineAlert })}; confirm=${delConfirm}; gone=${gone}`
  );

  // ---------- RFI submit ----------
  await clickHeaderTab(page, "03: Pre-Bid Q&A");
  await delay(2200);
  const rfiSelect = await page.evaluate(({ pkgId, pkgName }) => {
    const sel = document.querySelector('select[aria-label="Target trade package for this RFI"]');
    if (!sel) return { ok: false, reason: "select not found" };
    const opt = [...sel.options].find((o) => o.value === pkgId) || [...sel.options].find((o) => o.textContent.includes(pkgName));
    if (!opt) return { ok: false, reason: "option not found" };
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: opt.value, text: opt.textContent.trim() };
  }, { pkgId: F.smoke.packageId, pkgName: F.smoke.packageName });
  await delay(1200);
  await setInputValue(page, 'input[aria-label="RFI subject or scope topic"]', RFI_SUBJECT);
  await setInputValue(page, 'textarea[aria-label="Subcontractor question"]', "QA17 smoke probe: confirm door hardware finish schedule substitution approval path.");
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
    40000
  );
  const convo = (persisted || []).find((x) => x.inboundSubject === RFI_SUBJECT) || null;
  await shot(page, "fix4-qa17-smoke-rfi-submit.png");
  record("SMOKE-rfi-submit", rfiSelect.ok && rfiSubmit.ok && Boolean(convo), `select=${JSON.stringify(rfiSelect)}; submit=${JSON.stringify(rfiSubmit)}; conversation=${convo ? `${convo._id}:${convo.status}` : null}`);

  // ---------- award / unaward / re-award ----------
  const preBid = await smokeBidNow();
  if (preBid && preBid.isAwarded) {
    try { await c.mutation("bids:unawardContract", { bidId: F.smoke.bidId, tradePackageId: F.smoke.packageId }); } catch (err) { say(`lifecycle reset unaward failed: ${err?.data ?? err?.message}`); }
    await delay(800);
  }
  await clickHeaderTab(page, "04: Bid Leveling");
  await delay(2200);
  const lvlSel = await selectPackageByAria(page, F.smoke.packageName);
  const clickAward = async () =>
    page.evaluate((needle) => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const cards = [...document.querySelectorAll("main div")].filter((d) => vis(d) && (d.innerText || "").includes(needle) && [...d.querySelectorAll("button")].some((b) => /Award/i.test(b.innerText || "")));
      const card = cards.sort((a, b) => a.innerText.length - b.innerText.length)[0];
      if (!card) return { ok: false, reason: "bid card not found" };
      const btn = [...card.querySelectorAll("button")].find((b) => /Award/i.test(b.innerText || "") && !b.disabled);
      if (!btn) return { ok: false, reason: "award button not found" };
      btn.scrollIntoView({ block: "center" });
      btn.click();
      return { ok: true, label: (btn.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80) };
    }, "AUDIT-QA17 Smoke Bidder");

  const award1 = await clickAward();
  let bid1 = await poll(smokeBidNow, (b) => b && b.isAwarded === true, 25000);
  if (!(bid1 && bid1.isAwarded)) {
    // The award button opens a confirmation dialog in some states; confirm it.
    const dlg = await probeAlertDialog(page);
    if (dlg.dialogOpen) {
      const labels = dlg.buttons;
      const confirmed = await page.evaluate(() => {
        const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        const ds = [...document.querySelectorAll('[role="alertdialog"],[role="dialog"]')].filter(vis);
        const top = ds[ds.length - 1];
        const b = top && [...top.querySelectorAll("button")].find((x) => /award/i.test(x.innerText || ""));
        if (b) { b.click(); return (b.innerText || "").trim(); }
        return null;
      });
      say(`award confirm dialog: ${JSON.stringify({ labels, confirmed })}`);
      bid1 = await poll(smokeBidNow, (b) => b && b.isAwarded === true, 25000);
    }
  }
  await delay(1400);
  const modalClosed1 = await closeLevelingModal(page);
  const pkg1 = await smokePackageNow();
  await shot(page, "fix4-qa17-smoke-award.png");

  const unawardClick = await page.evaluate((needle) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const cards = [...document.querySelectorAll("main div")].filter((d) => vis(d) && (d.innerText || "").includes(needle) && [...d.querySelectorAll("button")].some((b) => (b.innerText || "").trim() === "Unaward"));
    const card = cards.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!card) return { ok: false };
    const b = [...card.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Unaward");
    if (!b) return { ok: false };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true };
  }, "AUDIT-QA17 Smoke Bidder");
  await delay(900);
  const unawardDialog = await probeAlertDialog(page);
  const unawardConfirm = await clickDialogButton(page, "Unaward proposal");
  const bid2 = await poll(smokeBidNow, (b) => b && b.isAwarded === false, 25000);
  await delay(800);

  const award2 = await clickAward();
  let bid3 = await poll(smokeBidNow, (b) => b && b.isAwarded === true, 25000);
  if (!(bid3 && bid3.isAwarded)) {
    const dlg = await probeAlertDialog(page);
    if (dlg.dialogOpen) {
      await page.evaluate(() => {
        const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        const ds = [...document.querySelectorAll('[role="alertdialog"],[role="dialog"]')].filter(vis);
        const top = ds[ds.length - 1];
        const b = top && [...top.querySelectorAll("button")].find((x) => /award/i.test(x.innerText || ""));
        b?.click();
      });
      bid3 = await poll(smokeBidNow, (b) => b && b.isAwarded === true, 25000);
    }
  }
  await delay(1000);
  const modalClosed2 = await closeLevelingModal(page);
  const pkg3 = await smokePackageNow();
  const agrs = (await c.query("agreements:listAgreements", { projectId: F.name.id })) || [];
  const activeAgr = agrs.find((a) => a.bidId === F.smoke.bidId && a.status !== "superseded") || null;
  await shot(page, "fix4-qa17-smoke-reaward.png");
  record(
    "SMOKE-award-unaward-reaward",
    lvlSel.ok && award1.ok && bid1 && bid1.isAwarded === true && pkg1.status === "awarded" && unawardClick.ok && unawardDialog.dialogOpen && unawardConfirm && bid2 && bid2.isAwarded === false && award2.ok && bid3 && bid3.isAwarded === true && pkg3.status === "awarded" && Boolean(activeAgr),
    `sel=${JSON.stringify(lvlSel)}; award1=${JSON.stringify(award1)}; bid1=${bid1 ? bid1.isAwarded : null}; pkg1=${pkg1.status}; unaward=${JSON.stringify(unawardClick)}; dialog=${JSON.stringify({ title: unawardDialog.title, alert: unawardDialog.inlineAlert })}; confirm=${unawardConfirm}; bid2=${bid2 ? bid2.isAwarded : null}; award2=${JSON.stringify(award2)}; bid3=${bid3 ? bid3.isAwarded : null}; pkg3=${pkg3.status}; activeAgr=${activeAgr ? activeAgr.agreementNumber : null}; modalClosed=${modalClosed1}/${modalClosed2}`
  );

  const diagnostics = {
    consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 200)),
    pageErrors: diag.pageErrors.slice(0, 20),
    pageErrorCount: diag.pageErrors.length,
    failedRequests: diag.failedRequests.slice(0, 10),
  };
  say(`diagnostics: ${JSON.stringify({ consoleErrors: diagnostics.consoleErrors.length, pageErrors: diagnostics.pageErrorCount, failedRequests: diagnostics.failedRequests.length })}`);
  record("SMOKE-zero-pageerrors", diagnostics.pageErrorCount === 0, `pageErrors=${diagnostics.pageErrorCount}; consoleErrors=${diagnostics.consoleErrors.length}`);

  writeEvidence("smoke", { results, dispatch: { dispatchClick, dispatchToast, ctr: dispatchCtr ? { rfqStatus: dispatchCtr.rfqStatus, dispatchedAt: dispatchCtr.dispatchedAt } : null }, fileDelete: { uploadBanner, delClick, delDialog, delConfirm, gone }, rfi: { rfiSelect, rfiSubmit, convo: convo ? { id: convo._id, status: convo.status } : null }, lifecycle: { award1, bid1: bid1 ? bid1.isAwarded : null, pkg1: pkg1.status, unawardClick, unawardDialog, unawardConfirm, bid2: bid2 ? bid2.isAwarded : null, award2, bid3: bid3 ? bid3.isAwarded : null, pkg3: pkg3.status, activeAgreement: activeAgr ? activeAgr.agreementNumber : null }, diagnostics });
  writeLog("smoke", log);
  console.log(`results: ${results.filter((r) => r.pass).length}/${results.length}`);
  await browser.close();
  try { fs.unlinkSync(specPath); } catch {}
}

main().catch((e) => {
  console.error(e);
  writeLog("smoke-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});