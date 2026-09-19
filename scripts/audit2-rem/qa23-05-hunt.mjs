/**
 * QA23-05 HUNT (touched areas):
 *  - voided agreement states across Contracts register / Bid Leveling / Activity Audit
 *  - clash scan/deduct/assign on the partially-priced project (assign control + repeat assign)
 *  - superseded-row register dead action probe (new finding candidate)
 *  - truthfulness of the both-trades scan summary after a deduct
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot, clickTab } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, projectSnapshot, call } from "./qa23-lib.mjs";

const F = readEvidence("01-fixtures");
const P = F.partial;
const V = F.void;
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
  await delay(500);
}

async function main() {
  const c = client();

  // ---------- H1: assign on the now-both-priced partial project ----------
  const beforeAssign = await projectSnapshot(c, P.id);
  const elecBidBefore = beforeAssign.bids.find((b) => b._id === P.elecBidId);
  const assign1 = await call("assign#1 both priced", () => c.mutation("coordination:assignScopeVoidToTrade", {
    projectId: P.id,
    voidId: "void-bas-wiring-01",
    tradePackageId: P.elecPackageId,
    additionalCost: 28000,
    description: "QA23 low-voltage BAS control wiring",
  }));
  const afterAssign = await projectSnapshot(c, P.id);
  const elecBidAfter = afterAssign.bids.find((b) => b._id === P.elecBidId);
  const elecPkgAfter = afterAssign.packages.find((p) => p._id === P.elecPackageId);
  const detectAssigned = await c.query("coordination:detectCrossTradeClashes", { projectId: P.id });
  const basCard = (detectAssigned.scopeVoids || []).find((v) => v.id === "void-bas-wiring-01");
  record(
    "A23-H1.assign-control",
    "assignScopeVoidToTrade works once both sides are priced: void assigned, inclusion + line item + $28k applied",
    assign1.ok && assign1.value?.success === true &&
      basCard?.status === "assigned" &&
      (elecPkgAfter?.mandatoryInclusions || []).includes("QA23 low-voltage BAS control wiring") &&
      elecBidAfter?.leveledTotalCost === (elecBidBefore?.leveledTotalCost || 0) + 28000 &&
      (elecBidAfter?.lineItems || []).some((i) => /QA23 low-voltage BAS control wiring/.test(i.item || "")),
    {
      assign1: assign1.ok ? assign1.value : assign1,
      basStatus: basCard?.status,
      leveled: `${elecBidBefore?.leveledTotalCost} -> ${elecBidAfter?.leveledTotalCost}`,
      inclusions: elecPkgAfter?.mandatoryInclusions,
    }
  );

  // Repeat assign: does it double-charge or just duplicate audit noise?
  const lineItemsBefore = (elecBidAfter?.lineItems || []).length;
  const auditBefore = afterAssign.logs.filter((l) => /Scope Void Assigned/.test(l.title)).length;
  const assign2 = await call("assign#2 same void", () => c.mutation("coordination:assignScopeVoidToTrade", {
    projectId: P.id,
    voidId: "void-bas-wiring-01",
    tradePackageId: P.elecPackageId,
    additionalCost: 28000,
    description: "QA23 low-voltage BAS control wiring",
  }));
  const afterAssign2 = await projectSnapshot(c, P.id);
  const elecBidAfter2 = afterAssign2.bids.find((b) => b._id === P.elecBidId);
  const auditAfter = afterAssign2.logs.filter((l) => /Scope Void Assigned/.test(l.title)).length;
  const doubleCharged = elecBidAfter2?.leveledTotalCost !== elecBidAfter?.leveledTotalCost ||
    (elecBidAfter2?.lineItems || []).length !== lineItemsBefore;
  record(
    "A23-H2.repeat-assign",
    "repeat assign does not double-charge (same leveled total / single line item); residual audit duplication observed",
    !doubleCharged,
    {
      assign2: assign2.ok,
      leveledBefore: elecBidAfter?.leveledTotalCost,
      leveledAfter: elecBidAfter2?.leveledTotalCost,
      lineItemsBefore,
      lineItemsAfter: (elecBidAfter2?.lineItems || []).length,
      scopeVoidAuditLogs: `${auditBefore} -> ${auditAfter}`,
      severity: doubleCharged ? "Medium" : "Low/informational",
    }
  );

  // ---------- H3: both-trades scan summary derives from computed state ----------
  const scan = await call("scan both trades (partial)", () => c.action("coordination:scanCrossTradeClashes", { projectId: P.id }));
  const detected = await c.query("coordination:detectCrossTradeClashes", { projectId: P.id });
  const buys = (detected?.doubleBuys || []).filter((d) => d.status === "detected");
  const voids = (detected?.scopeVoids || []).filter((v) => v.status === "open");
  const buyAmount = buys.reduce((s, d) => s + (d.redundantAmount || 0), 0);
  const voidAmount = voids.reduce((s, v) => s + (v.estimatedVoidCost || 0), 0);
  const expectedMsg = `Cross-trade scan complete: ${buys.length} double-buy item(s) worth $${buyAmount.toLocaleString("en-US")} and ${voids.length} open scope void(s) worth $${voidAmount.toLocaleString("en-US")}.`;
  record(
    "A23-H3.scan-truth",
    "scan summary on the partial project matches persisted clash state exactly (no static/fabricated totals)",
    scan.ok && scan.value?.analyzed === true && scan.value?.message === expectedMsg,
    { ok: scan.ok, message: scan.value?.message, expectedMsg, buys: buys.length, voids: voids.length, err: scan.ok ? null : scan.data ?? scan.message }
  );

  // ---------- H4: Div26-only project scan guard (SMOKE has no Div23 package) ----------
  const scanGuard = await call("scan Div26-only", () => c.action("coordination:scanCrossTradeClashes", { projectId: F.smoke.id }));
  record(
    "A23-H4.scan-guard",
    "Div26-only project scan still refuses truthfully",
    scanGuard.ok && scanGuard.value?.success === false && scanGuard.value?.analyzed === false &&
      /needs both a Division 26/.test(scanGuard.value?.message || ""),
    { value: scanGuard.value ?? scanGuard.data }
  );

  // ---------- UI ----------
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  try {
    // ===== A23-H5: superseded row in the Contracts register =====
    await page.goto(`${BASE}/?project=${V.id}&tab=contracts&qa23=hunt`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour(page);
    await delay(2200);
    const filterClick = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /^Superseded \(\d+\)/.test((x.textContent || "").trim()));
      if (!b) return { ok: false };
      b.click();
      return { ok: true, label: (b.textContent || "").trim() };
    });
    await delay(1200);
    const rowState = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("tbody tr")];
      const row = rows.find((r) => /SUP/i.test(r.innerText || "") || /VOID|QA23/.test(r.innerText || "")) || rows[0];
      if (!row) return { found: false };
      return {
        found: true,
        text: (row.innerText || "").replace(/\s+/g, " ").trim().slice(0, 260),
        badgePending: /Pending Execution/i.test(row.innerText || ""),
        badgeSuperseded: /Superseded/i.test(row.innerText || ""),
        hasInspect: [...row.querySelectorAll("button")].some((b) => (b.innerText || "").trim() === "Inspect Draft"),
        hasRecordExecution: [...row.querySelectorAll("button")].some((b) => (b.innerText || "").includes("Record Execution Status")),
      };
    });
    await shot(page, "fix4-qa23-hunt-superseded-row.png");

    let recordRefusal = null;
    if (rowState.hasRecordExecution) {
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll("tbody tr")];
        const row = rows.find((r) => [...r.querySelectorAll("button")].some((b) => (b.innerText || "").includes("Record Execution Status")));
        const b = row ? [...row.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Record Execution Status")) : null;
        b?.click();
      });
      await delay(700);
      const dlg = await page.evaluate(() => {
        const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        const d = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
        return d ? { open: true, title: (d.querySelector("h2") || {}).innerText || "" } : { open: false };
      });
      await page.evaluate(() => {
        const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        const d = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
        const b = d ? [...d.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Record execution") : null;
        b?.click();
      });
      let inlineError = null;
      for (let i = 0; i < 30 && !inlineError; i++) {
        await delay(250);
        inlineError = await page.evaluate(() => {
          const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
          const d = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
          const a = d ? d.querySelector('[role="alert"]') : null;
          return a ? (a.textContent || "").trim().slice(0, 220) : null;
        });
      }
      recordRefusal = { dlg, inlineError };
      await shot(page, "fix4-qa23-hunt-superseded-dead-action.png");
      await page.evaluate(() => {
        const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        const d = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis).pop();
        const b = d ? [...d.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Cancel") : null;
        b?.click();
      });
      await delay(400);
    }
    const vSnap = await projectSnapshot(c, V.id);
    const stillSuperseded = vSnap.agreements.find((a) => a._id === V.agreementId)?.status === "superseded";
    record(
      "A23-H5.superseded-row",
      "superseded register row: badge says Pending Execution and Record Execution Status is offered (dead action); refusal readable, state unchanged",
      rowState.found && rowState.hasInspect && rowState.hasRecordExecution && Boolean(recordRefusal) &&
        recordRefusal.dlg?.open === true && /superseded/i.test(recordRefusal.inlineError || "") && stillSuperseded,
      { rowState, recordRefusal, stillSuperseded, classification: "Low (viewer already read-only; row-level copy/action stale)" }
    );

    // ===== A23-H6: voided state across leveling + audit views =====
    await clickTab(page, "Bid Leveling");
    await delay(1600);
    const levelingText = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
    record(
      "A23-H6.leveling-after-void",
      "leveling view does not claim an awarded/executed state after the void",
      !/Contract Awarded\s*•\s*Draft Generated/i.test(levelingText) && !/Execution recorded in TradePulse/i.test(levelingText),
      { snippet: (levelingText.match(/.{0,100}(Awarded|Execution recorded).{0,100}/i) || [null])[0] }
    );

    await clickTab(page, "Activity Audit");
    await delay(1800);
    const auditText = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
    const voidMentions = (auditText.match(/Executed Subcontract Voided/g) || []).length;
    const voidLogCount = vSnap.logs.filter((l) => l.title.startsWith("Executed Subcontract Voided")).length;
    record(
      "A23-H7.audit-void-once",
      "activity audit shows every voided-execution record and matches the backend audit count",
      voidLogCount >= 1 && voidMentions === voidLogCount,
      { backendVoidLogs: voidLogCount, uiMentions: voidMentions }
    );

    record("A23-H8.diagnostics", "hunt UI pass has no page errors", diag.pageErrors.length === 0, {
      pageErrors: diag.pageErrors.slice(0, 5),
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(-5).map((e) => e.text.slice(0, 200)),
    });
  } catch (err) {
    record("A23-H.ERR", "hunt ui pass aborted", false, { error: String(err?.stack ?? err) });
  } finally {
    writeEvidence("05-hunt", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("05-hunt", log);
    await browser.close();
    console.log(`hunt: ${results.filter((r) => r.pass).length}/${results.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("05-hunt-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});