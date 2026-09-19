/**
 * QA22-03c UI follow-up: (a) print isolation from leveling viewer, (b) RFQ dispatch
 * failure reproduction, (c) slow-ingest false-failure reproduction on the journey
 * project. Read/write limited to AUDIT-QA22-* fixtures.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab } from "./lib.mjs";
import { client, writeEvidence, writeLog, sleep, EVIDENCE_DIR } from "./qa22-lib.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1000)}`);
};

async function clickText(page, needle, exact = false) {
  return page.evaluate(
    ({ needle, exact }) => {
      const v = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => {
        const t = (x.innerText || "").replace(/\s+/g, " ").trim();
        return v(x) && (exact ? t === needle : t.includes(needle));
      });
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 30) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim(), disabled: b.disabled };
    },
    { needle, exact }
  );
}

async function typeInto(page, selector, text) {
  const el = await page.$(selector);
  if (!el) return { ok: false, reason: "no element " + selector };
  await el.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text, { delay: 3 });
  return { ok: true };
}

async function poll(fn, predicate, timeoutMs = 60000, stepMs = 1500) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(stepMs);
  }
  return last;
}

async function main() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  const p = projects.find((x) => x.title === "AUDIT-QA22-JOURNEY");
  if (!p) throw new Error("journey project missing");
  const packages = await c.query("tradePackages:listByProject", { projectId: p._id });
  const pkg = packages.find((x) => x.csiDivision === "01 00 00");

  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.emulateTimezone("Asia/Tokyo");
  const cdp = await page.createCDPSession();
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa22-ui-downloads");
  fs.mkdirSync(dlDir, { recursive: true });
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
  await page.evaluateOnNewDocument(() => {
    window.__qa22Print = [];
    const orig = window.open;
    window.open = function (...args) {
      const w = orig.apply(window, args);
      try {
        if (w && w.document) {
          const ow = w.document.write.bind(w.document);
          w.document.write = (html) => { window.__qa22Print.push(String(html)); return ow(html); };
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
    // ---------- A. print from leveling viewer ----------
    await page.goto(`${BASE}/?project=${p._id}&tab=leveling&qa22=print`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour();
    await delay(1200);
    await page.evaluate((name) => {
      const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(name));
      b?.click();
    }, pkg.tradeName);
    await delay(1200);
    const inspect = await clickText(page, "Inspect Draft");
    await delay(1500);
    const printClick = await clickText(page, "Print / PDF");
    await delay(1500);
    const printed = await page.evaluate(() => (window.__qa22Print || []).map((h) => ({ len: h.length, head: h.slice(0, 200), tail: h.slice(-120) })));
    const joined = printed.map((x) => x.head + x.tail).join(" ");
    const chromeMarkers = ["New Project", "CSI Scoping", "Bid Leveling", "Subcontract Draft", "Judge Dock", "Demo Tour"];
    record(
      "A22-03c.1",
      "print popup isolation: contract-only document, app chrome absent",
      printed.length > 0 && /A401/.test(joined) && !chromeMarkers.some((m) => joined.includes(m)) && !/&lt;script/i.test(joined),
      { inspect: inspect.ok, printClick, printed, chromeMarkers }
    );
    await shot(page, "fix4-qa22-print-viewer.png");
    await page.keyboard.press("Escape");
    await delay(700);

    // ---------- B. dispatch reproduction ----------
    await clickTab(page, "Discovery");
    await delay(1600);
    await page.evaluate((name) => {
      const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(name));
      b?.click();
    }, pkg.tradeName);
    await delay(1000);
    const addProbe = await clickText(page, "Add Contractor Manually");
    await delay(800);
    await typeInto(page, 'input[placeholder*="Rosendin"]', "AUDIT-QA22 Journey Probe");
    await typeInto(page, 'input[placeholder*="estimating@rosendin"]', "estimating@qa22-probe.invalid");
    await typeInto(page, 'input[placeholder*="TECL"]', "HI-QA22-PB3");
    await clickText(page, "Add to Directory");
    await delay(2200);
    const ctrs = await c.query("contractors:listByPackage", { tradePackageId: pkg._id });
    const probe = ctrs.find((x) => x.companyName === "AUDIT-QA22 Journey Probe");
    const invite = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("div")].filter((d) => /AUDIT-QA22 Journey Probe/.test(d.innerText || ""));
      const card = cards.sort((a, b) => a.innerText.length - b.innerText.length)[0];
      const b = card ? [...card.querySelectorAll("button")].find((x) => /Invite to Bid|Dispatch RFQ|RFQ/i.test(x.innerText || "")) : null;
      if (!b) return { ok: false, available: card ? [...card.querySelectorAll("button")].map((x) => (x.innerText || "").trim()) : null };
      b.click();
      return { ok: true, text: (b.innerText || "").trim() };
    });
    await delay(3000);
    const toastAt3s = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((e) => (e.innerText || "").trim()).filter(Boolean));
    const probeAfter = await poll(
      () => c.query("contractors:listByPackage", { tradePackageId: pkg._id }).then((cs) => (cs || []).find((x) => x._id === probe?._id)),
      (x) => x?.rfqStatus === "invited" || Boolean(x?.dispatchedAt),
      60000,
      2000
    );
    const pageErrsNow = diag.pageErrors.slice(-4);
    await shot(page, "fix4-qa22-dispatch-probe.png");
    record(
      "A22-03c.2",
      "Invite to Bid dispatches or fails readably; no silent no-op",
      invite.ok && (probeAfter?.rfqStatus === "invited" || /error|failed|unable|try again|connection/i.test(toastAt3s.join(" ") + pageErrsNow.join(" "))),
      { invite, probeId: probe?._id, rfqStatus: probeAfter?.rfqStatus, dispatchedAt: probeAfter?.dispatchedAt ?? null, toastAt3s, pageErrsNow: pageErrsNow.map((x) => x.slice(0, 200)) }
    );

    // ---------- C. third ingest: measure duration + failure text ----------
    await clickTab(page, "Bid Leveling");
    await delay(1800);
    await page.evaluate((name) => {
      const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(name));
      b?.click();
    }, pkg.tradeName);
    await delay(900);
    const open = await clickText(page, "Ingest Quote / PDF");
    await delay(900);
    const optValue = await page.evaluate((name) => {
      const s = document.querySelector('select[aria-label="Subcontractor or bidder for this proposal"]');
      const o = s ? [...s.options].find((x) => x.textContent.includes(name)) : null;
      if (o) s.value = o.value, s.dispatchEvent(new Event("change", { bubbles: true }));
      return o ? o.value : null;
    }, "Journey Probe");
    await typeInto(page, 'input[aria-label="Document or proposal filename"]', "QA22_Probe_Electrical.pdf");
    await typeInto(
      page,
      'textarea[aria-label="Proposal OCR text or pasted quote"]',
      "PROPOSAL — AUDIT-QA22 Journey Probe. Base Bid Amount: $825,000. Includes division 26 lighting controls and gear. Exclusions: none. Lead time 10 weeks. COI compliant."
    );
    const t0 = Date.now();
    const submit = await clickText(page, "Extract & Level Bid");
    let sawError = null;
    let sawSuccessToast = null;
    for (let i = 0; i < 160; i++) {
      await delay(1000);
      const snap = await page.evaluate(() => {
        const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /Ingest/i.test(x.innerText || ""));
        const alert = d ? (d.querySelector('[role="alert"]')?.innerText || null) : null;
        const toasts = [...document.querySelectorAll('[role="status"]')].map((e) => (e.innerText || "").trim()).filter(Boolean);
        return { alert, toasts, dialogOpen: Boolean(d) };
      });
      if (snap.alert && !sawError) sawError = { atMs: Date.now() - t0, text: snap.alert };
      if (snap.toasts.some((t) => /ingested/i.test(t))) sawSuccessToast = { atMs: Date.now() - t0, text: snap.toasts };
      if ((sawError || sawSuccessToast) && !snap.dialogOpen) break;
      if (sawError && i > 90) break;
    }
    const bids = await c.query("bids:listByPackage", { tradePackageId: pkg._id });
    const probeBid = bids.find((b) => b.subcontractorName.includes("Probe"));
    record(
      "A22-03c.3",
      "third ingest: outcome message matches persisted state (no false failure after a stored bid)",
      !(Boolean(probeBid) && sawError && !sawSuccessToast),
      { optValue, submit, durationMs: Date.now() - t0, sawError, sawSuccessToast, bidPersisted: Boolean(probeBid), bid: probeBid ? { base: probeBid.baseBidAmount, leveled: probeBid.leveledTotalCost } : null }
    );
    await shot(page, "fix4-qa22-ingest-probe.png");
    await page.keyboard.press("Escape");

    record("A22-03c.4", "follow-up diagnostics", true, {
      pageErrors: diag.pageErrors.slice(-6).map((x) => x.slice(0, 220)),
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(-6).map((e) => e.text.slice(0, 220)),
    });
  } catch (err) {
    record("A22-03c.ERR", "follow-up aborted", false, { error: String(err?.stack ?? err) });
  } finally {
    writeEvidence("ui-followup", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("ui-followup", log);
    await browser.close();
    console.log(`ui followup: ${results.filter((r) => r.pass).length}/${results.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-followup-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});