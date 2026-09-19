/**
 * QA37-04 broad Medium+ regression, one pass (live) on AUDIT-QA37 fixtures:
 *  1. detect no-evidence honest zeros (2 pkgs/0 bids, 1 pkg, 0 pkgs)
 *  2. executed-contract immutability (backend refusal + UI inline confirm error)
 *  3. CSV formula neutralization (download)
 *  4. print popup: full contract text in an isolated document
 *  5. modal draft reset (ingest reopens clean)
 *  6. deep-link package persistence across reload
 *  7. superseded register row: read-only badge, no execute dead action
 *  8. F1 RFI: pending persisted before analysis -> clarified, question retained
 *  9. diagnostics
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, projectSnapshot, sleep, call, EVIDENCE_DIR, creditInvariants } from "./qa37-lib.mjs";

const F = readEvidence("fixtures");
const S = F.smoke;
const R = F.reg;
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const findings = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1200)}`);
};
const finding = (id, severity, title, evidence) => {
  findings.push({ id, severity, title, evidence });
  say(`FINDING ${id} [${severity}] ${title}`);
};

async function dismissTour(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
    b?.click();
  });
  await delay(400);
}

async function clickByText(page, text, exact = false) {
  return page.evaluate(({ text, exact }) => {
    const v = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const b = [...document.querySelectorAll("button")].find((x) => {
      const t = (x.innerText || "").replace(/\s+/g, " ").trim();
      return v(x) && (exact ? t === text : t.includes(text));
    });
    if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 50) };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim() };
  }, { text, exact });
}

async function clickDialogButton(page, label, exact = true) {
  return page.evaluate(({ label, exact }) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const ds = [...document.querySelectorAll('[role="alertdialog"],[role="dialog"]')].filter(vis);
    const top = ds[ds.length - 1];
    if (!top) return { ok: false, reason: "no dialog" };
    const b = [...top.querySelectorAll("button")].find((x) => {
      const t = (x.innerText || "").replace(/\s+/g, " ").trim();
      return exact ? t === label : t.includes(label);
    });
    if (!b) return { ok: false, buttons: [...top.querySelectorAll("button")].map((x) => (x.innerText || "").trim()) };
    b.click();
    return { ok: true };
  }, { label, exact });
}

async function main() {
  const c = client();

  // =========================== no-evidence zeros ===========================
  const noev = await c.query("coordination:detectCrossTradeClashes", { projectId: F.noev.id });
  const noevOne = await c.query("coordination:detectCrossTradeClashes", { projectId: F.noevOne.id });
  const noevNoPkg = await c.query("coordination:detectCrossTradeClashes", { projectId: F.noevNoPkg.id });
  const zeros = (d) => d.doubleBuys.length === 0 && d.scopeVoids.length === 0 && d.summary.activeClashesCount === 0 && d.summary.totalDoubleBuyExposure === 0 && d.summary.totalScopeVoidExposure === 0 && d.summary.netBuyoutExposure === 0;
  record("REG.detect-no-evidence", "clash detect returns honest zeros with no fabricated cards for 2-packages/0-bids, 1-package, and 0-package projects",
    zeros(noev) && zeros(noevOne) && zeros(noevNoPkg) && noev.provider === "Proposal-Evidence-Guard" && noevOne.provider === "Project-Scope-Guard" && noevNoPkg.provider === "Project-Scope-Guard",
    { noev: { provider: noev.provider, model: noev.model, summary: noev.summary }, noevOne: noevOne.summary, noevNoPkg: noevNoPkg.summary });

  // =========================== F1 RFI (submit first, poll later) ===========================
  const rfiQuestion = "QA37 regression: confirm the firestop sleeve responsibility at the slab penetration detail before bid submission.";
  const rfiSub = await call("F1.rfi.submit", () => c.mutation("simulation:submitCustomRfi", {
    tradePackageId: S.p2.id,
    contractorId: S.p2.contractors.one,
    subject: "AUDIT-QA37 REGRESSION RFI live smoke",
    question: rfiQuestion,
  }));
  const rfiRow = async () => (await c.query("rfq:listConversations", { tradePackageId: S.p2.id })).find((x) => x._id === (rfiSub.value?.conversationId));
  const rfiImmediate = rfiSub.ok ? await rfiRow() : null;
  say(`RFI submitted: ${JSON.stringify({ ok: rfiSub.ok, status: rfiImmediate?.status })}`);

  // =========================== executed immutability (backend) ===========================
  const genOther = await call("generate agreement for losing bid", () => c.mutation("agreements:generateAgreement", { bidId: S.p1.bids.beta, tradePackageId: S.p1.id }));
  const snapBeforeUi = await projectSnapshot(c, S.id);
  record("REG.executed-immutability", "executed-contract award-other refused readably (no generic Server Error); losing bid stays unawarded",
    !genOther.ok && /executed subcontract/i.test(genOther.data || "") && /Void or amend/i.test(genOther.data || "") && !/Server Error/i.test(genOther.data || "") &&
      snapBeforeUi.bids.find((b) => b._id === S.p1.bids.beta)?.isAwarded === false &&
      snapBeforeUi.agreements.filter((a) => a.tradePackageId === S.p1.id && a.status === "executed").length === 1,
    { ok: genOther.ok, data: genOther.data });

  // =========================== register fixture prep (superseded row) ===========================
  const a1 = await call("reg.award.B1", () => c.mutation("agreements:generateAgreement", { bidId: R.b26.bidId, tradePackageId: R.p26 }));
  const x1 = await call("reg.execute.B1", () => c.mutation("agreements:executeAgreement", { agreementId: a1.value?._id }));
  const a2whileExec = await call("reg.award.other.while.executed", () => c.mutation("agreements:generateAgreement", { bidId: R.b26b.bidId, tradePackageId: R.p26 }));
  const v1 = await call("reg.void.B1", () => c.mutation("agreements:voidExecutedAgreement", { agreementId: a1.value?._id, reason: "QA37 register fixture: execution recorded against superseded pricing, voided for replacement." }));
  const a2 = await call("reg.award.B2", () => c.mutation("agreements:generateAgreement", { bidId: R.b26b.bidId, tradePackageId: R.p26 }));
  const agrs = await c.query("agreements:listAgreements", { projectId: R.id });
  record("REG.register-fixture", "register fixture: B1 executed -> award-other refused -> void -> B2 awarded; one superseded + one pending row",
    a1.ok && x1.ok && !a2whileExec.ok && /executed subcontract/i.test(a2whileExec.data || "") && v1.ok && a2.ok &&
      agrs.some((a) => a._id === a1.value?._id && a.status === "superseded") && agrs.some((a) => a._id === a2.value?._id && a.status === "generated"),
    { a1: a1.value?.agreementNumber, refusal: a2whileExec.data, superseded: agrs.filter((a) => a.status === "superseded").length, generated: agrs.filter((a) => a.status === "generated").length });

  // =========================== browser pass ===========================
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa37-regression-downloads");
  fs.mkdirSync(dlDir, { recursive: true });
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });

  try {
    // ----- UI: inline confirm error on executed-bid unaward -----
    await page.goto(`${BASE}/?project=${S.id}&tab=leveling&qa37=regression`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour(page);
    await delay(2200);

    const unawardClick = await clickByText(page, "Unaward", true);
    let confirmOpen = false;
    for (let i = 0; i < 25 && !confirmOpen; i++) {
      await delay(200);
      confirmOpen = await page.evaluate(() => {
        const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        return [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).some((d) => /Unaward proposal\?/.test(d.innerText || ""));
      });
    }
    const unawardConfirm = await clickDialogButton(page, "Unaward proposal");
    let inline = null;
    for (let i = 0; i < 40; i++) {
      await delay(250);
      inline = await page.evaluate(() => {
        const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        const d = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
        const a = d ? d.querySelector('[role="alert"]') : null;
        return { dialogOpen: Boolean(d), inlineError: a ? (a.textContent || "").trim().slice(0, 240) : null };
      });
      if (inline?.inlineError) break;
    }
    await shot(page, "fix4-qa37-inline-confirm.png");
    const snapAfterUi = await projectSnapshot(c, S.id);
    record("REG.inline-confirm", "inline confirm error: unaward of the executed bid explains the refusal inside the dialog and mutates nothing",
      unawardClick.ok && confirmOpen && unawardConfirm.ok && inline?.dialogOpen === true && /executed subcontract|immutable/i.test(inline.inlineError || "") && !/Server Error/i.test(inline.inlineError || "") &&
        snapAfterUi.agreements.filter((a) => a.tradePackageId === S.p1.id && a.status === "executed").length === 1 &&
        snapAfterUi.bids.find((b) => b._id === S.p1.bids.alpha)?.isAwarded === true,
      { unawardClick, confirmOpen, unawardConfirm, inline });
    await clickDialogButton(page, "Cancel");
    await delay(500);

    // ----- modal draft reset on p2 -----
    await page.evaluate((plumbingName) => {
      const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.textContent || "").includes(plumbingName));
      b?.scrollIntoView({ block: "center" });
      b?.click();
    }, "QA37 SMOKE Plumbing");
    await delay(1600);

    const modalState = () =>
      page.evaluate(() => {
        const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).find((x) => /Direct Quote \/ PDF Bid Ingestion/.test(x.innerText || ""));
        if (!d) return { open: false };
        const sel = d.querySelector('select[aria-label="Subcontractor or bidder for this proposal"]');
        const ta = d.querySelector("textarea");
        return { open: true, bidder: sel?.value ?? null, firstOption: sel?.options?.[1]?.value ?? null, textarea: ta?.value ?? null };
      });

    const openIngest = async () => {
      await page.evaluate(() => {
        const v = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        const b = [...document.querySelectorAll("button")].filter(v).find((x) => (x.textContent || "").trim() === "Ingest Quote / PDF");
        b?.scrollIntoView({ block: "center" });
        b?.click();
      });
      for (let i = 0; i < 25; i++) {
        const s = await modalState();
        if (s.open) return s;
        await delay(250);
      }
      return modalState();
    };

    const firstOpen = await openIngest();
    const pickSecond = await page.evaluate((secondId) => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).find((x) => /Direct Quote \/ PDF Bid Ingestion/.test(x.innerText || ""));
      const sel = d?.querySelector('select[aria-label="Subcontractor or bidder for this proposal"]');
      if (!sel) return { ok: false };
      sel.value = secondId;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: sel.value };
    }, S.p2.contractors.two);
    await delay(300);
    await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).find((x) => /Direct Quote \/ PDF Bid Ingestion/.test(x.innerText || ""));
      const ta = d?.querySelector("textarea");
      if (ta) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(ta, "QA37 DRAFT MARKER");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await page.keyboard.press("Escape");
    await delay(600);
    const closed = await modalState();
    const reopen = await openIngest();
    await shot(page, "fix4-qa37-ingest-reopen.png");
    record("REG.modal-reset", "ingest modal reopens with the default bidder and an empty draft (no stale marker)",
      firstOpen.open && pickSecond.ok && closed.open === false && reopen.open && reopen.bidder === firstOpen.firstOption && reopen.bidder !== S.p2.contractors.two && (reopen.textarea || "") === "",
      { firstOpen, pickSecond, closed, reopen });
    await page.keyboard.press("Escape");
    await delay(400);

    // ----- deep-link package reload persistence -----
    const selectionState = () =>
      page.evaluate(() => ({
        url: location.href,
        stored: localStorage.getItem("tradepulse.selectedPackageId"),
        pressed: [...document.querySelectorAll("button[aria-pressed]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => (b.textContent || "").replace(/\s+/g, " ").trim()),
      }));
    const beforeReload = await selectionState();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour(page);
    await delay(2500);
    const afterReload = await selectionState();
    await shot(page, "fix4-qa37-deeplink-reload.png");
    record("REG.deeplink-reload", "deep-link package selection persists across reload (stored id + pressed ribbon stay on Plumbing)",
      beforeReload.stored === S.p2.id && afterReload.stored === S.p2.id && afterReload.pressed.some((t) => t.includes("Plumbing")) && !afterReload.pressed.some((t) => t.includes("Electrical")),
      { beforeReload, afterReload, expected: S.p2.id });

    // ----- print popup full contract -----
    await page.goto(`${BASE}/?project=${S.id}&tab=contracts&qa37=print`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour(page);
    await delay(2200);
    const inspect = await clickByText(page, "Inspect Draft");
    await delay(900);
    await page.evaluate(() => {
      window.__qa37Print = [];
      window.open = function () {
        const doc = { chunks: [], write(s) { this.chunks.push(String(s)); }, close() {} };
        const win = { document: doc, focus() {}, print() {}, close() {} };
        window.__qa37Print.push(win);
        return win;
      };
    });
    const printClick = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).find((x) => /A401-style Subcontract Draft/.test(x.innerText || ""));
      const b = d ? [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim().includes("Print")) : null;
      if (!b) return { ok: false };
      b.click();
      return { ok: true, text: (b.textContent || "").trim().slice(0, 40) };
    });
    await delay(900);
    const printed = await page.evaluate(() => {
      const w = (window.__qa37Print || [])[0];
      return w ? w.document.chunks.join("") : null;
    });
    const agreement = ((await c.query("agreements:listAgreements", { projectId: S.id })) || []).find((a) => a._id === S.p1.agreementId);
    const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const expectedHtml = agreement ? escapeHtml(agreement.contractText) : "";
    const chromeFree = printed !== null && !/New Project|CSI Scoping|Subcontract Draft Viewer|Bid Leveling Matrix/.test(printed);
    record("REG.print-popup", "print popup contains the full contract text in an isolated document (no app chrome)",
      inspect.ok && printClick.ok && printed !== null && printed.length > 2000 && printed.includes(expectedHtml) && chromeFree,
      { inspect, printClick, printedLen: printed?.length ?? 0, expectedLen: expectedHtml.length, includesFull: printed !== null && printed.includes(expectedHtml), chromeFree });

    // ----- CSV formula neutralization -----
    await page.goto(`${BASE}/?project=${F.csv.id}&tab=leveling&qa37=csv`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour(page);
    await delay(1500);
    const csvClick = await clickByText(page, "Export Leveling CSV");
    await delay(2800);
    const files = fs.readdirSync(dlDir).filter((f) => f.endsWith(".csv"));
    const newest = files.map((f) => ({ f, t: fs.statSync(path.join(dlDir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
    const csv = newest ? fs.readFileSync(path.join(dlDir, newest), "utf8") : "";
    const neutralized = /"'=1\+1"/.test(csv) && /"'@SUM\(1\+1\)"/.test(csv);
    const sampleLine = csv.split(/\r?\n/).find((l) => /1\+1|SUM/.test(l)) || "";
    record("REG.csv-neutralize", "CSV export neutralizes formula-prefixed bidder names with a leading apostrophe",
      csvClick.ok && csv.length > 0 && neutralized,
      { csvClick, newest, neutralized, sample: sampleLine.slice(0, 220) });

    // ----- superseded register row: read-only, no dead action -----
    await page.goto(`${BASE}/?project=${R.id}&tab=contracts&qa37=register`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour(page);
    await delay(1800);
    const clickChip = async (needle) =>
      page.evaluate((n) => {
        const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        const b = [...document.querySelectorAll("button")].filter(vis).find((x) => (x.innerText || "").replace(/\s+/g, " ").trim() === n);
        if (!b) return { ok: false };
        b.click();
        return { ok: true };
      }, needle);
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()).filter((t) => /^(Active Contracts|Execution Status Recorded|Pending Execution|Superseded)/.test(t))
    );
    const supChip = chips.find((x) => /^Superseded \(/.test(x)) || null;
    const chipClick = await clickChip(supChip);
    await delay(900);
    const supRowState = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("table tbody tr")].map((tr) => ({
        cells: [...tr.querySelectorAll("td")].map((td) => (td.innerText || "").replace(/\s+/g, " ").trim()),
        buttons: [...tr.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()),
      }));
      return rows[0] || null;
    });
    await shot(page, "fix4-qa37-register-superseded.png");
    const supBadge = Boolean(supRowState) && supRowState.cells.some((cd) => /Superseded — read-only/.test(cd));
    const supPending = Boolean(supRowState) && supRowState.cells.some((cd) => /Pending Execution|Execution Status Recorded/.test(cd));
    const supExecute = Boolean(supRowState) && supRowState.buttons.some((b) => /Record Execution Status/.test(b));
    record("REG.superseded-register", "superseded register row is read-only (badge shown, no Pending badge, no 'Record Execution Status' dead action) while Inspect Draft stays available",
      chipClick.ok && Boolean(supRowState) && supBadge && !supPending && !supExecute && supRowState.buttons.some((b) => b.includes("Inspect Draft")),
      { chips, chip: supChip, supBadge, supPending, supExecute, buttons: supRowState?.buttons, cells: supRowState?.cells });

    // ----- F1 RFI final status (analysis had the whole UI pass to complete) -----
    let progress = await rfiRow();
    if (progress?.status === "escalated_to_pm") {
      try {
        await c.mutation("rfq:reviewEscalatedRfi", { conversationId: rfiSub.value.conversationId, status: "clarified", reviewNote: "QA37 regression: PM certification to complete pending->clarified." });
        progress = await rfiRow();
      } catch (err) {
        say(`certify failed: ${err?.data ?? err?.message}`);
      }
    }
    const rfiErr = progress?.analysisError || progress?.error || null;
    record("REG.F1-rfi", "F1: RFI persisted pending before analysis and reached clarified with the question text retained",
      rfiSub.ok && ["pending_analysis", "clarified", "escalated_to_pm"].includes(rfiImmediate?.status) && progress?.status === "clarified" && (progress.inboundQuestion || "").includes("firestop sleeve"),
      { submitOk: rfiSub.ok, firstStatus: rfiImmediate?.status, finalStatus: progress?.status, questionLen: (progress?.inboundQuestion || "").length, error: rfiErr });

    // ----- credit invariants untouched by register/claims work -----
    const invSmoke = await creditInvariants(c, S.id);
    const invReg = await creditInvariants(c, R.id);
    record("REG.credits-untouched", "no cross-trade credit or leveled drift was fabricated/cleared by the regression pass (SMOKE + REG)",
      invSmoke.leveledDrift.length === 0 && invSmoke.acceptedCredits.length === 0 && invReg.leveledDrift.length === 0 && invReg.acceptedCredits.length === 0,
      { smoke: invSmoke.summary, reg: invReg.summary, smokeDrift: invSmoke.leveledDrift, regDrift: invReg.leveledDrift });

    // ----- diagnostics -----
    const appConsoleErrors = diag.consoleLogs.filter((l) => l.type === "error" && !/^\[CONVEX [MQA]\(/.test(l.text));
    record("REG.diagnostics", "regression journey: zero page errors; every console error is the Convex client's own '[CONVEX M(...)]' refusal log (no application errors)",
      diag.pageErrors.length === 0 && appConsoleErrors.length === 0,
      { pageErrors: diag.pageErrors.slice(0, 4), libraryConsoleErrors: diag.consoleLogs.filter((l) => l.type === "error" && /^\[CONVEX [MQA]\(/.test(l.text)).map((e) => e.text.slice(0, 160)).slice(0, 5), appConsoleErrors: appConsoleErrors.map((e) => e.text.slice(0, 200)) });
  } catch (err) {
    record("REG.ERR", "regression ui pass aborted", false, { error: String(err?.stack ?? err) });
  } finally {
    const out = { results, findings, pageErrors: diag.pageErrors.slice(0, 8), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 220)).slice(-8), summary: { pass: results.filter((r) => r.pass).length, total: results.length, findings: findings.length } };
    writeEvidence("regression", out);
    writeLog("regression", log);
    await browser.close();
    console.log(`regression: ${results.filter((r) => r.pass).length}/${results.length} pass, ${findings.length} findings`);
    if (results.some((r) => !r.pass) || findings.length) process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("regression-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});