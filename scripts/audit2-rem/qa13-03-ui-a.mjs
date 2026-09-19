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
const B = readEvidence("backend");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${detail}`);
};

const VIS = `(e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; }`;

async function clickVisibleMainButton(page, pattern, exact = false) {
  return page.evaluate(
    ({ pattern, exact }) => {
      const rx = new RegExp(pattern);
      const b = [...document.querySelectorAll("main button, header button")].find((x) => {
        const r = x.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) return false;
        const t = (x.innerText || "").trim().replace(/\s+/g, " ");
        return exact ? t === pattern : rx.test(t);
      });
      if (!b) return { ok: false };
      window.__qa13Opener = b;
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80) };
    },
    { pattern, exact }
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
      dialogCount: ds.length,
      dialogOpen: Boolean(top),
      title: top ? ((top.querySelector("h2") || {}).innerText || "").trim() : null,
      inlineAlert: alert ? alert.innerText.trim() : null,
      buttons: top ? [...top.querySelectorAll("button")].map((b) => (b.innerText || "").trim().replace(/\s+/g, " ")) : [],
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
    if (!top) return { ok: false, reason: "no dialog" };
    const b = [...top.querySelectorAll("button")].find((x) => (x.innerText || "").trim().replace(/\s+/g, " ") === needle);
    if (!b) return { ok: false, reason: "button not found", buttons: [...top.querySelectorAll("button")].map((x) => x.innerText.trim()) };
    b.click();
    return { ok: true };
  }, label);
}

async function clickRowButton(page, rowNeedle, buttonText) {
  return page.evaluate(
    ({ rowNeedle, buttonText }) => {
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      const rows = [...document.querySelectorAll("main tr")].filter((tr) => (tr.innerText || "").includes(rowNeedle) && vis(tr));
      const row = rows[0];
      if (!row) return { ok: false, reason: "row not found" };
      const b = [...row.querySelectorAll("button")].find((x) => (x.innerText || "").trim().includes(buttonText));
      if (!b) return { ok: false, reason: "button not found", buttons: [...row.querySelectorAll("button")].map((x) => x.innerText.trim()) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true };
    },
    { rowNeedle, buttonText }
  );
}

async function switchPackageInLeveling(page, packageTitle) {
  const res = await page.evaluate((title) => {
    const btn = [...document.querySelectorAll("main button")].find((b) => (b.innerText || "").includes(title));
    if (!btn) return { ok: false, reason: "package switch button not found" };
    btn.click();
    return { ok: true, text: btn.innerText.trim().replace(/\s+/g, " ").slice(0, 60) };
  }, packageTitle);
  await delay(1200);
  return res;
}

async function dialogProbe(page) {
  return page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const ds = [...document.querySelectorAll('[role="dialog"]')].filter(vis);
    const top = ds[ds.length - 1] || null;
    if (!top) return null;
    const labelledby = top.getAttribute("aria-labelledby");
    const labelEl = labelledby ? document.getElementById(labelledby.split(/\s+/)[0]) : null;
    const closeBtn = [...top.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Close contract viewer") || null;
    const active = document.activeElement;
    return {
      role: top.getAttribute("role"),
      ariaModal: top.getAttribute("aria-modal"),
      labelledby,
      labelledbyText: labelEl ? labelEl.innerText.trim().replace(/\s+/g, " ").slice(0, 80) : null,
      titleText: ((top.querySelector("h3") || {}).innerText || "").trim().replace(/\s+/g, " ").slice(0, 80),
      closeButtonNamed: Boolean(closeBtn),
      textLength: (top.innerText || "").length,
      hasAccountingLine: /plus scope-gap exclusions, lead-time, and COI adjustments/i.test(top.innerText || ""),
      hasExecutedBanner: /Execution recorded in TradePulse for this A401-style draft/i.test(top.innerText || ""),
      activeInside: top.contains(active),
      activeName: active ? (active.getAttribute("aria-label") || active.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60) : null,
    };
  });
}

async function tabSweep(page, times, shift = false) {
  let outside = 0;
  const stops = [];
  for (let i = 0; i < times; i++) {
    if (shift) {
      await page.keyboard.down("Shift");
      await page.keyboard.press("Tab");
      await page.keyboard.up("Shift");
    } else {
      await page.keyboard.press("Tab");
    }
    await delay(15);
    const s = await page.evaluate(() => {
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      const ds = [...document.querySelectorAll('[role="dialog"]')].filter(vis);
      const top = ds[ds.length - 1] || null;
      const a = document.activeElement;
      return {
        inside: top ? top.contains(a) : false,
        name: a ? (a.getAttribute("aria-label") || a.innerText || a.tagName).trim().replace(/\s+/g, " ").slice(0, 50) : null,
      };
    });
    if (!s.inside) outside++;
    stops.push(s.name);
  }
  return { outside, stops };
}

async function main() {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const popups = [];
  browser.on("targetcreated", (target) => {
    if (target.type() === "page") popups.push(target);
  });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);

  // ============================================================= EXEC: A11-01 / A5-02
  await selectProjectByTitle(page, "AUDIT-QA13-EXEC");
  await delay(2000);
  await clickHeaderTab(page, "04: Bid Leveling");
  await delay(2000);
  const execLeveling = await page.evaluate(() => document.body.innerText.includes("AUDIT-QA13 Exec Electric"));
  say(`EXEC leveling loaded: ${execLeveling}`);

  const unawardClick = await clickVisibleMainButton(page, "^Unaward$", true);
  await delay(800);
  const dialogBefore = await probeAlertDialog(page);
  await clickDialogButton(page, "Unaward proposal");
  await delay(2500);
  const afterUnawardRefusal = await probeAlertDialog(page);
  await shot(page, "fix4-qa13-A5-02-unaward-inline.png");
  record(
    "A5-02-unaward-inline-persists",
    unawardClick.ok &&
      dialogBefore.dialogOpen &&
      afterUnawardRefusal.dialogOpen &&
      typeof afterUnawardRefusal.inlineAlert === "string" &&
      /Executed agreements are immutable/i.test(afterUnawardRefusal.inlineAlert),
    `click=${JSON.stringify(unawardClick)}; title=${JSON.stringify(afterUnawardRefusal.title)}; alert=${JSON.stringify(afterUnawardRefusal.inlineAlert)}; stillOpen=${afterUnawardRefusal.dialogOpen}; alertVisible=${afterUnawardRefusal.alertVisible}`
  );
  const cancel1 = await clickDialogButton(page, "Cancel");
  await delay(500);
  const afterCancel = await probeAlertDialog(page);
  record("A11-01-cancel-closes", cancel1.ok && afterCancel.dialogOpen === false, `cancel=${cancel1.ok}; openAfter=${afterCancel.dialogOpen}`);

  const reopenClick = await clickVisibleMainButton(page, "^Unaward$", true);
  await delay(800);
  const reopened = await probeAlertDialog(page);
  await shot(page, "fix4-qa13-A11-01-reopen-reset.png");
  record(
    "A11-01-reopen-resets-error",
    reopenClick.ok && reopened.dialogOpen && reopened.inlineAlert === null,
    `reopened=${reopened.dialogOpen}; staleAlert=${JSON.stringify(reopened.inlineAlert)}`
  );
  await clickDialogButton(page, "Cancel");
  await delay(400);

  const deleteBidClick = await page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const b = [...document.querySelectorAll("main button")].find(
      (x) => vis(x) && ["Delete proposal", "Delete Bid Proposal"].includes(x.getAttribute("title") || "")
    );
    if (!b) return { ok: false };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, title: b.getAttribute("title") };
  });
  await delay(800);
  await clickDialogButton(page, "Delete proposal");
  await delay(2500);
  const afterDeleteRefusal = await probeAlertDialog(page);
  await shot(page, "fix4-qa13-A5-02-delete-executed-bid-inline.png");
  record(
    "A5-02-delete-executed-bid-inline",
    deleteBidClick.ok &&
      afterDeleteRefusal.dialogOpen &&
      typeof afterDeleteRefusal.inlineAlert === "string" &&
      /Executed agreements are immutable and cannot be deleted/i.test(afterDeleteRefusal.inlineAlert),
    `click=${JSON.stringify(deleteBidClick)}; title=${JSON.stringify(afterDeleteRefusal.title)}; alert=${JSON.stringify(afterDeleteRefusal.inlineAlert)}`
  );
  await clickDialogButton(page, "Cancel");
  await delay(400);

  // ============================================================= EXEC: contract viewer A12-05 + A12-04 + A12-07
  await clickHeaderTab(page, "06: Subcontracts");
  await delay(2000);
  const opener = await page.evaluate((agrNo) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const rows = [...document.querySelectorAll("main tr")].filter((tr) => (tr.innerText || "").includes(agrNo) && vis(tr));
    const row = rows[0];
    if (!row) return { ok: false };
    const b = [...row.querySelectorAll("button")].find((x) => /Inspect Draft/.test(x.innerText || ""));
    if (!b) return { ok: false };
    window.__qa13Opener = b;
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, F.execAgreementNumber);
  await page.mouse.click(opener.x, opener.y);
  await delay(1200);
  const viewer = await dialogProbe(page);
  await shot(page, "fix4-qa13-A12-05-contract-viewer.png");
  const trap = await tabSweep(page, 14);
  const trapShift = await tabSweep(page, 6, true);
  record(
    "A12-05-viewer-a11y",
    Boolean(viewer) &&
      viewer.role === "dialog" &&
      viewer.ariaModal === "true" &&
      viewer.labelledby === "contract-viewer-title" &&
      /A401-style Subcontract Draft/.test(viewer.labelledbyText || "") &&
      viewer.closeButtonNamed &&
      viewer.activeInside &&
      trap.outside === 0 &&
      trapShift.outside === 0,
    `role=${viewer && viewer.role}; ariaModal=${viewer && viewer.ariaModal}; labelledby=${viewer && viewer.labelledby}; labelText=${JSON.stringify(viewer && viewer.labelledbyText)}; closeNamed=${viewer && viewer.closeButtonNamed}; trapOutside=${trap.outside}/${trap.stops.length}; shiftOutside=${trapShift.outside}/${trapShift.stops.length}; activeName=${JSON.stringify(viewer && viewer.activeName)}`
  );
  record(
    "A12-07-viewer-accounting-line",
    Boolean(viewer && viewer.hasAccountingLine),
    `viewerHasLine=${viewer ? viewer.hasAccountingLine : "no viewer"}; backendLine=${JSON.stringify(B.details.accountingLine)}`
  );

  // Escape close + focus restore
  await page.keyboard.press("Escape");
  await delay(700);
  const afterEscape = await dialogProbe(page);
  const focusRestore = await page.evaluate(() => {
    const a = document.activeElement;
    const op = window.__qa13Opener;
    return { identity: Boolean(op && a === op), active: a ? (a.innerText || a.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 60) : null };
  });
  record(
    "A12-05-escape-and-focus-restore",
    afterEscape === null && focusRestore.identity,
    `viewerOpenAfterEscape=${Boolean(afterEscape)}; focusRestored=${focusRestore.identity}; active=${JSON.stringify(focusRestore.active)}`
  );

  // Open with named close button
  await page.evaluate((agrNo) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const rows = [...document.querySelectorAll("main tr")].filter((tr) => (tr.innerText || "").includes(agrNo) && vis(tr));
    const row = rows[0];
    const b = row && [...row.querySelectorAll("button")].find((x) => /Inspect Draft/.test(x.innerText || ""));
    if (b) b.click();
  }, F.execAgreementNumber);
  await delay(1000);
  const closeClick = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Close contract viewer"]');
    if (!b) return false;
    b.click();
    return true;
  });
  await delay(600);
  const closedByName = await dialogProbe(page);
  record("A12-05-named-close-button", closeClick && closedByName === null, `clicked=${closeClick}; closed=${closedByName === null}`);

  // ---------------- A12-04 print: (a) as deployed (b) with noopener stripped
  await page.evaluate((agrNo) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const rows = [...document.querySelectorAll("main tr")].filter((tr) => (tr.innerText || "").includes(agrNo) && vis(tr));
    const row = rows[0];
    const b = row && [...row.querySelectorAll("button")].find((x) => /Inspect Draft/.test(x.innerText || ""));
    if (b) b.click();
  }, F.execAgreementNumber);
  await delay(1000);
  popups.length = 0;
  const printBtnA = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("title") === "Print agreement or save as PDF");
    if (!b) return null;
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const printClickA = Boolean(printBtnA);
  if (printBtnA) await page.mouse.click(printBtnA.x, printBtnA.y);
  await delay(2500);
  const popupInfo = [];
  for (const t of popups) {
    let info = { url: t.url(), textLen: null, textHead: null, hasChrome: null };
    try {
      const p = await t.page();
      if (p) {
        info = await p.evaluate(() => ({
          url: location.href,
          textLen: (document.body ? document.body.textContent || "" : "").length,
          textHead: (document.body ? (document.body.textContent || "").slice(0, 80) : ""),
          hasChrome: /TradePulse|CSI Scoping|Subcontract Agreements Register|Inspect Draft/i.test(document.body ? document.body.textContent || "" : ""),
        }));
      }
    } catch (err) {
      info.error = String(err && err.message ? err.message : err);
    }
    popupInfo.push(info);
  }
  await shot(page, "fix4-qa13-A12-04-print-as-deployed.png");
  const anyFullContract = popupInfo.some(
    (p) => typeof p.textLen === "number" && p.textLen >= B.details.execContractLength * 0.95
  );
  record(
    "A12-04-print-isolated-full-text",
    printClickA && popupInfo.length > 0 && anyFullContract && popupInfo.every((p) => p.hasChrome !== true),
    `clicked=${printClickA}; popups=${JSON.stringify(popupInfo)}; contractLen=${B.details.execContractLength}`
  );

  // close the popups if still open
  for (const t of [...popups]) {
    try {
      const p = await t.page();
      if (p) await p.close();
    } catch {}
  }
  popups.length = 0;

  // (b) diagnostic: same click with noopener stripped (proves the rest of the print path)
  await page.evaluate(() => {
    const orig = window.open;
    window.__qa13PrintHandle = null;
    window.__qa13PrintCalled = false;
    window.open = function (url, name, features) {
      const f = String(features || "").replace(/\bnoopener\b/gi, "").replace(/\bnoreferrer\b/gi, "");
      const w = orig.call(window, url, name, f);
      if (w) {
        try {
          w.print = () => { w.__qa13Printed = true; };
        } catch {}
      }
      window.__qa13PrintHandle = w;
      return w;
    };
  });
  const printBtnB = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("title") === "Print agreement or save as PDF");
    if (!b) return null;
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const printClickB = Boolean(printBtnB);
  if (printBtnB) await page.mouse.click(printBtnB.x, printBtnB.y);
  await delay(1500);
  const printDiag = await page.evaluate(() => {
    const w = window.__qa13PrintHandle;
    if (!w) return { handle: false };
    let text = "";
    try {
      text = (w.document.body && w.document.body.textContent) || "";
    } catch (err) {
      return { handle: true, error: String(err && err.message ? err.message : err) };
    }
    return {
      handle: true,
      title: (w.document && w.document.title) || null,
      textLen: text.length,
      textHead: text.slice(0, 120),
      hasChrome: /TradePulse|CSI Scoping|Subcontract Agreements Register|Inspect Draft/i.test(text),
      printed: Boolean(w.__qa13Printed),
    };
  });
  say(`print diagnostic (noopener stripped): ${JSON.stringify(printDiag)}`);
  try {
    await page.evaluate(() => { if (window.__qa13PrintHandle) window.__qa13PrintHandle.close(); });
  } catch {}

  // Escape stacking hunt: viewer + nested confirm
  await page.evaluate((agrNo) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const rows = [...document.querySelectorAll("main tr")].filter((tr) => (tr.innerText || "").includes(agrNo) && vis(tr));
    const row = rows[0];
    const b = row && [...row.querySelectorAll("button")].find((x) => /Inspect Draft/.test(x.innerText || ""));
    if (b) b.click();
  }, F.execAgreementNumber);
  await delay(1000);
  const voidOpen = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Void execution record/.test(x.innerText || ""));
    if (!b) return false;
    b.click();
    return true;
  });
  await delay(800);
  const stackBefore = await page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    return {
      alertdialogs: [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).length,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(vis).length,
    };
  });
  await page.keyboard.press("Escape");
  await delay(700);
  const stackAfter = await page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    return {
      alertdialogs: [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).length,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(vis).length,
    };
  });
  const escapeStack = { voidOpen, before: stackBefore, after: stackAfter };
  say(`escape stack probe: ${JSON.stringify(escapeStack)}`);
  // reopen viewer if the Escape closed everything
  await delay(300);

  // ============================================================= EXEC: A11-03 void (do last on EXEC)
  // ensure viewer open and target the void confirm
  let viewerOpenNow = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getBoundingClientRect().width > 1).length > 0);
  if (!viewerOpenNow) {
    await page.evaluate((agrNo) => {
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      const rows = [...document.querySelectorAll("main tr")].filter((tr) => (tr.innerText || "").includes(agrNo) && vis(tr));
      const row = rows[0];
      const b = row && [...row.querySelectorAll("button")].find((x) => /Inspect Draft/.test(x.innerText || ""));
      if (b) b.click();
    }, F.execAgreementNumber);
    await delay(1000);
    viewerOpenNow = true;
  }
  const voidClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Void execution record/.test(x.innerText || ""));
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
  await delay(800);
  const voidDialogBefore = await probeAlertDialog(page);
  await clickDialogButton(page, "Void execution record");
  await delay(3000);
  const voidDialogAfter = await probeAlertDialog(page);
  const voidState = {
    agreement: (await c.query("agreements:listAgreements", { projectId: F.execProjectId })).find((a) => a._id === F.execAgreementId),
    bid: (await c.query("bids:listByPackage", { tradePackageId: F.execPackageId })).find((b) => b._id === F.execBidId),
    pkg: await c.query("tradePackages:getPackage", { tradePackageId: F.execPackageId }),
    logs: await c.query("auditLogs:listRecentLogs", { projectId: F.execProjectId, limit: 100 }),
  };
  const voidAudit = (voidState.logs || []).find((l) => /Executed Subcontract Voided/.test(l.title || ""));
  await shot(page, "fix4-qa13-A11-03-void-executed.png");
  record(
    "A11-03-void-supersedes-unawards-reopens-audits",
    voidClick.ok &&
      voidDialogBefore.dialogOpen &&
      voidState.agreement.status === "superseded" &&
      voidState.bid.isAwarded === false &&
      voidState.pkg.status === "leveling" &&
      Boolean(voidAudit),
    `dialogTitle=${JSON.stringify(voidDialogBefore.title)}; agreement=${voidState.agreement.status}; bidAwarded=${voidState.bid.isAwarded}; pkg=${voidState.pkg.status}; audit=${Boolean(voidAudit)}${voidAudit ? ` (${voidAudit.title})` : ""}; dialogStillOpen=${voidDialogAfter.dialogOpen}`
  );
  await page.keyboard.press("Escape").catch(() => {});
  await delay(300);

  // A11-03 delete project after void (last EXEC action)
  const execDelete = await c.mutation("projects:deleteProject", { projectId: F.execProjectId }).then(
    () => ({ ok: true }),
    (err) => ({ ok: false, error: String(err?.data ?? err?.message ?? err) })
  );
  const execGone = !(await c.query("projects:listProjects", {})).some((p) => p._id === F.execProjectId);
  record("A11-03-project-deletable-after-void", execDelete.ok && execGone, `delete=${JSON.stringify(execDelete)}; gone=${execGone}`);

  // ============================================================= MAIN: A12-06 + A12-02 UI + A11-04
  await selectProjectByTitle(page, "AUDIT-QA13-MAIN");
  await delay(2200);
  await clickHeaderTab(page, "06: Subcontracts");
  await delay(2200);
  const contractsProbe = await page.evaluate(
    ({ elecAgrNumber }) => {
      const text = document.body.innerText;
      const rows = [...document.querySelectorAll("main tr")];
      const row = rows.find((tr) => (tr.innerText || "").includes(elecAgrNumber));
      const totalEl = [...document.querySelectorAll("span")].find((s) => s.previousElementSibling && /Active Contracted Sum/.test(s.previousElementSibling.innerText || ""));
      return {
        hasElecRow: Boolean(row),
        elecRowText: row ? row.innerText.replace(/\s+/g, " ").slice(0, 220) : null,
        totalLabelValue: totalEl ? totalEl.innerText.trim() : null,
        hasFake: /Fake Bidder|Totally Fake/i.test(text),
        hasSupersededChip: /Superseded \(1\)/.test(text),
        bodyHasElecSum: /910,000/.test(text),
      };
    },
    { elecAgrNumber: B.details.elecAgrAfter.agreementNumber }
  );
  await shot(page, "fix4-qa13-A12-02-contracts-register.png");
  const totalOk = (contractsProbe.totalLabelValue || "").replace(/[^0-9]/g, "") === String(B.expected.contractsActiveTotal);
  record(
    "A12-02-ui-register-revised-sum",
    contractsProbe.hasElecRow &&
      contractsProbe.elecRowText.includes("910,000") &&
      contractsProbe.elecRowText.includes("AUDIT-QA13 Main Electric Co") &&
      totalOk &&
      !contractsProbe.hasFake,
    `elecRow=${JSON.stringify(contractsProbe.elecRowText)}; activeTotal=${contractsProbe.totalLabelValue} expected=${B.expected.contractsActiveTotal}; fakeText=${contractsProbe.hasFake}`
  );

  // A12-06: superseded agreement execute refusal inline
  const supersededFilter = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Superseded/.test(x.innerText || ""));
    if (!b) return false;
    b.click();
    return true;
  });
  await delay(900);
  const execSuperseded = await clickRowButton(page, "AUDIT-QA13 Plumbing", "Record Execution Status");
  await delay(800);
  await clickDialogButton(page, "Record execution");
  await delay(2500);
  const a1206 = await probeAlertDialog(page);
  await shot(page, "fix4-qa13-A12-06-superseded-execute-inline.png");
  record(
    "A12-06-execute-superseded-inline",
    supersededFilter &&
      execSuperseded.ok &&
      a1206.dialogOpen &&
      typeof a1206.inlineAlert === "string" &&
      /superseded agreement/i.test(a1206.inlineAlert),
    `filter=${supersededFilter}; click=${JSON.stringify(execSuperseded)}; alert=${JSON.stringify(a1206.inlineAlert)}; open=${a1206.dialogOpen}`
  );
  await clickDialogButton(page, "Cancel");
  await delay(400);

  // A11-04: Scope Clash per-card resolution line
  await clickHeaderTab(page, "05: Scope Clash");
  await delay(2200);
  const clashProbe = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("main div.rounded-xl")].filter((d) =>
      /Rooftop Mechanical Equipment Disconnect Switches/.test(d.innerText || "")
    );
    const card = cards[cards.length - 1];
    const kpiLabel = [...document.querySelectorAll("span")].find((s) => /Recoverable Buyout Credits/.test(s.innerText || ""));
    const kpiCard = kpiLabel ? kpiLabel.closest("div.rounded-xl") : null;
    return {
      found: Boolean(card),
      cardText: card ? card.innerText.replace(/\s+/g, " ").slice(0, 600) : null,
      deductedLine: card
        ? ((card.innerText || "").split("\n").find((l) => /Deducted|Deduct/.test(l)) || "").trim()
        : null,
      kpiValue: kpiCard ? ((kpiCard.innerText.match(/\$[\d,]+/) || [null])[0] || null) : null,
    };
  });
  await shot(page, "fix4-qa13-A11-04-clash-resolution.png");
  const applied = `$${B.expected.disconnectApplied.toLocaleString("en-US")}`;
  const benchmark = `$${B.expected.disconnectBenchmark.toLocaleString("en-US")}`;
  record(
    "A11-04-per-card-applied-credit",
    clashProbe.found && (clashProbe.deductedLine || "").includes(applied) && !(clashProbe.deductedLine || "").includes(benchmark),
    `deductedLine=${JSON.stringify(clashProbe.deductedLine)}; applied=${applied}; benchmark=${benchmark}; kpi=${clashProbe.kpiValue}`
  );

  // A12-02/A12-08 KPI + leveling + CSV
  await clickHeaderTab(page, "04: Bid Leveling");
  await delay(2000);
  await switchPackageInLeveling(page, "QA13 Electrical Main");
  await delay(1000);
  const levelingProbe = await page.evaluate(() => {
    const text = document.body.innerText;
    const kpi = text.match(/Leveled Buyout:\s*\$[\d,]+/);
    const subs = text.match(/Subcontracts:\s*\d+\/\d+ Awarded/);
    return {
      hasCanonical: text.includes("AUDIT-QA13 Main Electric Co"),
      hasFake: /Totally Fake|Fake Bidder/i.test(text),
      kpi: kpi ? kpi[0] : null,
      subs: subs ? subs[0] : null,
      hasRevised: /\$910,000/.test(text),
    };
  });
  await page.evaluate(() => {
    const orig = URL.createObjectURL;
    window.__qa13CsvBlob = null;
    URL.createObjectURL = function (blob) {
      window.__qa13CsvBlob = blob;
      return orig.call(URL, blob);
    };
  });
  const csvClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "") === "Export full ADR-0003 leveling matrix to CSV");
    if (!b) return false;
    b.click();
    return true;
  });
  await delay(700);
  const csvText = await page.evaluate(async () => {
    if (!window.__qa13CsvBlob) return null;
    try {
      return await window.__qa13CsvBlob.text();
    } catch (err) {
      return `ERR:${String(err)}`;
    }
  });
  await shot(page, "fix4-qa13-A12-08-leveling-csv.png");
  const csvOk =
    typeof csvText === "string" &&
    csvText.includes("AUDIT-QA13 Main Electric Co") &&
    !/Totally Fake|Fake Bidder/i.test(csvText) &&
    csvText.includes("910000");
  record(
    "A12-08-leveling-csv-canonical-name",
    csvOk && levelingProbe.hasCanonical && !levelingProbe.hasFake,
    `csvClick=${csvClick}; csvLen=${csvText ? csvText.length : null}; canonical=${levelingProbe.hasCanonical}; fake=${levelingProbe.hasFake}; csvHead=${JSON.stringify((csvText || "").split("\n").slice(0, 2))}`
  );
  const expectedBuyout = `$${B.expected.totalLeveledBuyout.toLocaleString("en-US")}`;
  record(
    "A12-02-ui-kpi-agrees",
    levelingProbe.kpi === `Leveled Buyout: ${expectedBuyout}` && levelingProbe.subs === "Subcontracts: 2/3 Awarded",
    `kpi=${JSON.stringify(levelingProbe.kpi)} expected=${expectedBuyout}; subs=${JSON.stringify(levelingProbe.subs)}`
  );

  // diagnostics
  const consoleErrors = diag.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 200));
  const diagnostics = {
    consoleErrors,
    pageErrors: diag.pageErrors.slice(0, 10),
    failedRequests: diag.failedRequests.slice(0, 10),
  };
  say(`UI-A diagnostics: ${JSON.stringify({ consoleErrors: consoleErrors.length, pageErrors: diagnostics.pageErrors.length, failedRequests: diagnostics.failedRequests.length })}`);

  writeEvidence("ui-a", {
    results,
    execLeveling,
    afterUnawardRefusal,
    afterDeleteRefusal,
    reopened,
    viewer,
    trap,
    trapShift,
    print: { popupInfo, contractLen: B.details.execContractLength, printDiag },
    escapeStack,
    void: {
      dialogBefore: voidDialogBefore,
      agreementStatus: voidState.agreement.status,
      bidAwarded: voidState.bid.isAwarded,
      pkgStatus: voidState.pkg.status,
      auditTitle: voidAudit ? voidAudit.title : null,
    },
    contractsProbe,
    a1206,
    clashProbe,
    levelingProbe,
    csvOk,
    diagnostics,
  });
  writeLog("ui-a", log);
  console.log(`\nUI-A results: ${results.filter((r) => r.pass).length}/${results.length} passed`);
  await browser.close();
}

main().catch(async (e) => {
  console.error(e);
  writeLog("ui-a-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});