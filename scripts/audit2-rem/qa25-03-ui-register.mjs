/**
 * QA25-03 UI register verification (live):
 *  A23-01/A24-02: superseded register rows show "Superseded — read-only" with NO
 *  "Record Execution Status" action; generated rows still show Pending + action;
 *  executed rows show recorded.
 *  A24-03: 375px Contracts register with a Superseded chip present has ZERO
 *  page-level horizontal overflow.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, EVIDENCE_DIR } from "./qa25-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1300)}`);
};

async function tableState(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll("table tbody tr")].map((tr) => ({
      cells: [...tr.querySelectorAll("td")].map((td) => (td.innerText || "").replace(/\s+/g, " ").trim()),
      buttons: [...tr.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()),
    }));
    const chips = [...document.querySelectorAll("button")]
      .map((b) => (b.innerText || "").replace(/\s+/g, " ").trim())
      .filter((t) => /^(Active Contracts|Execution Status Recorded|Pending Execution|Superseded)/.test(t));
    const statusSpan = [...document.querySelectorAll("span")].find((s) => (s.textContent || "").trim() === "Status:");
    const statusRow = statusSpan ? statusSpan.parentElement : null;
    return {
      rows,
      chips,
      statusRow: statusRow
        ? {
            clientWidth: statusRow.clientWidth,
            scrollWidth: statusRow.scrollWidth,
            flexWrap: getComputedStyle(statusRow).flexWrap,
            chipLabels: [...statusRow.querySelectorAll("button")].map((b) => (b.innerText || "").trim()),
          }
        : null,
    };
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
      .map(({ el, r }) => ({ tag: el.tagName, text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60), right: Math.round(r.right) }));
    return {
      vw,
      docOverflowX: document.documentElement.scrollWidth - vw,
      offendersTotal: offenders.length,
      offenders: offenders.slice(0, 8),
    };
  });
}

async function clickText(page, needle, exact = false) {
  return page.evaluate(
    ({ needle, exact }) => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => {
        const t = (x.innerText || "").replace(/\s+/g, " ").trim();
        return vis(x) && (exact ? t === needle : t.includes(needle));
      });
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 60) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim() };
    },
    { needle, exact }
  );
}

async function dismissTour(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(400);
}

async function gotoRegister(page, viewport, tag) {
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/?project=${F.register.id}&tab=contracts&qa25=${tag}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await dismissTour(page);
  await delay(1800);
}

async function main() {
  const backendAgrs = (await c.query("agreements:listAgreements", { projectId: F.register.id })) || [];
  const statusById = new Map(backendAgrs.map((a) => [a._id, a.status]));

  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa25-register-downloads");
  fs.mkdirSync(dlDir, { recursive: true });

  try {
    // ---------- 1500px: status filter rows ----------
    await gotoRegister(page, { width: 1500, height: 950 }, "register-rows");
    const active = await tableState(page);
    const executedRow = active.rows.find((r) => r.cells.some((c) => /Execution Status Recorded/.test(c)));
    const generatedRow = active.rows.find((r) => r.cells.some((c) => /Pending Execution/.test(c)));
    record(
      "A24-02.1",
      "Active Contracts: executed row shows recorded and no execute action; generated row shows Pending + Record Execution Status",
      backendAgrs.filter((a) => a.status === "executed").length === 1 &&
        backendAgrs.filter((a) => a.status === "generated").length === 1 &&
        backendAgrs.filter((a) => a.status === "superseded").length === 1 &&
        active.rows.length === 2 &&
        Boolean(executedRow) && !executedRow.buttons.some((b) => b.includes("Record Execution Status")) &&
        Boolean(generatedRow) && generatedRow.buttons.some((b) => b.includes("Record Execution Status")) &&
        active.chips.some((x) => /^Superseded \(1\)/.test(x)),
      {
        backend: backendAgrs.map((a) => ({ n: a.agreementNumber, s: a.status })),
        rows: active.rows, chips: active.chips,
      }
    );

    const supChip = active.chips.find((x) => /^Superseded \(/.test(x));
    const chipClick = await clickText(page, supChip, true);
    await delay(900);
    const sup = await tableState(page);
    await shot(page, "fix4-qa25-register-superseded-rows.png");
    const supRow = sup.rows[0];
    const supBadge = Boolean(supRow) && supRow.cells.some((c) => /Superseded — read-only/.test(c));
    const supPending = Boolean(supRow) && supRow.cells.some((c) => /Pending Execution|Execution Status Recorded/.test(c));
    const supExecute = Boolean(supRow) && supRow.buttons.some((b) => /Record Execution Status/.test(b));
    record(
      "A23-01/A24-02.2",
      "FIXED: superseded row shows 'Superseded — read-only', NO Pending badge and NO 'Record Execution Status' action",
      chipClick.ok && sup.rows.length === 1 && supBadge && !supPending && !supExecute &&
        supRow.buttons.some((b) => b.includes("Inspect Draft")),
      { chip: supChip, supBadge, supPending, supExecute, buttons: supRow?.buttons, row: supRow?.cells }
    );

    // executed filter
    const execChip = sup.chips.find((x) => /^Execution Status Recorded$/.test(x));
    await clickText(page, execChip, true);
    await delay(800);
    const execFilter = await tableState(page);
    record(
      "A24-02.3",
      "Execution Status Recorded filter shows exactly the executed row with the recorded badge and no execute action",
      execFilter.rows.length === 1 &&
        execFilter.rows[0].cells.some((c) => /Execution Status Recorded/.test(c)) &&
        !execFilter.rows[0].buttons.some((b) => /Record Execution Status/.test(b)),
      { rows: execFilter.rows }
    );

    // generated filter
    await clickText(page, "Pending Execution", true);
    await delay(800);
    const genFilter = await tableState(page);
    record(
      "A24-02.4",
      "Pending Execution filter shows exactly the generated row with Pending badge and the execute action",
      genFilter.rows.length === 1 &&
        genFilter.rows[0].cells.some((c) => /Pending Execution/.test(c)) &&
        genFilter.rows[0].buttons.some((b) => /Record Execution Status/.test(b)),
      { rows: genFilter.rows }
    );

    // ---------- 375px with Superseded chip present ----------
    await gotoRegister(page, { width: 375, height: 812 }, "register-375");
    const page375 = await overflowProbe(page);
    const state375 = await tableState(page);
    await shot(page, "fix4-qa25-register-375.png");
    const statusRight = state375.statusRow ? state375.statusRow.scrollWidth - state375.statusRow.clientWidth : null;
    record(
      "A24-03.5",
      "FIXED: 375px register with Superseded chip present: zero page-level horizontal overflow and wrapping status row",
      state375.chips.some((x) => /^Superseded \(1\)/.test(x)) &&
        page375.docOverflowX <= 0 &&
        page375.offendersTotal === 0 &&
        state375.statusRow != null && state375.statusRow.flexWrap === "wrap" &&
        statusRight !== null && statusRight <= 0,
      { vw: page375.vw, docOverflowX: page375.docOverflowX, offendersTotal: page375.offendersTotal, statusRow: state375.statusRow, chips: state375.chips }
    );

    // ---------- 720px (200% equivalent) sanity ----------
    await gotoRegister(page, { width: 720, height: 450 }, "register-720");
    const page720 = await overflowProbe(page);
    await shot(page, "fix4-qa25-register-720.png");
    record(
      "A24-03.6",
      "720px (200% equivalent) register with Superseded chip: zero page-level horizontal overflow",
      page720.docOverflowX <= 0 && page720.offendersTotal === 0,
      { vw: page720.vw, docOverflowX: page720.docOverflowX, offendersTotal: page720.offendersTotal, offenders: page720.offenders }
    );

    // ---------- superseded viewer stays read-only ----------
    await gotoRegister(page, { width: 1500, height: 950 }, "register-viewer");
    const supChip2 = (await tableState(page)).chips.find((x) => /^Superseded \(/.test(x));
    await clickText(page, supChip2, true);
    await delay(800);
    await page.evaluate(() => {
      const tr = [...document.querySelectorAll("table tbody tr")][0];
      const b = tr && [...tr.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Inspect Draft"));
      b?.click();
    });
    await delay(900);
    const viewer = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1;
      const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).pop();
      return {
        open: Boolean(d),
        badge: (d?.innerText.match(/Superseded[^\n]*/) || [null])[0],
        hasExecute: [...(d?.querySelectorAll("button") || [])].some((b) => /Record External Execution/.test(b.innerText || "")),
      };
    });
    record(
      "A23-01.7",
      "superseded viewer is read-only (badge shown, no external-execution action)",
      viewer.open && /Superseded/i.test(viewer.badge || "") && viewer.hasExecute === false,
      viewer
    );

    record("A24-03.diag", "ui register diagnostics: no page errors", diag.pageErrors.length === 0, {
      pageErrors: diag.pageErrors.slice(0, 5).map((x) => x.slice(0, 200)),
    });
  } catch (err) {
    record("QA25-03.ERR", "ui register aborted", false, { error: String(err?.stack ?? err).slice(0, 900) });
  } finally {
    writeEvidence("ui-register", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("ui-register", log);
    await browser.close();
    console.log(`ui register: ${results.filter((r) => r.pass).length}/${results.length}`);
    if (results.some((r) => !r.pass)) process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-register-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});