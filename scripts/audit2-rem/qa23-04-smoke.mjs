/**
 * QA23-04 core re-smoke (live, one pass) on AUDIT-QA23-SMOKE / AUDIT-QA23-CSV:
 *  F1 RFI pending->clarified | executed-contract award-other refused readably (BE+UI)
 *  CSV formula neutralization | print popup full contract | inline confirm errors
 *  cron no-bids idempotent | modal draft reset | deep-link package reload persistence
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot, clickTab } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, projectSnapshot, sleep, call, EVIDENCE_DIR } from "./qa23-lib.mjs";

const F = readEvidence("01-fixtures");
const S = F.smoke;
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1000)}`);
};

async function poll(fn, predicate, timeoutMs, stepMs = 2000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(stepMs);
  }
  return last;
}

async function dismissTour(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(500);
}

async function clickByText(page, text, exact = false) {
  return page.evaluate(
    ({ text, exact }) => {
      const v = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => {
        const t = (x.innerText || "").replace(/\s+/g, " ").trim();
        return v(x) && (exact ? t === text : t.includes(text));
      });
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim(), disabled: b.disabled };
    },
    { text, exact }
  );
}

async function main() {
  const c = client();

  // =========================== F1: RFI pending -> clarified ===========================
  const rfiQuestion = "QA23 smoke: confirm the firestop sleeve responsibility at the slab penetration detail before bid submission.";
  const rfiSub = await c.mutation("simulation:submitCustomRfi", {
    tradePackageId: S.p2.id,
    contractorId: S.p2.contractors.one,
    subject: "AUDIT-QA23 SMOKE RFI live smoke",
    question: rfiQuestion,
  });
  const immediately = await c.query("rfq:listConversations", { tradePackageId: S.p2.id });
  const pendingRow = (immediately || []).find((x) => x._id === rfiSub.conversationId);
  const firstStatus = pendingRow?.status ?? null;
  let progress = await poll(
    () => c.query("rfq:listConversations", { tradePackageId: S.p2.id }).then((r) => (r || []).find((x) => x._id === rfiSub.conversationId)),
    (row) => row && ["clarified", "escalated_to_pm", "failed_analysis"].includes(row.status),
    180000
  );
  let certified = false;
  if (progress?.status === "escalated_to_pm") {
    try {
      await c.mutation("rfq:reviewEscalatedRfi", {
        conversationId: rfiSub.conversationId,
        status: "clarified",
        reviewNote: "QA23 smoke: PM certification to complete pending->clarified.",
      });
      certified = true;
      progress = await c.query("rfq:listConversations", { tradePackageId: S.p2.id }).then((r) => (r || []).find((x) => x._id === rfiSub.conversationId));
    } catch (err) {
      say(`certify failed: ${err?.data ?? err?.message}`);
    }
  }
  record(
    "SMOKE.F1",
    "F1: RFI persisted pending before analysis and reached clarified with the question text retained",
    ["pending_analysis", "clarified", "escalated_to_pm"].includes(firstStatus) &&
      progress?.status === "clarified" &&
      (progress.inboundQuestion || "").includes("firestop sleeve"),
    { firstStatus, finalStatus: progress?.status, certified, questionLen: (progress?.inboundQuestion || "").length, error: progress?.analysisError || null }
  );

  // =========================== cron no-bids idempotent ===========================
  const cron1 = await call("cron#1", () => c.mutation("crons:runDeadlineMonitorNow", { projectId: S.id }));
  const cron2 = await call("cron#2", () => c.mutation("crons:runDeadlineMonitorNow", { projectId: S.id }));
  const snapCron = await projectSnapshot(c, S.id);
  const p3 = snapCron.packages.find((p) => p._id === S.p3.id);
  const p4 = snapCron.packages.find((p) => p._id === S.p4.id);
  const noBidFlags = snapCron.logs.filter((l) => l.title.startsWith("Deadline passed with no bids: QA23 SMOKE Concrete No Bids")).length;
  const closeLogs = snapCron.logs.filter((l) => l.title === "Cron Monitor: Bid Deadline Closed for QA23 SMOKE Sitework With Bid").length;
  const manualLogs = snapCron.logs.filter((l) => l.title === "Manual Trigger: Bid Deadline Monitor Executed").length;
  // Deadline day ends at 23:59:59.999Z + 12h local-day slack (A17-01). The flag /
  // close branches are only reachable after that instant; before it the monitor
  // must make no premature change. Both must be stable across the two runs.
  const slackEndsAt = Date.parse(`${F.dates.minus1}T23:59:59.999Z`) + 12 * 60 * 60 * 1000;
  const shouldClose = Date.now() >= slackEndsAt;
  record(
    "SMOKE.cron",
    "cron no-bids idempotent: two runs flag zero-bid package at most once (none before slack), close package at most once, per-run logs stable",
    cron1.ok && cron2.ok && noBidFlags === (shouldClose ? 1 : 0) && p3?.status === "rfqs_dispatched" &&
      closeLogs === (shouldClose ? 1 : 0) && p4?.status === (shouldClose ? "leveling" : "rfqs_dispatched") && manualLogs === 2,
    { shouldClose, slackEndsAt: new Date(slackEndsAt).toISOString(), noBidFlags, closeLogs, manualLogs, p3: p3?.status, p4: p4?.status, note: shouldClose ? "overdue branch exercised" : "pre-slack: no premature flag/close; repeat-run stability proven" }
  );

  // =========================== backend: award-other refused readably ===========================
  const genOther = await call("generate agreement for losing bid", () => c.mutation("agreements:generateAgreement", {
    bidId: S.p1.bids.beta,
    tradePackageId: S.p1.id,
  }));
  record(
    "SMOKE.award-other-readable",
    "executed-contract award-other refused with readable ConvexError data (no generic Server Error)",
    !genOther.ok && /executed subcontract/i.test(genOther.data || "") && /Void or amend/i.test(genOther.data || "") && !/Server Error/i.test(genOther.data || ""),
    { ok: genOther.ok, data: genOther.data }
  );

  // =========================== browser pass ===========================
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa23-smoke-downloads");
  fs.mkdirSync(dlDir, { recursive: true });
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });

  try {
    // ----- UI: award-other refused (toast) + inline confirm error -----
    await page.goto(`${BASE}/?project=${S.id}&tab=leveling&qa23=smoke`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour(page);
    await delay(2200);

    const beforeAttempt = await projectSnapshot(c, S.id);
    const betaAwardClick = await page.evaluate((betaName) => {
      const v = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const cards = [...document.querySelectorAll("div")].filter((d) => v(d) && (d.textContent || "").includes(betaName) && (d.textContent || "").includes("Award Subcontract & Draft Agreement"));
      const card = cards[cards.length - 1];
      const b = card ? [...card.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Award Subcontract & Draft Agreement")) : null;
      if (!b) return { ok: false, availableButtons: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim() };
    }, "AUDIT-QA23 SMOKE Beta Electric");
    let awardToast = null;
    for (let i = 0; i < 40 && !awardToast; i++) {
      await delay(300);
      awardToast = await page.evaluate(() => {
        const t = [...document.querySelectorAll('[role="status"]')].map((e) => (e.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean);
        return t.find((x) => /Award failed|executed subcontract|immutable/i.test(x)) || null;
      });
    }
    const afterAttempt = await projectSnapshot(c, S.id);
    const p1Executed = afterAttempt.agreements.filter((a) => a.tradePackageId === S.p1.id && a.status === "executed").length;
    const p1Active = afterAttempt.agreements.filter((a) => a.tradePackageId === S.p1.id && a.status !== "superseded").length;
    const betaStillUnawarded = afterAttempt.bids.find((b) => b._id === S.p1.bids.beta)?.isAwarded === false;
    record(
      "SMOKE.ui-award-other",
      "UI award-other on the executed package shows the readable refusal and mutates nothing",
      betaAwardClick.ok && Boolean(awardToast) && /executed subcontract/i.test(awardToast || "") &&
        p1Executed === 1 && p1Active === 1 && betaStillUnawarded &&
        afterAttempt.agreements.length === beforeAttempt.agreements.length,
      { betaAwardClick, awardToast, p1Executed, p1Active, betaStillUnawarded }
    );

    // inline confirm error: Unaward the executed bid
    const unawardClick = await clickByText(page, "Unaward", true);
    await delay(600);
    const unawardConfirm = await clickByText(page, "Unaward proposal", true);
    let inline = null;
    for (let i = 0; i < 30; i++) {
      await delay(250);
      inline = await page.evaluate(() => {
        const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        const d = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
        const a = d ? d.querySelector('[role="alert"]') : null;
        return { dialogOpen: Boolean(d), inlineError: a ? (a.textContent || "").trim().slice(0, 240) : null };
      });
      if (inline?.inlineError) break;
    }
    await shot(page, "fix4-qa23-smoke-inline-confirm.png");
    const afterUnaward = await projectSnapshot(c, S.id);
    record(
      "SMOKE.inline-confirm",
      "inline confirm error: unaward of the executed bid explains the refusal inside the dialog and mutates nothing",
      unawardClick.ok && unawardConfirm.ok && inline?.dialogOpen === true &&
        /executed subcontract|immutable/i.test(inline.inlineError || "") && !/Server Error/i.test(inline.inlineError || "") &&
        afterUnaward.agreements.filter((a) => a.tradePackageId === S.p1.id && a.status === "executed").length === 1,
      { unawardClick, unawardConfirm, inline }
    );
    await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const d = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
      const b = d ? [...d.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Cancel") : null;
      b?.click();
    });
    await delay(500);

    // ----- modal draft reset on p2 -----
    await page.evaluate((plumbingName) => {
      const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.textContent || "").includes(plumbingName));
      b?.scrollIntoView({ block: "center" });
      b?.click();
    }, "QA23 SMOKE Plumbing");
    await delay(1600);

    const modalState = () =>
      page.evaluate(() => {
        const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).find((x) => /Direct Quote \/ PDF Bid Ingestion/.test(x.innerText || ""));
        if (!d) return { open: false };
        const sel = d.querySelector('select[aria-label="Subcontractor or bidder for this proposal"]');
        const ta = d.querySelector("textarea");
        return {
          open: true,
          bidder: sel?.value ?? null,
          selectedText: sel?.options?.[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent.trim() : null,
          firstOption: sel?.options?.[1]?.value ?? null,
          textarea: ta?.value ?? null,
        };
      });

    const backendContractors = (await c.query("contractors:listByPackage", { tradePackageId: S.p2.id })) || [];
    const firstContractor = backendContractors[0]?._id ?? null;

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
        setter.call(ta, "QA23 DRAFT MARKER");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await page.keyboard.press("Escape");
    await delay(600);
    const closed = await modalState();
    const reopen = await openIngest();
    await shot(page, "fix4-qa23-smoke-ingest-reopen.png");
    record(
      "SMOKE.modal-draft-reset",
      "ingest modal reopens with the default first bidder and an empty draft (no stale marker)",
      firstOpen.open && pickSecond.ok && closed.open === false && reopen.open &&
        reopen.bidder === firstContractor && reopen.bidder !== S.p2.contractors.two &&
        (reopen.textarea || "") === "",
      { firstOpen, pickSecond, closed, reopen, firstContractor, secondContractor: S.p2.contractors.two }
    );
    await page.keyboard.press("Escape");
    await delay(400);

    // ----- deep-link package reload persistence -----
    const selectionState = () =>
      page.evaluate(() => ({
        url: location.href,
        stored: localStorage.getItem("tradepulse.selectedPackageId"),
        pressed: [...document.querySelectorAll("button[aria-pressed]")]
          .filter((b) => b.getAttribute("aria-pressed") === "true")
          .map((b) => (b.textContent || "").replace(/\s+/g, " ").trim()),
      }));
    const beforeReload = await selectionState();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour(page);
    await delay(2500);
    const afterReload = await selectionState();
    await shot(page, "fix4-qa23-smoke-deeplink-reload.png");
    record(
      "SMOKE.deeplink-reload",
      "deep-link package selection persists across reload (stored id + pressed ribbon stay on Plumbing)",
      beforeReload.stored === S.p2.id &&
        afterReload.stored === S.p2.id &&
        afterReload.pressed.some((t) => t.includes("Plumbing")) &&
        !afterReload.pressed.some((t) => t.includes("Electrical")),
      { beforeReload, afterReload, expected: S.p2.id }
    );

    // ----- print popup full contract (contracts register viewer) -----
    await page.goto(`${BASE}/?project=${S.id}&tab=contracts&qa23=print`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour(page);
    await delay(2200);
    const inspect = await clickByText(page, "Inspect Draft");
    await delay(900);
    await page.evaluate(() => {
      window.__qa23Print = [];
      window.open = function () {
        const doc = { chunks: [], write(s) { this.chunks.push(String(s)); }, close() {} };
        const win = { document: doc, focus() {}, print() {}, close() {} };
        window.__qa23Print.push(win);
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
    await delay(800);
    const printed = await page.evaluate(() => {
      const w = (window.__qa23Print || [])[0];
      return w ? w.document.chunks.join("") : null;
    });
    const agreement = ((await c.query("agreements:listAgreements", { projectId: S.id })) || []).find((a) => a._id === S.p1.agreementId);
    const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const expectedHtml = agreement ? escapeHtml(agreement.contractText) : "";
    const chromeFree = printed !== null && !/New Project|CSI Scoping|Subcontract Draft Viewer|Bid Leveling Matrix/.test(printed);
    record(
      "SMOKE.print-popup",
      "print popup contains the full contract text in an isolated document (no app chrome)",
      inspect.ok && printClick.ok && printed !== null && printed.length > 2000 &&
        printed.includes(expectedHtml) && chromeFree,
      { inspect, printClick, printedLen: printed?.length ?? 0, expectedLen: expectedHtml.length, includesFull: printed !== null && printed.includes(expectedHtml), chromeFree }
    );

    // ----- CSV formula neutralization -----
    await page.goto(`${BASE}/?project=${F.csv.id}&tab=leveling&qa23=csv`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour(page);
    await delay(1500);
    const csvClick = await clickByText(page, "Export Leveling CSV");
    await delay(2800);
    const files = fs.readdirSync(dlDir).filter((f) => f.endsWith(".csv"));
    const newest = files.map((f) => ({ f, t: fs.statSync(path.join(dlDir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
    const csv = newest ? fs.readFileSync(path.join(dlDir, newest), "utf8") : "";
    const neutralized = /"'=1\+1"/.test(csv) && /"'@SUM\(1\+1\)"/.test(csv);
    const rawAtStart = csv.split(/\r?\n/).some((l) => /(^|,)"?[=+@]-?/.test(l) && !/"?\'/.test(l) && /=1\+1|@SUM/.test(l));
    record(
      "SMOKE.csv-neutralize",
      "CSV export neutralizes formula-prefixed bidder names with a leading apostrophe",
      csvClick.ok && csv.length > 0 && neutralized && !rawAtStart,
      { csvClick, newest, neutralized, rawAtStart, sample: (csv.split(/\r?\n/).find((l) => /1\+1|SUM/.test(l)) || "").slice(0, 200) }
    );
  } catch (err) {
    record("SMOKE.ERR", "smoke ui pass aborted", false, { error: String(err?.stack ?? err) });
  } finally {
    const out = {
      results,
      pageErrors: diag.pageErrors.slice(0, 8),
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 220)).slice(-8),
      summary: { pass: results.filter((r) => r.pass).length, total: results.length },
    };
    writeEvidence("04-smoke", out);
    writeLog("04-smoke", log);
    await browser.close();
    console.log(`smoke: ${results.filter((r) => r.pass).length}/${results.length}`);
    if (results.some((r) => !r.pass)) process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("04-smoke-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});