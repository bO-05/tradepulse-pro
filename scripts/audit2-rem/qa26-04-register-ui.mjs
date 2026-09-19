/**
 * QA26-04 Contracts Register convergence:
 *  A) status labels after FIX-NEW-58: superseded reads "Superseded — read-only",
 *     no dead execute action; generated still Pending; executed no action
 *  B) search + status filters reconcile with backend counts
 *  C) 375px and 200% with all four chips present (FIX-NEW-59 wrap)
 *  D) superseded viewer/print/download truth
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, EVIDENCE_DIR } from "./qa26-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};

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

async function tableState(page) {
  return page.evaluate(() => {
    const t = document.body.innerText;
    const sum = /active contracted sum\s*\$([\d,]+)/i.exec(t)?.[1] ?? null;
    const recorded = /execution status recorded\s*([\d]+)\s*\/\s*([\d]+)/i.exec(t);
    const rows = [...document.querySelectorAll("table tbody tr")].map((tr) => {
      const cells = [...tr.querySelectorAll("td")].map((td) => (td.innerText || "").replace(/\s+/g, " ").trim());
      return {
        cells,
        status: cells[5] || null,
        buttons: [...tr.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()),
      };
    });
    const chips = [...document.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()).filter((x) => /^(Active Contracts|Execution Status Recorded|Pending Execution|Superseded)/.test(x));
    const empty = /No agreements match your search criteria./.test(t);
    const filterRow = [...document.querySelectorAll("button")]
      .filter((b) => /^(Active Contracts|Execution Status Recorded|Pending Execution|Superseded)/.test((b.innerText || "").trim()))
      .map((b) => { const r = b.getBoundingClientRect(); return { text: (b.innerText || "").trim(), top: Math.round(r.top), right: Math.round(r.right), left: Math.round(r.left) }; });
    return { sum, recorded: recorded ? `${recorded[1]}/${recorded[2]}` : null, rows, chips, empty, filterRow };
  });
}

async function overflowProbe(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const insideScroller = (el) => {
      let n = el.parentElement;
      while (n && n !== document.body) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
        n = n.parentElement;
      }
      return false;
    };
    const offenders = [...document.querySelectorAll("body *")]
      .map((el) => ({ el, r: el.getBoundingClientRect(), cs: getComputedStyle(el) }))
      .filter(({ r, cs }) => r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden")
      .filter(({ r }) => r.right > vw + 0.5)
      .filter(({ el }) => !insideScroller(el))
      .map(({ el, r }) => ({ tag: el.tagName, text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 50), right: Math.round(r.right) }));
    return { vw, docOverflowX: document.documentElement.scrollWidth - vw, offenders: offenders.slice(0, 6), offendersTotal: offenders.length };
  });
}

async function dialogInfo(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const ds = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(vis);
    const top = ds[ds.length - 1] || null;
    if (!top) return { open: false };
    const r = top.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const buttons = [...top.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().width > 0);
    return {
      open: true,
      role: top.getAttribute("role"),
      title: (top.querySelector("h2,h3") || {}).innerText || null,
      inViewport: r.left >= -1 && r.right <= vw + 1 && r.top >= -1 && r.bottom <= vh + 1,
      horizontalClip: top.scrollWidth > top.clientWidth + 1,
      unreachableActions: buttons.filter((b) => { const br = b.getBoundingClientRect(); return br.right > vw + 1 || br.left < -1 || br.bottom > vh + 1 || br.top < -1; }).map((b) => (b.innerText || "").trim().slice(0, 40)),
      buttons: buttons.map((b) => (b.innerText || "").trim()).slice(0, 12),
      inlineError: top.querySelector('[role="alert"]')?.innerText || null,
      bodyText: (top.innerText || "").slice(0, 300),
    };
  });
}

async function ensureRegisterStates() {
  const agrs = (await c.query("agreements:listAgreements", { projectId: F.award.id })) || [];
  const agrA = agrs.find((a) => a.bidId === F.award.bids.a.bidId);
  const agrB = agrs.find((a) => a.bidId === F.award.bids.b.bidId);
  const agrD = agrs.find((a) => a.bidId === F.award.bids.d.bidId);
  // target: A superseded, B executed, D generated
  if (agrB?.status === "executed" && agrA?.status === "superseded" && agrD?.status === "generated") return { note: "already in target state" };
  if (agrA?.status === "executed") {
    await c.mutation("agreements:voidExecutedAgreement", { agreementId: agrA._id, reason: "QA26 register setup: void executed A so B can take the executed slot." });
  }
  const fresh = (await c.query("agreements:listAgreements", { projectId: F.award.id })) || [];
  let b = fresh.find((a) => a.bidId === F.award.bids.b.bidId);
  if (!b || b.status !== "executed") {
    if (!b || b.status === "superseded") b = await c.mutation("agreements:generateAgreement", { bidId: F.award.bids.b.bidId, tradePackageId: F.award.p26 });
    await c.mutation("agreements:executeAgreement", { agreementId: b._id });
  }
  let d = (await c.query("agreements:listAgreements", { projectId: F.award.id })).find((a) => a.bidId === F.award.bids.d.bidId);
  if (!d || d.status !== "generated") {
    if (!d || d.status === "superseded") d = await c.mutation("agreements:generateAgreement", { bidId: F.award.bids.d.bidId, tradePackageId: F.award.p23 });
  }
  return { note: "rebuilt", a: agrA?.status ?? null, b: b.status, d: d.status };
}

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const cdp = await page.createCDPSession();
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa26-register-downloads");
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
    const setup = await ensureRegisterStates();
    await delay(600);
    await page.goto(`${BASE}/?project=${F.award.id}&tab=contracts&qa26=register`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour();
    await delay(2000);

    const backendAgrs = (await c.query("agreements:listAgreements", { projectId: F.award.id })) || [];
    const executedN = backendAgrs.filter((a) => a.status === "executed").length;
    const supersededN = backendAgrs.filter((a) => a.status === "superseded").length;
    const generatedN = backendAgrs.filter((a) => a.status === "generated").length;
    const activeSum = backendAgrs.filter((a) => a.status !== "superseded").reduce((s, a) => s + a.contractSum, 0);
    const activeN = executedN + generatedN;

    // ---------- A. labels ----------
    const base = await tableState(page);
    await shot(page, "fix4-qa26-register-labels.png");
    const execRow = base.rows.find((r) => r.cells[0]?.includes(".executed-row")) || base.rows.find((r) => /Execution Status Recorded/.test(r.status || ""));
    const genRow = base.rows.find((r) => /Pending Execution/.test(r.status || ""));
    const execHasDeadAction = base.rows.some((r) => r.status?.includes("Execution Status Recorded") && r.buttons.some((b) => /Record Execution Status/.test(b)));
    record(
      "A26-04.1",
      "register default (Active Contracts): executed + generated rows, no dead execute action on executed; sum/counts match backend",
      base.rows.length === activeN && base.rows.length === backendAgrs.filter((a) => a.status !== "superseded").length &&
        execRow && !/Record Execution Status/.test(execRow.buttons.join("|")) &&
        genRow && genRow.buttons.some((b) => /Record Execution Status/.test(b)) &&
        execHasDeadAction === false &&
        base.sum === activeSum.toLocaleString("en-US") && base.recorded === `${executedN}/${activeN}` &&
        base.chips.some((x) => x.includes(`Superseded (${supersededN})`)),
      { setup, backend: { executedN, generatedN, supersededN, activeSum }, ui: base, execRow, genRow }
    );

    const supChip = base.chips.find((x) => x.includes("Superseded ("));
    await clickText(page, supChip, true);
    await delay(900);
    const sup = await tableState(page);
    await shot(page, "fix4-qa26-register-superseded-rows.png");
    const supPending = sup.rows.filter((r) => /Pending Execution/.test(r.status || "")).length;
    const supDead = sup.rows.filter((r) => r.buttons.some((b) => /Record Execution Status/.test(b))).length;
    const supReadOnly = sup.rows.filter((r) => /Superseded — read-only/.test(r.status || "")).length;
    record(
      "A26-04.2",
      "superseded filter: every row labelled 'Superseded — read-only', zero Pending badges, zero execute actions (FIX-NEW-58)",
      sup.rows.length === supersededN && supReadOnly === supersededN && supPending === 0 && supDead === 0 &&
        sup.rows.every((r) => r.buttons.some((b) => /Inspect Draft/.test(b))),
      { rowCount: sup.rows.length, supReadOnly, supPending, supDead, rows: sup.rows }
    );

    // superseded viewer: read-only badge, no execute footer
    await page.evaluate(() => {
      const tr = [...document.querySelectorAll("table tbody tr")][0];
      const b = tr && [...tr.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Inspect Draft"));
      b?.click();
    });
    await delay(900);
    const viewer = await dialogInfo(page);
    const viewerState = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1;
      const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).pop();
      return {
        badge: (d?.innerText.match(/Superseded[^\n]*/) || [null])[0],
        hasExecuteFooter: [...(d?.querySelectorAll("button") || [])].some((b) => /Record External Execution|Record Execution/.test(b.innerText || "")),
        hasVoid: [...(d?.querySelectorAll("button") || [])].some((b) => /Void execution record/.test(b.innerText || "")),
        buttons: [...(d?.querySelectorAll("button") || [])].map((b) => (b.innerText || "").trim()).slice(0, 10),
      };
    });
    record(
      "A26-04.3",
      "superseded viewer: read-only badge, no execute or void action",
      viewer.open && /Superseded/i.test(viewerState.badge || "") && viewerState.hasExecuteFooter === false && viewerState.hasVoid === false,
      { viewer: { title: viewer.title, buttons: viewer.buttons }, ...viewerState }
    );

    // ---------- B. search/filter reconciliation ----------
    await page.keyboard.press("Escape");
    await delay(400);
    await page.keyboard.press("Escape");
    await delay(600);
    const setSearch = async (v) => {
      await page.evaluate((val) => {
        const el = document.querySelector('input[placeholder*="Search by agreement"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, v);
      await delay(900);
      return tableState(page);
    };
    await clickText(page, "Active Contracts", true);
    await delay(700);
    const searchD = await setSearch("Award Mechanical D");
    const searchNone = await setSearch("zzz-no-such-agreement");
    const searchExecName = await setSearch("Award Electric B");
    await clickText(page, `Superseded (${supersededN})`, true);
    await delay(700);
    const supSearchA = await setSearch("Award Electric A");
    await setSearch("");
    record(
      "A26-04.4",
      "search + status filters reconcile: active search shows only matching active row; superseded search shows the superseded row; no-match empty state; chip counts stay global",
      searchD.rows.length === 1 && /Award Mechanical D/.test(searchD.rows[0].cells[1] || "") &&
        searchNone.empty === true && searchNone.rows.length === 0 &&
        searchExecName.rows.length === 1 && /Award Electric B/.test(searchExecName.rows[0].cells[1] || "") &&
        supSearchA.rows.length === 1 && /Superseded — read-only/.test(supSearchA.rows[0].status || "") &&
        supSearchA.chips.some((x) => x.includes(`Superseded (${supersededN})`)) && searchD.chips.some((x) => x.includes(`Superseded (${supersededN})`)),
      { searchD: searchD.rows, searchNone: { empty: searchNone.empty, rows: searchNone.rows.length }, searchExecName: searchExecName.rows, supSearchA: supSearchA.rows, chips: supSearchA.chips }
    );

    // ---------- C. 375px and 200% with all chips ----------
    await clickText(page, "Active Contracts", true);
    await delay(800);
    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
    await delay(1000);
    const state375 = await tableState(page);
    const page375 = await overflowProbe(page);
    await shot(page, "fix4-qa26-register-375-chips.png", { full: false });
    const rowTops = [...new Set(state375.filterRow.map((c) => c.top))];
    record(
      "A26-04.5",
      "375px register with all four chips: zero page-level overflow, chips wrap inside the viewport (FIX-NEW-59)",
      state375.chips.length === 4 && page375.docOverflowX <= 0 && page375.offendersTotal === 0 &&
        state375.filterRow.every((c) => c.left >= 0 && c.right <= 375 + 1) && rowTops.length >= 2,
      { chips: state375.chips, filterRow: state375.filterRow, rowTops, page375 }
    );

    // newest dialog at 375: executed viewer + void confirm
    await page.evaluate(() => {
      const tr = [...document.querySelectorAll("table tbody tr")].find((r) => /Execution Status Recorded/.test(r.innerText || ""));
      const b = tr && [...tr.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Inspect Draft"));
      b?.click();
    });
    await delay(900);
    const v375 = await dialogInfo(page);
    const vPage375 = await overflowProbe(page);
    const voidOpen = await clickText(page, "Void execution record");
    await delay(800);
    const void375 = await dialogInfo(page);
    const voidPage375 = await overflowProbe(page);
    await shot(page, "fix4-qa26-register-void-confirm-375.png", { full: false });
    record(
      "A26-04.6",
      "375px executed viewer + void confirm: in viewport, no clip, all actions reachable, zero page overflow",
      v375.open && v375.inViewport && !v375.horizontalClip && vPage375.docOverflowX <= 0 && vPage375.offendersTotal === 0 &&
        voidOpen.ok && void375.open && void375.inViewport && !void375.horizontalClip && void375.unreachableActions.length === 0 && voidPage375.docOverflowX <= 0 && voidPage375.offendersTotal === 0,
      { viewer: { inViewport: v375.inViewport, clip: v375.horizontalClip, unreachable: v375.unreachableActions }, void: { inViewport: void375.inViewport, clip: void375.horizontalClip, unreachable: void375.unreachableActions }, vPage375, voidPage375 }
    );
    await clickText(page, "Cancel");
    await delay(500);
    await page.keyboard.press("Escape");
    await delay(400);

    await page.setViewport({ width: 720, height: 450, deviceScaleFactor: 1 });
    await delay(1000);
    const state200 = await tableState(page);
    const page200 = await overflowProbe(page);
    await shot(page, "fix4-qa26-register-200pct-chips.png", { full: false });
    record(
      "A26-04.7",
      "200%-equivalent (720px) register with all chips: zero page overflow, chips within viewport",
      page200.docOverflowX <= 0 && page200.offendersTotal === 0 && state200.filterRow.every((c) => c.left >= 0 && c.right <= 720 + 1),
      { filterRow: state200.filterRow, page200 }
    );

    // ---------- D. superseded print/download truth ----------
    await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 });
    await delay(700);
    await clickText(page, `Superseded (${supersededN})`, true);
    await delay(800);
    await page.evaluate(() => {
      const tr = [...document.querySelectorAll("table tbody tr")][0];
      const b = tr && [...tr.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Inspect Draft"));
      b?.click();
    });
    await delay(800);
    const printClick = await clickText(page, "Print");
    await delay(1500);
    const printDocs = await page.evaluate(() => window.__qa26Print || []);
    const printed = printDocs.join("\n");
    const dlClick = await clickText(page, "Download");
    await delay(2500);
    const files = fs.readdirSync(dlDir).filter((f) => f.endsWith(".txt"));
    const newest = files.map((f) => ({ f, t: fs.statSync(path.join(dlDir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
    const dlText = newest ? fs.readFileSync(path.join(dlDir, newest), "utf8") : "";
    record(
      "A26-04.8",
      "superseded print/download emits the stored draft text with no SUPERSEDED/VOID status label (prior L3, reconfirmed low)",
      printClick.ok && dlClick.ok && printed.length > 2000 && dlText.length > 2000 &&
        !/SUPERSEDED|VOIDED|SUPERSEDED — read-only/i.test(printed) && !/SUPERSEDED|VOIDED/i.test(dlText),
      { printClick, dlClick, printedLen: printed.length, dlLen: dlText.length, file: newest, hasSupersededInPrint: /SUPERSEDED|VOIDED/i.test(printed) }
    );

    record("A26-04.9", "register ui diagnostics: zero page errors", diag.pageErrors.length === 0, {
      pageErrors: diag.pageErrors.slice(0, 4),
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(-4).map((e) => e.text.slice(0, 160)),
    });

    writeEvidence("register-ui", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("register-ui", log);
    console.log(`register-ui: ${results.filter((r) => r.pass).length}/${results.length}`);
  } catch (err) {
    writeEvidence("register-ui", { results: [...results, { id: "A26-04.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }], summary: { pass: results.filter((r) => r.pass).length, total: results.length + 1 } });
    writeLog("register-ui", log);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("register-ui-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});