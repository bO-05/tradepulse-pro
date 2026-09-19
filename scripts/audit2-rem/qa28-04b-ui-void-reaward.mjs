/**
 * QA28-04b: complete the QA28 journey UI steps that the parent script mis-clicked:
 *  - re-capture coordination KPI/chips (case-insensitive; parent regex was case-sensitive)
 *  - void the executed agreement through the TOP alertdialog confirm button
 *  - re-award via the Bid Leveling UI
 *  - capture the audit stream and register after each step
 * Project: AUDIT-QA28-JOURNEY (fixture created by qa28-04).
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa28-lib.mjs";

const c = client();
const F = readEvidence("ui-journey");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};

const mainText = (page) => page.evaluate(() => (document.querySelector("main") || document.body).innerText);

async function clickText(page, needle, exact = false) {
  return page.evaluate(({ needle, exact }) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const b = [...document.querySelectorAll("button")].find((x) => {
      const t = (x.innerText || "").replace(/\s+/g, " ").trim();
      return vis(x) && (exact ? t === needle : t.includes(needle));
    });
    if (!b) return { ok: false };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim() };
  }, { needle, exact });
}

async function clickTopDialogButton(page, label) {
  return page.evaluate((label) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const ds = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(vis);
    const top = ds[ds.length - 1];
    if (!top) return { ok: false, reason: "no dialog" };
    const b = [...top.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === label);
    if (!b) return { ok: false, buttons: [...top.querySelectorAll("button")].map((x) => (x.innerText || "").trim()) };
    b.click();
    return { ok: true, title: (top.querySelector("h2,h3") || {}).innerText || null };
  }, label);
}

async function selectPackage(page, name) {
  return page.evaluate((n) => {
    const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(n));
    if (!b) return { ok: false };
    b.click();
    return { ok: true, text: (b.innerText || "").trim(), pressed: b.getAttribute("aria-pressed") };
  }, name);
}

async function poll(fn, pred, timeoutMs, stepMs) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return last;
}

async function kpis(page) {
  return page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText.replace(/\n/g, " ");
    const grab = (label) => new RegExp(label + "\\s*\\$?([\\d,]+)").exec(t)?.[1] ?? null;
    return {
      doubleBuys: grab("Redundant Double-Buys"),
      voids: grab("Unassigned Scope Voids"),
      credits: grab("Recoverable Buyout Credits"),
      deductedChips: (t.match(/CREDIT DEDUCTED & LEVELED/gi) || []).length,
      assignedChips: (t.match(/SCOPE ASSIGNED & COVERED/gi) || []).length,
    };
  });
}

async function register(page) {
  return page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText.replace(/\s+/g, " ");
    return {
      sum: /ACTIVE CONTRACTED SUM\s*\$([\d,]+)/i.exec(t)?.[1] ?? null,
      exec: /EXECUTION STATUS RECORDED\s*(\d+)\s*\/\s*(\d+)/i.exec(t) ? `${RegExp.$1}/${RegExp.$2}` : null,
      chips: [...document.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()).filter((x) => /^(Active Contracts|Execution Status Recorded|Pending Execution|Superseded)/.test(x)),
      rows: [...document.querySelectorAll("table tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.innerText || "").replace(/\s+/g, " ").trim())),
    };
  });
}

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const url = `${BASE}/?project=${F.projectId}&tab=coordination&qa28=journey-b`;

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(1800);

    // 1) re-capture coordination state with case-insensitive chips
    let ui = await kpis(page);
    record("A28-04b.1", "coordination UI state re-captured: VFD card 'Credit Deducted & Leveled' + KPI $38,500; BAS card 'Scope Assigned & Covered' + KPI $18,500",
      ui.credits === "38,500" && ui.doubleBuys === "12,000" && ui.voids === "18,500" && ui.deductedChips === 1 && ui.assignedChips === 1,
      { ui });

    // 2) void through the register dialog (scoped to the top alertdialog)
    await clickTab(page, "Subcontracts");
    await delay(1600);
    const openViewer = await clickText(page, "Inspect Draft");
    await delay(1200);
    const openVoid = await clickText(page, "Void execution record");
    await delay(900);
    const confirm = await clickTopDialogButton(page, "Void execution record");
    const agrs1 = await poll(
      () => c.query("agreements:listAgreements", { projectId: F.projectId }),
      (x) => (x || []).some((a) => a.agreementNumber === F.agreement && a.status === "superseded"),
      45000,
      1500
    );
    await delay(1800);
    const voidRow = ((await c.query("auditLogs:listRecentLogs", { projectId: F.projectId, limit: 300 })) || []).find((l) => /Executed Subcontract Voided/.test(l.title));
    const bid26 = (await c.query("bids:listByPackage", { tradePackageId: F.p26 })).find((b) => b._id === F.bid26);
    const reg1 = await register(page);
    record("A28-04b.2", "UI void through the confirm dialog: agreement superseded, bid unawarded, Superseded chip appears; audit says the recorded execution was voided with the reason",
      openViewer.ok && openVoid.ok && confirm.ok && (agrs1 || []).find((a) => a.agreementNumber === F.agreement)?.status === "superseded" &&
        bid26?.isAwarded === false && Boolean(voidRow) && /was voided:/.test(voidRow.description) &&
        /Voided in TradePulse to correct a recorded execution/.test(voidRow.description) &&
        reg1.chips.some((c) => /Superseded/.test(c)),
      { confirm, status: (agrs1 || []).find((a) => a.agreementNumber === F.agreement)?.status, bidAwarded: bid26?.isAwarded, voidRow: voidRow ? { title: voidRow.title, description: voidRow.description } : null, regChips: reg1.chips, regSum: reg1.sum, regExec: reg1.exec });

    // 3) re-award through Bid Leveling UI
    await clickTab(page, "Bid Leveling");
    await delay(1600);
    await selectPackage(page, "QA28 Journey Electrical");
    await delay(1000);
    const reAward1 = await clickText(page, "Award Compliant Winner");
    const reAward = reAward1.ok ? reAward1 : await clickText(page, "Award Subcontract & Draft Agreement");
    const agrs2 = await poll(
      () => c.query("agreements:listAgreements", { projectId: F.projectId }),
      (x) => (x || []).some((a) => a.agreementNumber === F.agreement && a.status === "generated"),
      60000,
      2000
    );
    await delay(1500);
    const reRow = ((await c.query("auditLogs:listRecentLogs", { projectId: F.projectId, limit: 300 })) || []).find((l) => /Re-Awarded/.test(l.title));
    const bid26re = (await c.query("bids:listByPackage", { tradePackageId: F.p26 })).find((b) => b._id === F.bid26);
    record("A28-04b.3", "UI re-award after void: same agreement reactivated to generated, bid re-awarded, 'Re-Awarded ... Re-activated' audit row with no execution claim",
      reAward.ok && (agrs2 || []).find((a) => a.agreementNumber === F.agreement)?.status === "generated" && bid26re?.isAwarded === true &&
        Boolean(reRow) && /Re-activated subcontract agreement/.test(reRow.description) && !/executed/i.test(reRow.description),
      { reAward, status: (agrs2 || []).find((a) => a.agreementNumber === F.agreement)?.status, bidAwarded: bid26re?.isAwarded, reRow: reRow ? { title: reRow.title, description: reRow.description } : null });

    // 4) audit stream sweep in the UI
    await clickTab(page, "Live Activity Audit");
    await delay(2000);
    const auditUI = await mainText(page);
    const logsAll = ((await c.query("auditLogs:listRecentLogs", { projectId: F.projectId, limit: 400 })) || []);
    record("A28-04b.4", "audit UI after void+re-award: pending-execution generation claim, execution record, void reason, and re-award all rendered; no 'Logged' phantom rows; no executed claim on the reactivated agreement",
      /pending external execution/.test(auditUI) && /Execution status recorded for/.test(auditUI) &&
        /was voided:/.test(auditUI) && /Re-activated subcontract agreement/.test(auditUI) &&
        logsAll.filter((l) => /Double-Buy Credit Logged/.test(l.title)).length === 0,
      {
        hasPendingExecution: /pending external execution/.test(auditUI),
        hasExecution: /Execution status recorded for/.test(auditUI),
        hasVoid: /was voided:/.test(auditUI),
        hasReAward: /Re-activated subcontract agreement/.test(auditUI),
        logged: logsAll.filter((l) => /Double-Buy Credit Logged/.test(l.title)).length,
      });

    await shot(page, "fix4-qa28-journey-b-final.png");
    record("A28-04b.5", "completion diagnostics: zero page errors", diag.pageErrors.length === 0, { pageErrors: diag.pageErrors.slice(0, 5) });

    writeEvidence("ui-journey-b", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("ui-journey-b", log);
    console.log(`ui-journey-b: ${results.filter((r) => r.pass).length}/${results.length}`);
  } catch (err) {
    writeEvidence("ui-journey-b", { results: [...results, { id: "A28-04b.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }], summary: { pass: results.filter((r) => r.pass).length, total: results.length + 1 } });
    writeLog("ui-journey-b", [...log, String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-journey-b-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});