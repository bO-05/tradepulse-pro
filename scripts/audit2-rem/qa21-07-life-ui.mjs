/**
 * QA21-07 UI verification on AUDIT-QA21-LIFE:
 *  A20-02  Bid Leveling "Inspect Draft" viewer a11y (role/aria-modal/label/Escape/trap/restore/close name)
 *  A20-03  Void execution record from the open Contracts viewer -> immediate superseded state
 *  A19-01  Ingest Quote modal reopens with the default bidder (not the previously picked one)
 *  HUNT    post-void viewer remaining actions (dead action probe)
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, projectSnapshot } from "./qa21-lib.mjs";

const F = readEvidence("01-fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1100)}`);
};

async function dismissTour(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(600);
}

async function levelingDialogState(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).find((x) => /A401-style Subcontract Draft/.test(x.innerText || ""));
    if (!d) return { open: false };
    const labelledBy = d.getAttribute("aria-labelledby");
    const labelEl = labelledBy ? document.getElementById(labelledBy) : null;
    const active = document.activeElement;
    const closeBtn = [...d.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Close subcontract draft viewer");
    return {
      open: true,
      role: d.getAttribute("role"),
      ariaModal: d.getAttribute("aria-modal"),
      labelledBy,
      labelText: labelEl ? (labelEl.textContent || "").replace(/\s+/g, " ").trim() : null,
      closeButtonName: closeBtn ? closeBtn.getAttribute("aria-label") : null,
      activeInsideDialog: Boolean(active && d.contains(active)),
      activeDescriptor: active ? `${active.tagName}:${(active.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30)}` : null,
    };
  });
}

async function main() {
  const c = client();
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  // =========================== A20-02 ===========================
  await page.goto(`${BASE}/?project=${F.life.id}&tab=leveling&qa21=a20-02`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await dismissTour(page);
  await delay(2200);

  const opener = await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const b = [...document.querySelectorAll("button")].filter(vis).find((x) => (x.textContent || "").trim() === "Inspect Draft");
    if (!b) {
      return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40) };
    }
    b.setAttribute("data-qa21-opener", "1");
    b.scrollIntoView({ block: "center" });
    b.focus();
    const r = b.getBoundingClientRect();
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, focusedBeforeClick: document.activeElement === b };
  });
  say(`opener: ${JSON.stringify(opener)}`);
  if (opener.ok) await page.mouse.click(opener.x, opener.y);
  for (let i = 0; i < 30; i++) {
    const s = await levelingDialogState(page);
    if (s.open) break;
    await delay(300);
  }
  const dlg = await levelingDialogState(page);
  await shot(page, "fix4-qa21-leveling-viewer-open.png");
  say(`dialog: ${JSON.stringify(dlg)}`);

  record(
    "A20-02.dialog-semantics",
    "viewer has role=dialog + aria-modal + labelled title + named close button",
    dlg.open &&
      dlg.role === "dialog" &&
      dlg.ariaModal === "true" &&
      dlg.labelledBy === "leveling-agreement-title" &&
      /A401-style Subcontract Draft/.test(dlg.labelText || "") &&
      dlg.closeButtonName === "Close subcontract draft viewer",
    dlg
  );

  // Focus trap: Tab around and ensure focus never leaves the dialog.
  let escaped = null;
  const tabTrace = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    const st = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /A401-style Subcontract Draft/.test(x.innerText || ""));
      const a = document.activeElement;
      return { inside: Boolean(d && a && d.contains(a)), desc: a ? `${a.tagName}:${(a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 26)}` : null };
    });
    tabTrace.push(st.desc);
    if (!st.inside && !escaped) escaped = { direction: "forward", step: i, ...st };
  }
  for (let i = 0; i < 10; i++) {
    await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
    const st = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /A401-style Subcontract Draft/.test(x.innerText || ""));
      const a = document.activeElement;
      return { inside: Boolean(d && a && d.contains(a)), desc: a ? `${a.tagName}:${(a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 26)}` : null };
    });
    tabTrace.push(st.desc);
    if (!st.inside && !escaped) escaped = { direction: "backward", step: i, ...st };
  }
  record("A20-02.focus-trap", "Tab/Shift+Tab never leave the open viewer", !escaped, { escaped, trace: tabTrace.slice(0, 8) });

  await page.keyboard.press("Escape");
  await delay(600);
  const afterEscape = await levelingDialogState(page);
  const focusRestored = await page.evaluate(() => document.activeElement?.getAttribute("data-qa21-opener") === "1");
  await shot(page, "fix4-qa21-leveling-viewer-closed.png");
  record(
    "A20-02.escape-close-restore",
    "Escape closes the viewer and focus is restored to the Inspect Draft opener",
    !afterEscape.open && focusRestored,
    { afterEscape, focusRestored }
  );

  // =========================== A20-03 ===========================
  await page.goto(`${BASE}/?project=${F.life.id}&tab=contracts&qa21=a20-03`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await dismissTour(page);
  await delay(2200);

  const contractViewerState = () =>
    page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).find((x) => /A401-style Subcontract Draft/.test(x.innerText || ""));
      if (!d) return { open: false };
      const t = d.innerText || "";
      const buttons = [...d.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim());
      return {
        open: true,
        executedBanner: /Execution recorded in TradePulse/i.test(t),
        recordedBadge: /RECORDED SIGNATURE REQUIRED/i.test(t),
        hasVoidButton: buttons.some((b) => b === "Void execution record"),
        hasRecordButton: buttons.some((b) => b === "Record External Execution"),
        badgeSuperseded: /SUPERSEDED/i.test(t),
        buttons: buttons.slice(0, 14),
      };
    });

  const openRegisterViewer = async () => {
    const clicked = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].filter(vis).find((x) => (x.textContent || "").trim() === "Inspect Draft");
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true };
    });
    for (let i = 0; i < 30; i++) {
      const s = await contractViewerState();
      if (s.open) return { clicked, state: s };
      await delay(300);
    }
    return { clicked, state: await contractViewerState() };
  };

  const open1 = await openRegisterViewer();
  say(`contract viewer pre-void: ${JSON.stringify(open1)}`);
  await shot(page, "fix4-qa21-contracts-viewer-executed.png");

  const voidClick = await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).find((x) => /A401-style Subcontract Draft/.test(x.innerText || ""));
    if (!d) return { ok: false };
    const b = [...d.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Void execution record");
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
  await delay(700);
  const voidDlg = await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const d = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
    if (!d) return { open: false };
    return { open: true, title: (d.querySelector("h2") || {}).innerText || "", confirmLabel: [...d.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).find((x) => /Void execution record/.test(x)) || null };
  });
  say(`void confirm dialog: ${JSON.stringify(voidDlg)}`);

  const t0 = Date.now();
  const voidConfirm = await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const d = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
    if (!d) return false;
    const b = [...d.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Void execution record");
    if (!b) return false;
    b.click();
    return true;
  });

  let postVoid = null;
  let elapsedMs = null;
  for (let i = 0; i < 100; i++) {
    await delay(120);
    const s = await contractViewerState();
    if (s.open && !s.executedBanner && !s.hasVoidButton) {
      postVoid = s;
      elapsedMs = Date.now() - t0;
      break;
    }
  }
  if (!postVoid) {
    postVoid = await contractViewerState();
    elapsedMs = Date.now() - t0;
  }
  await delay(900);
  await shot(page, "fix4-qa21-contracts-viewer-voided.png");

  const snap = await projectSnapshot(c, F.life.id);
  const agr = snap.agreements.find((a) => a._id === F.life.agreementId);
  const pkg = snap.packages.find((p) => p._id === F.life.packageId);
  const awarded = snap.bids.filter((b) => b.isAwarded).map((b) => b._id);
  say(`post-void backend: agreement=${agr?.status} pkg=${pkg?.status} awarded=${JSON.stringify(awarded)}`);
  record(
    "A20-03.viewer-refresh-without-reload",
    "void from open viewer flips it to superseded state immediately (banner + Void gone)",
    voidClick.ok &&
      voidDlg.open &&
      voidConfirm &&
      Boolean(postVoid?.open) &&
      postVoid.executedBanner === false &&
      postVoid.hasVoidButton === false &&
      agr?.status === "superseded" &&
      pkg?.status === "leveling" &&
      awarded.length === 0,
    { voidDlg, postVoid, elapsedMs, agreementStatus: agr?.status, packageStatus: pkg?.status, awardedBids: awarded, backendCheckMs: Date.now() - t0 }
  );

  // ---- HUNT: remaining action after void (dead action probe) ----
  const postVoidButtons = postVoid?.buttons || [];
  let deadAction = null;
  if (postVoid?.hasRecordButton) {
    const recClick = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).find((x) => /A401-style Subcontract Draft/.test(x.innerText || ""));
      const b = d ? [...d.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Record External Execution") : null;
      if (!b) return false;
      b.click();
      return true;
    });
    await delay(500);
    const recDlg = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const d = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
      if (!d) return { open: false };
      return { open: true, title: (d.querySelector("h2") || {}).innerText || "" };
    });
    const recConfirm = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const d = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
      if (!d) return false;
      const b = [...d.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Record execution");
      if (!b) return false;
      b.click();
      return true;
    });
    let inlineError = null;
    for (let i = 0; i < 30 && !inlineError; i++) {
      await delay(250);
      inlineError = await page.evaluate(() => {
        const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        const d = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
        const a = d ? d.querySelector('[role="alert"]') : null;
        return a ? (a.textContent || "").trim() : null;
      });
    }
    const afterState = await projectSnapshot(c, F.life.id);
    const afterAgr = afterState.agreements.find((a) => a._id === F.life.agreementId);
    deadAction = { recClick, recDlg, recConfirm, inlineError, agreementStillSuperseded: afterAgr?.status === "superseded" };
    await shot(page, "fix4-qa21-contracts-viewer-dead-action.png");
    if (recDlg.open) {
      await page.evaluate(() => {
        const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        const d = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
        const b = d ? [...d.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Cancel") : null;
        b?.click();
      });
      await delay(400);
    }
    record(
      "A21-02.post-void-record-dead-action",
      "HUNT: post-void viewer must not offer an action that can only fail",
      !(recClick && recConfirm && inlineError),
      { postVoidButtons, deadAction }
    );
  } else {
    record("A21-02.post-void-record-dead-action", "HUNT: no dead Record action offered post-void", true, { postVoidButtons });
  }

  // =========================== A19-01 ===========================
  await page.goto(`${BASE}/?project=${F.life.id}&tab=leveling&qa21=a19-01`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await dismissTour(page);
  await delay(2200);

  const modalSelectState = () =>
    page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).find((x) => /Direct Quote \/ PDF Bid Ingestion/.test(x.innerText || ""));
      if (!d) return { open: false };
      const sel = d.querySelector('select[aria-label="Subcontractor or bidder for this proposal"]');
      if (!sel) return { open: true, select: null };
      return {
        open: true,
        value: sel.value,
        selectedText: sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent.trim() : null,
        options: [...sel.options].map((o) => ({ value: o.value, text: o.textContent.trim() })),
      };
    });

  const backendContractors = (await c.query("contractors:listByPackage", { tradePackageId: F.life.packageId })) || [];
  const firstBackendContractor = backendContractors[0]?._id ?? null;
  const betaId = F.life.contractors.beta;

  const openIngest = async () => {
    await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].filter(vis).find((x) => (x.textContent || "").trim() === "Ingest Quote / PDF");
      b?.scrollIntoView({ block: "center" });
      b?.click();
    });
    for (let i = 0; i < 25; i++) {
      const s = await modalSelectState();
      if (s.open) return s;
      await delay(250);
    }
    return modalSelectState();
  };

  const firstOpen = await openIngest();
  say(`ingest modal first open: ${JSON.stringify(firstOpen)}`);

  // Pick the second bidder (Beta) explicitly.
  const pickBeta = await page.evaluate((beta) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).find((x) => /Direct Quote \/ PDF Bid Ingestion/.test(x.innerText || ""));
    const sel = d?.querySelector('select[aria-label="Subcontractor or bidder for this proposal"]');
    if (!sel) return { ok: false };
    sel.value = beta;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: sel.value };
  }, betaId);
  await delay(300);
  const afterPick = await modalSelectState();
  say(`after picking beta: ${JSON.stringify(afterPick)}`);

  // Type a draft marker to also confirm the clean-draft reset on reopen.
  await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).find((x) => /Direct Quote \/ PDF Bid Ingestion/.test(x.innerText || ""));
    const ta = d?.querySelector("textarea");
    if (ta) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, "QA21 DRAFT MARKER");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.keyboard.press("Escape");
  await delay(600);
  const closed = await modalSelectState();
  const reopen = await openIngest();
  await shot(page, "fix4-qa21-ingest-reopen.png");

  record(
    "A19-01.ingest-default-bidder",
    "reopened ingest modal defaults to the first bidder, not the previously picked one",
    closed.open === false &&
      afterPick.value === betaId &&
      reopen.open === true &&
      reopen.value === firstBackendContractor &&
      reopen.value !== betaId &&
      reopen.options?.[1]?.value === firstBackendContractor,
    {
      backendContractorOrder: backendContractors.map((x) => ({ id: x._id, name: x.companyName })),
      firstOpen: { value: firstOpen.value, selectedText: firstOpen.selectedText },
      afterPick: { value: afterPick.value, selectedText: afterPick.selectedText },
      reopen: { value: reopen.value, selectedText: reopen.selectedText, option1: reopen.options?.[1] },
      betaId,
      firstBackendContractor,
    }
  );

  // Clean up: close the modal.
  await page.keyboard.press("Escape");
  await delay(400);

  const out = {
    results,
    pageErrors: diag.pageErrors.slice(0, 8),
    consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 240)).slice(-10),
    summary: { pass: results.filter((r) => r.pass).length, total: results.length },
  };
  writeEvidence("07-life-ui", out);
  writeLog("07-life-ui", log);
  await browser.close();
  console.log(`life ui: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("07-life-ui-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});