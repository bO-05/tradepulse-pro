/**
 * QA26-06 full UI journey on a fresh project to a printed contract, then
 * UI idempotency: double Print, double-confirm void. Project title AUDIT-QA26-JOURNEY.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab } from "./lib.mjs";
import { client, fixtureTitle, writeEvidence, writeLog, EVIDENCE_DIR, sleep } from "./qa26-lib.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const TITLE = fixtureTitle("JOURNEY");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1400)}`);
};

async function typeInto(page, selector, value) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(selector, value, { delay: 12 });
}

async function clickText(page, needle, exact = false) {
  return page.evaluate(
    ({ needle, exact }) => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => {
        const t = (x.innerText || "").replace(/\s+/g, " ").trim();
        return vis(x) && (exact ? t === needle : t.includes(needle));
      });
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 50) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim(), disabled: b.disabled };
    },
    { needle, exact }
  );
}

async function poll(fn, pred, timeoutMs, stepMs) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await sleep(stepMs);
  }
  return last;
}

async function dialogInfo(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const ds = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(vis);
    const top = ds[ds.length - 1] || null;
    if (!top) return { open: false };
    return {
      open: true,
      role: top.getAttribute("role"),
      title: (top.querySelector("h2,h3") || {}).innerText || null,
      body: (top.innerText || "").slice(0, 240),
      buttons: [...top.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).slice(0, 12),
    };
  });
}

async function projectByTitle(title) {
  const projects = (await c.query("projects:listProjects", {})) || [];
  return projects.find((p) => p.title === title) || null;
}

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const cdp = await page.createCDPSession();
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa26-journey-downloads");
  fs.mkdirSync(dlDir, { recursive: true });
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
  await page.evaluateOnNewDocument(() => {
    window.__qa26Print = [];
    const orig = window.open;
    window.open = function (...args) {
      const w = orig.apply(window, args);
      try {
        if (w && w.document) {
          const origWrite = w.document.write.bind(w.document);
          w.document.write = (html) => { window.__qa26Print.push(String(html)); return origWrite(html); };
        }
      } catch {}
      return w;
    };
  });
  const dismissTour = () =>
    page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });

  try {
    // purge any prior journey fixture
    for (const p of ((await c.query("projects:listProjects", {})) || []).filter((x) => x.title === TITLE)) {
      const agrs0 = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
      for (const a of agrs0.filter((x) => x.status === "executed")) {
        try { await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA26 journey purge of prior run executed record." }); } catch {}
      }
      try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
    }
    await delay(600);

    // ---------- 1. create project through the dialog ----------
    await page.goto(`${BASE}/?qa26=journey`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => { localStorage.removeItem("tradepulse.selectedProjectId"); localStorage.removeItem("tradepulse.selectedPackageId"); });
    await dismissTour();
    await delay(900);
    await clickText(page, "New Project");
    await delay(800);
    const npFill = async (sel, val) =>
      page.evaluate(({ sel, val }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return el.value === val;
      }, { sel, val });
    const npFills = {
      title: await npFill('input[aria-label="Project title"]', TITLE),
      location: await npFill('input[aria-label="Project location"]', "Honolulu, HI"),
      type: await npFill('input[aria-label="Project type"]', "Healthcare / Mixed-Use"),
      gc: await npFill('input[aria-label="General contractor or contracting entity"]', "QA26 Journey GC, LLC"),
      budget: await npFill('input[aria-label="Estimated budget in dollars"]', "900000"),
      weeks: await npFill('input[aria-label="Target completion duration in weeks"]', "52"),
      spec: await npFill('textarea[placeholder*="Outline high-level trade scopes"]', "Division 26 electrical distribution, switchgear, and lighting controls for the QA26 journey."),
    };
    const npClick = await page.evaluate(() => {
      const ds = [...document.querySelectorAll('[role="dialog"]')].filter((x) => x.getBoundingClientRect().width > 1);
      const d = ds[ds.length - 1];
      const b = d && [...d.querySelectorAll("button")].find((x) => /Create Commercial Project/.test(x.innerText || ""));
      if (!b) return { ok: false, dialog: Boolean(d), buttons: d ? [...d.querySelectorAll("button")].map((x) => (x.innerText || "").trim()) : null };
      b.click();
      return { ok: true, disabled: b.disabled };
    });
    let proj = await poll(() => projectByTitle(TITLE), (p) => Boolean(p), 90000, 2500);
    if (!proj) {
      const titles = ((await c.query("projects:listProjects", {})) || []).map((p) => p.title);
      say(`poll timeout; projects now: ${JSON.stringify(titles)}`);
      proj = (await c.query("projects:listProjects", {})).find((p) => p.title === TITLE) || null;
    }
    await delay(2000);
    const npState = await page.evaluate(() => {
      const ds = [...document.querySelectorAll('[role="dialog"]')].filter((x) => x.getBoundingClientRect().width > 1);
      const d = ds[ds.length - 1];
      return d ? { open: true, alert: d.querySelector('[role="alert"]')?.innerText || null, text: (d.innerText || "").slice(0, 200) } : { open: false };
    });
    say(`npFills=${JSON.stringify(npFills)} npClick=${JSON.stringify(npClick)} npState=${JSON.stringify(npState)}`);
    await shot(page, "fix4-qa26-journey-created.png");
    if (!proj) throw new Error(`journey project was not created :: fills=${JSON.stringify(npFills)} click=${JSON.stringify(npClick)} state=${JSON.stringify(npState)}`);
    record("A26-06.1", "fresh project created through the UI dialog", Boolean(proj) && Object.values(npFills).every(Boolean) && npClick.ok, { id: proj?._id, title: proj?.title, npFills, npClick });

    // ---------- 2. manual package + contractor through the UI ----------
    await clickTab(page, "CSI Scoping");
    await delay(1500);
    const createPkg = await clickText(page, "Create Trade Package");
    await delay(800);
    const d = new Date(Date.now() + 14 * 86400000);
    const localD = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const setVal = (sel, val) =>
      page.evaluate(({ sel, val }) => {
        const el = document.querySelector(sel);
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, { sel, val });
    await setVal('input[aria-label="CSI division number"]', "26 00 00");
    await setVal('input[aria-label="Trade package name"]', "QA26 Journey Electrical");
    await setVal('input[aria-label="Budget estimate in dollars"]', "500000");
    await setVal('textarea[aria-label="Scope summary"]', "QA26 journey electrical scope per division 26.");
    await setVal('input[aria-label="Bid deadline"]', localD);
    await clickText(page, "Create Package");
    const pkgs = await poll(() => c.query("tradePackages:listByProject", { projectId: proj._id }), (x) => (x || []).length > 0, 30000, 1200);
    const pkg = (pkgs || []).find((p) => p.csiDivision.startsWith("26")) || (pkgs || [])[0];
    await delay(1200);
    if (!pkg) throw new Error("journey package not created");
    await page.evaluate((name) => {
      const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(name));
      b?.click();
    }, pkg.tradeName);
    await delay(600);

    await clickTab(page, "Discovery");
    await delay(1500);
    await clickText(page, "Add Contractor Manually");
    await delay(800);
    await typeInto(page, 'input[placeholder*="Rosendin"]', "AUDIT-QA26 Journey Prime");
    await typeInto(page, 'input[placeholder*="estimating@rosendin"]', "estimating@qa26-journey.invalid");
    await typeInto(page, 'input[placeholder*="TECL"]', "HI-QA26-JP1");
    await clickText(page, "Add to Directory");
    await delay(2200);
    const ctrs = await c.query("contractors:listByPackage", { tradePackageId: pkg._id });
    const ctr = (ctrs || []).find((x) => /QA26 Journey/.test(x.companyName));
    record(
      "A26-06.2",
      "package and contractor created through the real UI dialogs and persisted",
      createPkg.ok && Boolean(pkg) && Boolean(ctr),
      { createPkg, pkg: { csi: pkg.csiDivision, name: pkg.tradeName, budget: pkg.budgetEstimate }, ctr: ctr ? { name: ctr.companyName, status: ctr.rfqStatus } : null }
    );

    // bid via backend (UI ingest is LLM-backed and out of scope for this journey)
    const bid = await c.mutation("bids:submitDirectBid", {
      tradePackageId: pkg._id, contractorId: ctr._id,
      subcontractorName: "AUDIT-QA26 Journey Prime", baseBidAmount: 480000,
      identifiedExclusions: [{ description: "QA26 journey firestop excluded", costImpact: 15000, severity: "minor" }],
      coiComplianceStatus: "compliant", coiPenalty: 0,
    });
    await delay(1500);

    // ---------- 3. award + execute + print through the UI ----------
    await clickTab(page, "Bid Leveling");
    await delay(1600);
    await page.evaluate((name) => {
      const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(name));
      b?.click();
    }, pkg.tradeName);
    await delay(1200);
    const awardTry = await clickText(page, "Award Compliant Winner");
    const award = awardTry.ok ? awardTry : await clickText(page, "Award Subcontract & Draft Agreement");
    const agrs = await poll(() => c.query("agreements:listAgreements", { projectId: proj._id }), (x) => (x || []).some((a) => a.status === "generated"), 60000, 2000);
    const agr = (agrs || []).find((a) => a.status === "generated");
    await delay(1500);
    await page.keyboard.press("Escape");
    await delay(600);
    await clickTab(page, "Subcontracts");
    await delay(1800);
    await clickText(page, "Inspect Draft");
    await delay(1200);
    const execOpen = await clickText(page, "Record External Execution");
    if (!execOpen.ok) await clickText(page, "Record Execution Status");
    await delay(900);
    const execDlg = await dialogInfo(page);
    await clickText(page, "Record execution", true);
    const executed = await poll(() => c.query("agreements:listAgreements", { projectId: proj._id }), (x) => (x || []).some((a) => a.status === "executed"), 45000, 2000);
    await delay(1800);
    record(
      "A26-06.3",
      "award + execution recorded through the UI on the fresh project",
      Boolean(award.ok) && Boolean(agr) && execOpen.ok && execDlg.open && (executed || []).some((a) => a.status === "executed"),
      { award: award.text ?? award, agreement: agr?.agreementNumber, execOpen, execDlg: { role: execDlg.role, buttons: execDlg.buttons }, statuses: (executed || []).map((a) => a.status) }
    );

    // print (single)
    const print1 = await clickText(page, "Print", true);
    await delay(2000);
    const docs1 = await page.evaluate(() => (window.__qa26Print || []).slice());
    const printed1 = docs1.join("\n");
    const isolated = docs1.length === 1 && /A401/.test(printed1) && new RegExp(TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(printed1) &&
      /AUDIT-QA26 Journey Prime/.test(printed1) && /480,000|495,000/.test(printed1) && !/<script/i.test(printed1) &&
      !/New Project|CSI Scoping|Bid Leveling|Subcontract Draft<\/h2>/i.test(printed1.replace(/A401[^<]*/g, ""));
    record("A26-06.4", "printed contract is the isolated A401 draft for this project/bidder (no app chrome)", print1.ok && isolated, {
      print1, docCount: docs1.length, len: printed1.length, hasProject: printed1.includes(TITLE), hasSub: printed1.includes("Prime"),
      head: printed1.slice(0, 200),
    });
    await shot(page, "fix4-qa26-journey-executed.png");

    // double print
    const auditBefore = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 300 })) || []).length;
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Print");
      b?.click();
      b?.click();
    });
    await delay(2200);
    const docs2 = await page.evaluate(() => (window.__qa26Print || []).slice());
    const auditAfter = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 300 })) || []).length;
    record(
      "A26-06.5",
      "double Print on the newest viewer: two identical isolated documents, zero audit/state writes",
      print1.ok && docs2.length === 3 && docs2[1] === docs2[2] && auditAfter === auditBefore,
      { docCount: docs2.length, identical: docs2[1] === docs2[2], auditBefore, auditAfter }
    );

    // ---------- 4. void via UI, double-confirm idempotency ----------
    const voidOpen = await clickText(page, "Void execution record");
    await delay(900);
    const voidDlg = await dialogInfo(page);
    const dbl = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1;
      const ds = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis);
      const top = ds[ds.length - 1];
      const b = top && [...top.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Void execution record");
      if (!b) return { ok: false };
      b.click();
      b.click();
      return { ok: true };
    });
    await poll(() => c.query("agreements:listAgreements", { projectId: proj._id }), (x) => (x || []).some((a) => a.status === "superseded"), 45000, 1500);
    await delay(2500);
    const afterVoid = await c.query("agreements:listAgreements", { projectId: proj._id });
    const voidRows = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 300 })) || []).filter((l) => /Executed Subcontract Voided/.test(l.title));
    const bidAfter = (await c.query("bids:listByPackage", { tradePackageId: pkg._id })).find((b) => b._id === bid.bidId);
    const pkgAfter = (await c.query("tradePackages:listByProject", { projectId: proj._id })).find((p) => p._id === pkg._id);
    record(
      "A26-06.6",
      "double-confirm void: exactly one superseded transition and one void audit row; bid unawarded, package reopened",
      voidOpen.ok && voidDlg.open && dbl.ok && afterVoid.filter((a) => a.status === "superseded").length === 1 &&
        voidRows.length === 1 && bidAfter?.isAwarded === false && pkgAfter?.status === "leveling",
      { voidDlg: { title: voidDlg.title, buttons: voidDlg.buttons }, dbl, statuses: afterVoid.map((a) => a.status), voidRows: voidRows.map((r) => r.title), bidAwarded: bidAfter?.isAwarded, pkg: pkgAfter?.status }
    );
    await shot(page, "fix4-qa26-journey-voided.png");

    record("A26-06.7", "journey ui diagnostics: zero page errors", diag.pageErrors.length === 0, {
      pageErrors: diag.pageErrors.slice(0, 5),
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(-4).map((e) => e.text.slice(0, 160)),
    });

    writeEvidence("journey", { result: { projectId: proj._id, pkgId: pkg._id }, results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("journey", log);
    console.log(`journey: ${results.filter((r) => r.pass).length}/${results.length}`);
  } catch (err) {
    writeEvidence("journey", { results: [...results, { id: "A26-06.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }], summary: { pass: results.filter((r) => r.pass).length, total: results.length + 1 } });
    writeLog("journey", [...log, String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("journey-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});