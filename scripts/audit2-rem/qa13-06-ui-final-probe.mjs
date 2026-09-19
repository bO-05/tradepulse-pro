import {
  clickHeaderTab,
  delay,
  launchBrowser,
  selectProjectByTitle,
  shot,
  waitForAppReady,
} from "./qa6-lib.mjs";
import { BASE_URL } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, call } from "./qa13-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const B = readEvidence("backend");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${detail}`);
};

async function switchPackageInLeveling(page, packageTitle) {
  const res = await page.evaluate((title) => {
    const btn = [...document.querySelectorAll("main button")].find((b) => (b.innerText || "").includes(title));
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true };
  }, packageTitle);
  await delay(1200);
  return res;
}

async function main() {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const popups = [];
  browser.on("targetcreated", (t) => { if (t.type() === "page") popups.push(t); });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, "AUDIT-QA13-MAIN");
  await delay(2200);

  // ---------------- A12-02 UI register + KPI text
  await clickHeaderTab(page, "06: Subcontracts");
  await delay(2200);
  const contractsText = await page.evaluate(() => {
    const text = document.body.innerText;
    const pick = (label) => {
      const idx = text.search(new RegExp(label, "i"));
      if (idx < 0) return null;
      const after = text.slice(idx, idx + 120);
      const m = after.match(/\$[\d,]+|\d+\s*\/\s*\d+/);
      return m ? m[0] : null;
    };
    const elecRow = [...document.querySelectorAll("main tr")].find((tr) => /AUDIT-QA13 Main Electric Co/.test(tr.innerText || ""));
    const hvacRow = [...document.querySelectorAll("main tr")].find((tr) => /AUDIT-QA13 HVAC Main Co/.test(tr.innerText || ""));
    return {
      activeContractedSum: pick("ACTIVE CONTRACTED SUM"),
      executionStatus: pick("EXECUTION STATUS RECORDED"),
      elecRow: elecRow ? elecRow.innerText.replace(/\s+/g, " ") : null,
      hvacRow: hvacRow ? hvacRow.innerText.replace(/\s+/g, " ") : null,
      hasFake: /Fake Bidder|Totally Fake/i.test(text),
      supersededChip: /Superseded \(1\)/.test(text),
    };
  });
  await shot(page, "fix4-qa13-A12-02-contracts-register.png");
  record(
    "A12-02-ui-register-total-agrees",
    contractsText.activeContractedSum === `$${B.expected.contractsActiveTotal.toLocaleString("en-US")}` &&
      contractsText.elecRow.includes("910,000") &&
      contractsText.elecRow.includes("AUDIT-QA13 Main Electric Co") &&
      contractsText.hvacRow.includes("790,001") &&
      !contractsText.hasFake,
    `activeContractedSum=${JSON.stringify(contractsText.activeContractedSum)}; execStatus=${JSON.stringify(contractsText.executionStatus)}; elec=${JSON.stringify(contractsText.elecRow)}; hvac=${JSON.stringify(contractsText.hvacRow)}`
  );

  // ---------------- leveling: normal bid delete + print path hunt
  await clickHeaderTab(page, "04: Bid Leveling");
  await delay(2200);
  await switchPackageInLeveling(page, "QA13 Electrical Main");
  await delay(1200);
  const levelingKpi = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      kpi: (t.match(/Leveled Buyout:\s*\$[\d,]+/) || [null])[0],
      subs: (t.match(/Subcontracts:\s*\d+\/\d+ Awarded/) || [null])[0],
    };
  });
  record(
    "A12-02-ui-kpi-agrees",
    levelingKpi.kpi === `Leveled Buyout: $${B.expected.totalLeveledBuyout.toLocaleString("en-US")}` && levelingKpi.subs === "Subcontracts: 2/3 Awarded",
    `kpi=${JSON.stringify(levelingKpi.kpi)}; subs=${JSON.stringify(levelingKpi.subs)}`
  );

  // HUNT A13 candidate: leveling agreement modal print still calls window.print() on the app page
  const modalOpen = await page.evaluate(() => {
    const card = [...document.querySelectorAll("div")].find((d) => /AUDIT-QA13 Main Electric Co/.test(d.innerText || "") && /Contract Awarded • Draft Generated/.test(d.innerText || ""));
    const btn = card ? [...card.querySelectorAll("button")].find((b) => /Inspect Draft/.test(b.innerText || "")) : null;
    if (!btn) return false;
    btn.click();
    return true;
  });
  await delay(1200);
  await page.evaluate(() => {
    window.__qa13PrintCalls = 0;
    window.__qa13PrintPopupCalls = 0;
    const origOpen = window.open;
    window.open = function (...args) { window.__qa13PrintPopupCalls += 1; return origOpen.apply(window, args); };
    window.print = () => { window.__qa13PrintCalls += 1; };
  });
  popups.length = 0;
  const modalPrintClick = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) => (b.getAttribute("title") || "") === "Print subcontract agreement or save as PDF" && b.getBoundingClientRect().width > 0);
    const b = btns[btns.length - 1];
    if (!b) return false;
    b.click();
    return true;
  });
  await delay(1200);
  const modalPrintProbe = await page.evaluate(() => ({
    printCalls: window.__qa13PrintCalls,
    popupCalls: window.__qa13PrintPopupCalls,
  }));
  modalPrintProbe.popups = popups.length;
  await shot(page, "fix4-qa13-A13-leveling-modal-print.png");
  record(
    "HUNT-leveling-modal-print-isolated",
    modalOpen && modalPrintClick && modalPrintProbe.popupCalls > 0 && modalPrintProbe.printCalls === 0,
    `modalOpen=${modalOpen}; clicked=${modalPrintClick}; mainPagePrintCalls=${modalPrintProbe.printCalls}; window.openCalls=${modalPrintProbe.popupCalls}; newTargets=${modalPrintProbe.popups}`
  );
  await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1;
    const dlg = [...document.querySelectorAll('[role="dialog"]')].filter(vis).pop();
    if (!dlg) return;
    const btns = [...dlg.querySelectorAll("button")].filter(vis);
    const x = btns[btns.length - 1];
    if (x) x.click();
  });
  await delay(700);
  const modalClosed = await page.evaluate(() => ![...document.querySelectorAll('[role="dialog"]')].some((e) => e.getBoundingClientRect().width > 1));
  await delay(300);
  say(`leveling modal closed after print test: ${modalClosed}`);

  // normal bid delete (backup bid) via UI
  const backupDelete = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("main div")].filter((d) => /AUDIT-QA13 Main Electric Backup/.test(d.innerText || "") && d.querySelector("button[title='Delete proposal'],button[title='Delete Bid Proposal']"));
    const card = cards[cards.length - 1];
    if (!card) return { ok: false };
    const b = card.querySelector("button[title='Delete proposal'],button[title='Delete Bid Proposal']");
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, title: b.getAttribute("title") };
  });
  await delay(800);
  const confirmDelete = await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1;
    const dlg = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
    if (!dlg) return false;
    const b = [...dlg.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Delete proposal");
    if (!b) return false;
    b.click();
    return true;
  });
  await delay(2600);
  const backupBidGone = !(await c.query("bids:listByPackage", { tradePackageId: F.mainElecPackageId })).some((b) => b._id === F.mainBackupBidId);
  const deleteToast = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[role="status"]')].filter((e) => e.getBoundingClientRect().width > 0 && (e.innerText || "").trim());
    return els.length ? els[els.length - 1].innerText.trim() : null;
  });
  record(
    "HUNT-normal-bid-delete",
    backupDelete.ok && confirmDelete && backupBidGone,
    `click=${JSON.stringify(backupDelete)}; confirm=${confirmDelete}; gone=${backupBidGone}; toast=${JSON.stringify(deleteToast)}`
  );

  // contractor delete is refused while a bid exists (guarded), succeeds after bid removal
  const ctrGuarded = await call("HUNT deleteContractor with bid", () => c.mutation("contractors:deleteContractor", { contractorId: F.mainBackupContractorId }));
  const ctrGuardedReject = /proposal\(s\) on file|Remove the proposal\(s\)/i.test(`${ctrGuarded.data ?? ""} ${ctrGuarded.message ?? ""}`);
  const ctrDelete = await call("HUNT deleteContractor after bid removal", () => c.mutation("contractors:deleteContractor", { contractorId: F.mainBackupContractorId }));
  const ctrGone = !(await c.query("contractors:listByPackage", { tradePackageId: F.mainElecPackageId })).some((x) => x._id === F.mainBackupContractorId);
  record("HUNT-delete-contractor", ctrGuardedReject && ctrDelete.ok && ctrGone, `guardedReject=${ctrGuardedReject} ("${ctrGuardedReject ? String(ctrGuarded.data ?? ctrGuarded.message).slice(0, 90) : ""}"); delete=${ctrDelete.ok}; gone=${ctrGone}`);

  // normal package delete (ZERO package, no contractors/bids)
  const pkgDelete = await call("HUNT deleteTradePackage", () => c.mutation("tradePackages:deleteTradePackage", { tradePackageId: F.zeroPackageId }));
  const zeroPkgs = await c.query("tradePackages:listByProject", { projectId: F.zeroProjectId });
  record("HUNT-delete-package", pkgDelete.ok && (zeroPkgs || []).length === 0, `delete=${pkgDelete.ok}; remaining=${(zeroPkgs || []).length}`);

  writeEvidence("ui-final", { results, contractsText, levelingKpi, modalPrintProbe, backupDelete, deleteToast, ctrGuarded, ctrDelete });
  writeLog("ui-final", log);
  console.log(`\nfinal probe results: ${results.filter((r) => r.pass).length}/${results.length} passed`);
  await browser.close();
}

main().catch(async (e) => {
  console.error(e);
  writeLog("ui-final-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});