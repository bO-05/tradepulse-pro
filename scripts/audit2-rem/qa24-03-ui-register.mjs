/**
 * QA24-03 UI: Contracts Register filters after award/void cycles (REGISTER
 * fixture: 1 executed active + 2 superseded), superseded viewer/print/download,
 * void-confirm + inline-error surfaces at 375px and 200% (720 CSS px).
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, EVIDENCE_DIR } from "./qa24-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1200)}`);
};

const v = "(e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1)";

async function clickText(page, needle, exact = false) {
  return page.evaluate(
    ({ needle, exact, v }) => {
      const vis = new Function("e", `return ${v};`);
      const b = [...document.querySelectorAll("button")].find((x) => {
        const t = (x.innerText || "").replace(/\s+/g, " ").trim();
        return vis(x) && (exact ? t === needle : t.includes(needle));
      });
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 60) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim(), disabled: b.disabled };
    },
    { needle, exact, v }
  );
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
      card: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) },
      vw, vh,
      inViewport: r.left >= -1 && r.right <= vw + 1 && r.top >= -1 && r.bottom <= vh + 1,
      horizontalClip: top.scrollWidth > top.clientWidth + 1,
      unreachableActions: buttons.filter((b) => {
        const br = b.getBoundingClientRect();
        return br.right > vw + 1 || br.left < -1 || br.bottom > vh + 1 || br.top < -1;
      }).map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim().slice(0, 40)),
      buttons: buttons.map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim()).slice(0, 10),
      inlineError: top.querySelector('[role="alert"]')?.innerText || null,
      bodyText: (top.innerText || "").slice(0, 400),
    };
  });
}

async function clickDialogButton(page, label, exact = true) {
  return page.evaluate(
    ({ label, exact }) => {
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
    },
    { label, exact }
  );
}

async function tableState(page) {
  return page.evaluate(() => {
    const header = document.body.innerText;
    const sum = /active contracted sum\s*\$([\d,]+)/i.exec(header)?.[1] ?? null;
    const recorded = /execution status recorded\s*([\d]+)\s*\/\s*([\d]+)/i.exec(header);
    const rows = [...document.querySelectorAll("table tbody tr")].map((tr) => ({
      cells: [...tr.querySelectorAll("td")].map((td) => (td.innerText || "").replace(/\s+/g, " ").trim()),
      buttons: [...tr.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()),
    }));
    const chips = [...document.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()).filter((t) => /^(Active Contracts|Execution Status Recorded|Pending Execution|Superseded)/.test(t));
    return { sum, recorded: recorded ? `${recorded[1]}/${recorded[2]}` : null, rows, chips };
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

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const cdp = await page.createCDPSession();
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa24-register-downloads");
  fs.mkdirSync(dlDir, { recursive: true });
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
  await page.evaluateOnNewDocument(() => {
    window.__qa24Print = [];
    const orig = window.open;
    window.open = function (...args) {
      const w = orig.apply(window, args);
      try {
        if (w && w.document) {
          const origWrite = w.document.write.bind(w.document);
          w.document.write = (html) => { window.__qa24Print.push(String(html)); return origWrite(html); };
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
    const proj = F.register;
    // Idempotent restore: previous run may have voided the active execution.
    const preAgrs = (await c.query("agreements:listAgreements", { projectId: proj.id })) || [];
    if (!preAgrs.some((a) => a.status !== "superseded")) {
      await c.mutation("agreements:generateAgreement", { bidId: proj.bids.a.bidId, tradePackageId: proj.p26 });
      const refreshed = (await c.query("agreements:listAgreements", { projectId: proj.id })) || [];
      const gen = refreshed.find((a) => a.tradePackageId === proj.p26 && a.status === "generated");
      if (gen) await c.mutation("agreements:executeAgreement", { agreementId: gen._id });
      say("restored REGISTER baseline: re-awarded + re-executed bid A agreement");
    }
    await page.goto(`${BASE}/?project=${proj.id}&tab=contracts&qa24=register`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour();
    await delay(1800);

    // ---------- filters/counts baseline: 1 active executed + 2 superseded ----------
    const backendAgrs = (await c.query("agreements:listAgreements", { projectId: proj.id })) || [];
    const activeSum = backendAgrs.filter((a) => a.status !== "superseded").reduce((s, a) => s + a.contractSum, 0);
    const supersededBackend = backendAgrs.filter((a) => a.status === "superseded").length;
    const executedBackend = backendAgrs.filter((a) => a.status === "executed").length;
    const active = await tableState(page);
    record(
      "A24-03.1",
      "register baseline: default 'Active Contracts' shows only the executed agreement; sum and counts match backend",
      active.rows.length === 1 && active.rows[0].cells[5]?.includes("Execution Status Recorded") &&
        Number(String(active.sum).replace(/,/g, "")) === activeSum &&
        active.recorded === `${executedBackend}/${backendAgrs.filter((a) => a.status !== "superseded").length}` &&
        active.chips.some((x) => x.includes(`Superseded (${supersededBackend})`)),
      { activeSum, backendAgrs: backendAgrs.map((a) => ({ n: a.agreementNumber, s: a.status, sum: a.contractSum })), ui: active }
    );

    // ---------- superseded filter rows: badge + offered action ----------
    const supChip = active.chips.find((x) => x.includes("Superseded ("));
    await clickText(page, supChip, true);
    await delay(800);
    const sup = await tableState(page);
    await shot(page, "fix4-qa24-register-superseded-rows.png");
    const pendingBadges = sup.rows.filter((r) => r.cells[5]?.includes("Pending Execution")).length;
    const executeButtons = sup.rows.filter((r) => r.buttons.some((b) => b.includes("Record Execution Status"))).length;
    record(
      "A24-03.2",
      "FINDING CANDIDATE: superseded register rows show 'Pending Execution' status and offer 'Record Execution Status' (dead action)",
      sup.rows.length === supersededBackend && pendingBadges === supersededBackend && executeButtons === supersededBackend,
      { rows: sup.rows.length, pendingBadges, executeButtons, chip: supChip, rowSample: sup.rows[0] }
    );

    // ---------- dead action click -> inline error readability ----------
    await page.evaluate(() => {
      const tr = [...document.querySelectorAll("table tbody tr")].find((r) => (r.innerText || "").includes("Pending Execution"));
      const b = tr && [...tr.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Record Execution Status"));
      b?.click();
    });
    await delay(600);
    const execConfirm = await dialogInfo(page);
    await clickDialogButton(page, "Record execution");
    await delay(2500);
    const execError = await dialogInfo(page);
    await shot(page, "fix4-qa24-register-superseded-inline-error.png");
    record(
      "A24-03.3",
      "superseded execute refusal renders inline in the confirm dialog with a readable message (no generic Server Error)",
      execConfirm.open && execConfirm.role === "alertdialog" &&
        /Cannot execute a superseded agreement/i.test(execError.inlineError || "") &&
        !/Server Error/i.test(execError.inlineError || ""),
      { confirmTitle: execConfirm.title, error: execError.inlineError, buttons: execError.buttons }
    );
    await clickDialogButton(page, "Cancel");
    await delay(500);

    // ---------- superseded viewer + print/download ----------
    await page.evaluate(() => {
      const tr = [...document.querySelectorAll("table tbody tr")][0];
      const b = tr && [...tr.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Inspect Draft"));
      b?.click();
    });
    await delay(800);
    const viewer = await dialogInfo(page);
    const viewerState = await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1;
      const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).pop();
      return {
        badge: (d?.innerText.match(/Superseded[^\n]*/) || [null])[0],
        hasExecuteFooter: [...(d?.querySelectorAll("button") || [])].some((b) => /Record External Execution/.test(b.innerText || "")),
        pre: (d?.querySelector("pre")?.innerText || "").slice(0, 120),
      };
    });
    record(
      "A24-03.4",
      "superseded viewer: read-only badge shown, no execute action in the footer",
      viewer.open && /Superseded/i.test(viewerState.badge || "") && viewerState.hasExecuteFooter === false,
      { viewer: { title: viewer.title, buttons: viewer.buttons }, ...viewerState }
    );

    const printBefore = fs.existsSync(dlDir) ? fs.readdirSync(dlDir).length : 0;
    const printClick = await clickText(page, "Print");
    await delay(1800);
    const printDocs = await page.evaluate(() => window.__qa24Print || []);
    const printed = printDocs.join("\n");
    const dlClick = await clickText(page, "Download");
    await delay(2600);
    const files = fs.readdirSync(dlDir).filter((f) => f.endsWith(".txt"));
    const newest = files.map((f) => ({ f, t: fs.statSync(path.join(dlDir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
    const dlText = newest ? fs.readFileSync(path.join(dlDir, newest), "utf8") : "";
    record(
      "A24-03.5",
      "superseded draft print/download carries the full superseded contract text but no 'SUPERSEDED/VOID' watermark (status lives only in the register UI)",
      printClick.ok && dlClick.ok && printed.length > 2000 && dlText.length > 2000 &&
        !/SUPERSEDED|VOIDED/i.test(printed) && !/SUPERSEDED|VOIDED/i.test(dlText),
      { printClick, dlClick, printedLen: printed.length, dlLen: dlText.length, file: newest, printHasSuperseded: /SUPERSEDED|VOIDED/i.test(printed), downloadHasSuperseded: /SUPERSEDED|VOIDED/i.test(dlText), printedHead: printed.slice(0, 160) }
    );

    // ---------- 375px on superseded viewer ----------
    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
    await delay(900);
    const viewer375 = await dialogInfo(page);
    const page375 = await overflowProbe(page);
    await shot(page, "fix4-qa24-register-superseded-375.png", { full: false });
    record(
      "A24-03.6",
      "375px superseded viewer: card fits viewport, no horizontal clip, zero page-level overflow",
      viewer375.open && viewer375.inViewport && !viewer375.horizontalClip && page375.docOverflowX <= 0 && page375.offendersTotal === 0,
      { viewer375: { card: viewer375.card, inViewport: viewer375.inViewport, horizontalClip: viewer375.horizontalClip, unreachable: viewer375.unreachableActions }, page375 }
    );

    // ---------- 200% (720 CSS px) on superseded viewer ----------
    await page.setViewport({ width: 720, height: 450, deviceScaleFactor: 1 });
    await delay(900);
    const viewer200 = await dialogInfo(page);
    const page200 = await overflowProbe(page);
    await shot(page, "fix4-qa24-register-superseded-200pct.png", { full: false });
    record(
      "A24-03.7",
      "200%-equivalent (720px) superseded viewer: card fits, no horizontal clip, zero page overflow",
      viewer200.open && viewer200.inViewport && !viewer200.horizontalClip && page200.docOverflowX <= 0 && page200.offendersTotal === 0,
      { viewer200: { card: viewer200.card, inViewport: viewer200.inViewport, horizontalClip: viewer200.horizontalClip, unreachable: viewer200.unreachableActions }, page200 }
    );

    // ---------- void confirm flow + responsive on newest surface ----------
    await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 });
    await delay(700);
    await page.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().width > 1;
      const d = [...document.querySelectorAll('[role="dialog"]')].filter(vis).pop();
      const close = d && [...d.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").includes("Close contract viewer"));
      close?.click();
    });
    await delay(600);
    await clickText(page, "Active Contracts", true);
    await delay(700);
    await page.evaluate(() => {
      const tr = [...document.querySelectorAll("table tbody tr")][0];
      const b = tr && [...tr.querySelectorAll("button")].find((x) => (x.innerText || "").includes("Inspect Draft"));
      b?.click();
    });
    await delay(800);
    const voidOpen = await clickText(page, "Void execution record");
    await delay(700);
    const voidDialog = await dialogInfo(page);
    record(
      "A24-03.8",
      "void confirm dialog opens from the executed viewer with the full legal description",
      voidOpen.ok && voidDialog.open && voidDialog.role === "alertdialog" &&
        /Void the recorded execution\?/.test(voidDialog.title || "") &&
        /un-awards the bid, and reopens the package/i.test(voidDialog.bodyText || ""),
      { voidOpen, title: voidDialog.title, buttons: voidDialog.buttons, body: voidDialog.bodyText?.slice(0, 260) }
    );

    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
    await delay(800);
    const void375 = await dialogInfo(page);
    const voidPage375 = await overflowProbe(page);
    await shot(page, "fix4-qa24-register-void-confirm-375.png");
    record(
      "A24-03.9",
      "375px void confirm: in viewport, no horizontal clip, all actions reachable, zero page overflow",
      void375.open && void375.inViewport && !void375.horizontalClip && void375.unreachableActions.length === 0 && voidPage375.docOverflowX <= 0 && voidPage375.offendersTotal === 0,
      { void375: { card: void375.card, inViewport: void375.inViewport, horizontalClip: void375.horizontalClip, unreachable: void375.unreachableActions }, voidPage375 }
    );

    await page.setViewport({ width: 720, height: 450, deviceScaleFactor: 1 });
    await delay(800);
    const void200 = await dialogInfo(page);
    const voidPage200 = await overflowProbe(page);
    await shot(page, "fix4-qa24-register-void-confirm-200pct.png");
    record(
      "A24-03.10",
      "200%-equivalent (720px) void confirm: in viewport, no horizontal clip, all actions reachable, zero page overflow",
      void200.open && void200.inViewport && !void200.horizontalClip && void200.unreachableActions.length === 0 && voidPage200.docOverflowX <= 0 && voidPage200.offendersTotal === 0,
      { void200: { card: void200.card, inViewport: void200.inViewport, horizontalClip: void200.horizontalClip, unreachable: void200.unreachableActions }, voidPage200 }
    );

    // execute the void for real at 720px (newest surface end-to-end)
    await clickDialogButton(page, "Void execution record");
    await delay(2600);
    await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 });
    await delay(700);
    const afterVoid = await tableState(page);
    const agrsAfter = (await c.query("agreements:listAgreements", { projectId: proj.id })) || [];
    record(
      "A24-03.11",
      "void end-to-end: active register empties, superseded count +1, backend statuses match UI",
      afterVoid.rows.length === 0 &&
        afterVoid.chips.some((x) => x.includes(`Superseded (${supersededBackend + 1})`)) &&
        agrsAfter.filter((a) => a.status === "executed").length === executedBackend - 1 &&
        agrsAfter.filter((a) => a.status === "superseded").length === supersededBackend + 1 &&
        agrsAfter.every((a) => a.status !== "generated"),
      { afterVoid, backend: agrsAfter.map((a) => ({ n: a.agreementNumber, s: a.status })) }
    );

    record("A24-03.12", "ui register diagnostics", diag.pageErrors.length === 0, {
      pageErrors: diag.pageErrors.slice(0, 5).map((x) => x.slice(0, 200)),
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(-5).map((e) => e.text.slice(0, 160)),
    });
  } catch (err) {
    record("A24-03.ERR", "ui register aborted", false, { error: String(err?.stack ?? err).slice(0, 900) });
  } finally {
    writeEvidence("ui-register", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("ui-register", log);
    await browser.close();
    console.log(`ui register: ${results.filter((r) => r.pass).length}/${results.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-register-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});