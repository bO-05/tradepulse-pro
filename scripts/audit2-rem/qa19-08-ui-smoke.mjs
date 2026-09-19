/**
 * QA19-08: core re-smoke on LIVE — executed-contract immutability from the UI +
 * backend, inline confirm error, print popup full text, F1 live RFI persistence.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot, clickTab } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, sleep } from "./qa19-lib.mjs";

const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${JSON.stringify(detail)}`);
};

const clickByText = (page, text, exact = false) =>
  page.evaluate(
    (t, ex) => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        ex ? (x.textContent || "").trim() === t : (x.textContent || "").includes(t)
      );
      if (!b) {
        return {
          ok: false,
          avail: [...document.querySelectorAll("button")].map((x) => (x.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 50),
        };
      }
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) };
    },
    text,
    exact
  );

async function main() {
  const c = client();

  // ---------- F1 live: persist a pending RFI before any LLM work ----------
  const rfiSubject = "AUDIT-QA19 RFI live smoke";
  const rfiQuestion =
    "QA19 smoke: confirm the firestop sleeve responsibility at the slab penetration detail before bid submission.";
  const rfiSubmit = await c.mutation("simulation:submitCustomRfi", {
    tradePackageId: F.live.p2,
    contractorId: F.live.c3,
    subject: rfiSubject,
    question: rfiQuestion,
  });
  say(`rfi submit: ${JSON.stringify(rfiSubmit)}`);
  let rfiImmediate = null;
  for (let i = 0; i < 10; i++) {
    const convos = (await c.query("rfq:listConversations", { tradePackageId: F.live.p2 })) || [];
    const mine = convos.find((x) => x._id === rfiSubmit.conversationId);
    if (mine) {
      rfiImmediate = { status: mine.status, question: mine.inboundQuestion, subject: mine.inboundSubject };
      if (mine.status !== "pending_analysis") break;
    }
    await sleep(300);
  }
  say(`rfi immediate: ${JSON.stringify(rfiImmediate)}`);

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${F.live.id}&tab=contracts&qa19=smoke`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(1500);

  // ---------- Execute the generated agreement ----------
  const agreementsBeforeExec = (await c.query("agreements:listAgreements", { projectId: F.live.id })) || [];
  const targetAgreement =
    agreementsBeforeExec.find((a) => a.tradePackageId === F.live.p1 && a.status !== "superseded") || null;
  out.targetAgreementId = targetAgreement?._id ?? null;
  const executeClick = await clickByText(page, "Record Execution Status");
  say(`execute click: ${JSON.stringify(executeClick)}`);
  await delay(600);
  const execConfirm = await clickByText(page, "Record execution");
  say(`execution confirm: ${JSON.stringify(execConfirm)}`);
  await page.waitForFunction(() => document.body.innerText.includes("executed"), { timeout: 25000 }).catch(() => {});
  await delay(1500);
  const agreementsAfterExec = (await c.query("agreements:listAgreements", { projectId: F.live.id })) || [];
  const executedAgreement = agreementsAfterExec.find((a) => a._id === targetAgreement?._id || a.status === "executed") || null;
  out.executedAgreement = executedAgreement ? { _id: executedAgreement._id, status: executedAgreement.status, number: executedAgreement.agreementNumber, contractSum: executedAgreement.contractSum } : null;
  record("SMOKE.execute-agreement", executedAgreement?.status === "executed", out.executedAgreement);
  await shot(page, "fix4-qa19-smoke-executed.png");

  // ---------- Backend immutability: award the other bid refused ----------
  const otherBid = (await c.query("bids:listByPackage", { tradePackageId: F.live.p1 })) || [];
  const refusedBid = otherBid.find((b) => !b.isAwarded && b._id !== executedAgreement?.bidId) || otherBid.find((b) => !b.isAwarded) || null;
  let backendAward = null;
  try {
    backendAward = await c.mutation("bids:awardContract", { bidId: refusedBid._id, tradePackageId: F.live.p1 });
    backendAward = { accepted: true, value: backendAward };
  } catch (err) {
    backendAward = { accepted: false, data: String(err?.data ?? err?.message ?? err).slice(0, 220) };
  }
  let backendRegen = null;
  try {
    backendRegen = await c.mutation("agreements:generateAgreement", { bidId: refusedBid._id, tradePackageId: F.live.p1 });
    backendRegen = { accepted: true, value: backendRegen };
  } catch (err) {
    backendRegen = { accepted: false, data: String(err?.data ?? err?.message ?? err).slice(0, 220) };
  }
  record("SMOKE.award-other-bid-refused", backendAward.accepted === false && /executed subcontract|immutable/i.test(backendAward.data || ""), backendAward);
  record("SMOKE.regenerate-other-bid-refused", backendRegen.accepted === false, backendRegen);

  // ---------- UI: award other bid refused (button present, server says no) ----------
  await clickTab(page, "Bid Leveling");
  await delay(1800);
  const awardOtherClick = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("div")].filter((d) => {
      const txt = d.textContent || "";
      return txt.includes("AUDIT-QA19-LIVE Alpha Sub A") && txt.includes("Award Subcontract & Draft Agreement");
    });
    const card = cards[cards.length - 1];
    const b = card ? [...card.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Award Subcontract & Draft Agreement")) : null;
    if (!b) {
      const any = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Award Subcontract & Draft Agreement"));
      if (!any) return { ok: false };
      any.scrollIntoView({ block: "center" });
      any.click();
      return { ok: true, via: "any" };
    }
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, via: "card" };
  });
  await delay(3000);
  const afterAttempt = await page.evaluate(() => ({
    toasts: [...document.querySelectorAll('[role="status"]')].map((e) => (e.textContent || "").trim()),
  }));
  const bidsAfterAttempt = (await c.query("bids:listByPackage", { tradePackageId: F.live.p1 })) || [];
  const refusedAfter = bidsAfterAttempt.find((b) => b._id === refusedBid._id);
  const agreementsAfterAttempt = (await c.query("agreements:listAgreements", { projectId: F.live.id })) || [];
  const executedCountAfter = agreementsAfterAttempt.filter((a) => a.status === "executed").length;
  record(
    "SMOKE.ui-award-other-refused-no-state-change",
    awardOtherClick.ok && refusedAfter && refusedAfter.isAwarded === false && executedCountAfter === 1 && agreementsAfterAttempt.length === agreementsAfterExec.length,
    {
      awardOtherClick,
      refusedIsAwarded: refusedAfter?.isAwarded,
      executedCountAfter,
      agreementCountBefore: agreementsAfterExec.length,
      agreementCountAfter: agreementsAfterAttempt.length,
      toasts: afterAttempt.toasts,
    }
  );
  out.uiAwardAttempt = { awardOtherClick, ...afterAttempt };

  // ---------- Inline confirm error: Unaward the executed bid ----------
  const unawardClick = await clickByText(page, "Unaward", true);
  say(`unaward click: ${JSON.stringify(unawardClick)}`);
  await delay(600);
  const confirmClick = await clickByText(page, "Unaward proposal");
  say(`unaward confirm: ${JSON.stringify(confirmClick)}`);
  await delay(2200);
  const inline = await page.evaluate(() => {
    const dialog = document.querySelector('[role="alertdialog"]');
    const alert = dialog ? dialog.querySelector('[role="alert"]') : null;
    return {
      dialogOpen: Boolean(dialog),
      inlineError: alert ? (alert.textContent || "").trim().slice(0, 220) : null,
      dialogText: dialog ? (dialog.textContent || "").replace(/\s+/g, " ").trim().slice(0, 260) : null,
    };
  });
  say(`inline confirm state: ${JSON.stringify(inline)}`);
  record("SMOKE.inline-confirm-error-shown", inline.dialogOpen && /executed subcontract|immutable/i.test(inline.inlineError || ""), inline);
  await shot(page, "fix4-qa19-smoke-inline-confirm.png");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="alertdialog"] button')].find((x) => (x.textContent || "").trim() === "Cancel");
    b?.click();
  });
  await delay(500);

  // ---------- Print popup full text ----------
  await clickTab(page, "Contracts");
  await delay(1800);
  const inspect = await clickByText(page, "Inspect Draft");
  say(`inspect: ${JSON.stringify(inspect)}`);
  await delay(900);
  await page.evaluate(() => {
    window.__printCapture = [];
    window.open = function () {
      const doc = { chunks: [], write(s) { this.chunks.push(String(s)); }, close() {} };
      const win = { document: doc, focus() {}, print() {}, close() {} };
      window.__printCapture.push(win);
      return win;
    };
  });
  const printClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim().includes("Print"));
    if (!b) return { ok: false };
    b.click();
    return { ok: true, text: (b.textContent || "").trim().slice(0, 40) };
  });
  await delay(800);
  const captured = await page.evaluate(() => {
    const w = (window.__printCapture || [])[0];
    return w ? w.document.chunks.join("") : null;
  });
  const freshAgreement = ((await c.query("agreements:listAgreements", { projectId: F.live.id })) || []).find(
    (a) => a._id === executedAgreement?._id
  );
  const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const expectedHtml = freshAgreement ? escapeHtml(freshAgreement.contractText) : "";
  const capturedLen = captured ? captured.length : 0;
  record(
    "SMOKE.print-popup-full-text",
    printClick.ok && captured !== null && captured.includes(expectedHtml) && capturedLen > 2000,
    {
      printClick,
      capturedLen,
      expectedLen: expectedHtml.length,
      exactMatch: captured === expectedHtml,
      includesFullText: captured !== null && captured.includes(expectedHtml),
    }
  );
  out.print = { printClick, capturedLen, expectedLen: expectedHtml.length, exactMatch: captured === expectedHtml };

  // ---------- RFI final status ----------
  let rfiFinal = null;
  for (let i = 0; i < 60; i++) {
    const convos = (await c.query("rfq:listConversations", { tradePackageId: F.live.p2 })) || [];
    const mine = convos.find((x) => x._id === rfiSubmit.conversationId);
    if (mine) {
      rfiFinal = {
        status: mine.status,
        question: mine.inboundQuestion,
        replyLen: (mine.autonomousReply || "").length,
        error: mine.analysisError || null,
      };
      if (["clarified", "escalated_to_pm", "failed_analysis"].includes(mine.status)) break;
    }
    await sleep(1000);
  }
  say(`rfi final: ${JSON.stringify(rfiFinal)}`);
  record("SMOKE.rfi-text-retained", rfiFinal?.question === rfiQuestion, { rfiImmediate, rfiFinal });
  record(
    "SMOKE.rfi-pending-then-answered",
    Boolean(rfiImmediate) && (rfiImmediate.status === "pending_analysis" || rfiFinal?.status === "clarified") && ["clarified", "escalated_to_pm"].includes(rfiFinal?.status),
    { immediate: rfiImmediate?.status, final: rfiFinal?.status, error: rfiFinal?.error }
  );
  out.rfi = { submit: rfiSubmit, immediate: rfiImmediate, final: rfiFinal };

  out.results = results;
  out.pageErrors = diag.pageErrors.slice(0, 5);
  writeEvidence("smoke", out);
  writeLog("smoke", log);
  await browser.close();
  console.log(`results: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("smoke-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});