/**
 * QA24-04 UI: draft-reset matrix across all creation modals + project/package
 * switches, and 375px / 200% on the inline-error surface.
 * Modals: New Project, Create Trade Package, AI Spec Breakdown, Add Contractor,
 * Ingest Quote. Also checks the package selector never keeps a stale package
 * when switching projects.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, setViewport, clickTab } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa24-lib.mjs";

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

const visFn = "((e)=>(e.getBoundingClientRect().width>1&&e.getBoundingClientRect().height>1))";

async function clickText(page, needle, exact = false) {
  return page.evaluate(
    ({ needle, exact }) => {
      const v = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => {
        const t = (x.innerText || "").replace(/\s+/g, " ").trim();
        return v(x) && (exact ? t === needle : t.includes(needle));
      });
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 60) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim(), disabled: b.disabled };
    },
    { needle, exact }
  );
}

async function setInput(page, selector, value) {
  return page.evaluate(
    ({ selector, value }) => {
      const el = document.querySelector(selector);
      if (!el) return { ok: false, selector };
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: el.value };
    },
    { selector, value }
  );
}

async function escapeAndReopen(page, openerLabel) {
  await page.keyboard.press("Escape");
  await delay(500);
  await clickText(page, openerLabel);
  await delay(800);
}

function findField(state, needle) {
  if (!state?.fields) return undefined;
  const key = Object.keys(state.fields).find((k) => k.includes(needle));
  return key ? state.fields[key] : undefined;
}

async function dialogState(page) {
  return page.evaluate(() => {
    const v = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const ds = [...document.querySelectorAll('[role="dialog"]')].filter(v);
    const top = ds[ds.length - 1] || null;
    if (!top) return { open: false };
    const fields = {};
    for (const el of top.querySelectorAll("input,textarea,select")) {
      const key = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.tagName.toLowerCase();
      fields[key] = el.type === "checkbox" ? el.checked : el.value;
    }
    const r = top.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    return {
      open: true,
      title: (top.querySelector("h2,h3") || {}).innerText || null,
      fields,
      inViewport: r.left >= -1 && r.right <= vw + 1 && r.top >= -1 && r.bottom <= vh + 1,
      horizontalClip: top.scrollWidth > top.clientWidth + 1,
      alert: top.querySelector('[role="alert"]')?.innerText || null,
    };
  });
}

async function closeTop(page) {
  await page.evaluate(() => {
    const v = (e) => e.getBoundingClientRect().width > 1;
    const ds = [...document.querySelectorAll('[role="dialog"]')].filter(v);
    const top = ds[ds.length - 1];
    if (!top) return;
    const b = [...top.querySelectorAll("button")].find((x) => /cancel|close/i.test((x.getAttribute("aria-label") || "") + " " + (x.innerText || "")));
    b?.click();
  });
  await delay(450);
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
  const dismissTour = () =>
    page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });

  try {
    await page.goto(`${BASE}/?project=${F.intent.id}&tab=packages&qa24=modals`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await dismissTour();
    await delay(1500);

    // ---------- 1. New Project modal: sentinel -> escape -> reopen ----------
    await clickText(page, "New Project");
    await delay(700);
    const npFields = {
      title: 'QA24-DRAFT-SENTINEL', location: 'SENTINEL-LOC', type: 'SENTINEL-TYPE',
      gc: 'SENTINEL-GC', budget: '999999', weeks: '77',
    };
    await setInput(page, 'input[aria-label="Project title"]', npFields.title);
    await setInput(page, 'input[aria-label="Project location"]', npFields.location);
    await setInput(page, 'input[aria-label="Project type"]', npFields.type);
    await setInput(page, 'input[aria-label="General contractor or contracting entity"]', npFields.gc);
    await setInput(page, 'input[aria-label="Estimated budget in dollars"]', npFields.budget);
    await setInput(page, 'input[aria-label="Target completion duration in weeks"]', npFields.weeks);
    await setInput(page, 'textarea[placeholder*="Outline high-level trade scopes"]', 'SENTINEL-SPEC');
    await escapeAndReopen(page, "New Project");
    const npReopen = await dialogState(page);
    const npCleared = npReopen.open &&
      npReopen.fields["Project title"] === "" && npReopen.fields["Project location"] === "" &&
      npReopen.fields["Project type"] === "" && npReopen.fields["General contractor or contracting entity"] === "" &&
      npReopen.fields["Estimated budget in dollars"] === "" && npReopen.fields["Target completion duration in weeks"] === "" &&
      findField(npReopen, "Outline high-level trade scopes") === "";
    record("A24-04.1", "New Project modal: cancelled sentinel draft never leaks on reopen (all 7 fields cleared)", npCleared, { npReopen, specField: findField(npReopen, "Outline high-level trade scopes") });

    // ---------- 2. New Project inline error at 375px ----------
    await setInput(page, 'input[aria-label="Project title"]', "QA24 Error Probe");
    await setInput(page, 'input[aria-label="Project location"]', "Austin, TX");
    await setInput(page, 'input[aria-label="Project type"]', "Class-A");
    await setInput(page, 'input[aria-label="General contractor or contracting entity"]', "QA24 Error GC");
    await setInput(page, 'input[aria-label="Estimated budget in dollars"]', "2000000000");
    await setInput(page, 'input[aria-label="Target completion duration in weeks"]', "52");
    await setViewport(page, 375, 812);
    await delay(500);
    await clickText(page, "Create Commercial Project");
    await delay(1200);
    const err375 = await dialogState(page);
    const errPage375 = await overflowProbe(page);
    await shot(page, "fix4-qa24-newproject-error-375.png");
    record(
      "A24-04.2",
      "375px inline error: New Project validation message renders inside the dialog, visible and unclipped",
      /accidental extra digit/i.test(err375.alert || "") && err375.inViewport && !err375.horizontalClip && errPage375.docOverflowX <= 0 && errPage375.offendersTotal === 0,
      { alert: err375.alert, inViewport: err375.inViewport, horizontalClip: err375.horizontalClip, page: errPage375 }
    );
    // 200% equivalent
    await setViewport(page, 720, 450);
    await delay(600);
    const err200 = await dialogState(page);
    const errPage200 = await overflowProbe(page);
    await shot(page, "fix4-qa24-newproject-error-200pct.png");
    record(
      "A24-04.3",
      "200%-equivalent inline error: message inside dialog, dialog in viewport, no horizontal clip",
      /accidental extra digit/i.test(err200.alert || "") && err200.inViewport && !err200.horizontalClip && errPage200.docOverflowX <= 0,
      { alert: err200.alert, inViewport: err200.inViewport, horizontalClip: err200.horizontalClip, page: errPage200 }
    );
    await setViewport(page, 1500, 950);
    await closeTop(page);

    // ---------- 3. Create Trade Package modal reset ----------
    await clickTab(page, "CSI Scoping");
    await delay(1000);
    await clickText(page, "Create Trade Package");
    await delay(700);
    await setInput(page, 'input[aria-label="CSI division number"]', "09 99 99");
    await setInput(page, 'input[aria-label="Trade package name"]', "QA24-PKG-SENTINEL");
    await setInput(page, 'input[aria-label="Budget estimate in dollars"]', "424242");
    await setInput(page, 'textarea[aria-label="Scope summary"]', "QA24-SCOPE-SENTINEL");
    await setInput(page, 'textarea[aria-label="Mandatory inclusions, one per line"]', "QA24-INC-SENTINEL");
    await setInput(page, 'input[aria-label="Bid deadline"]', "2026-12-31");
    await escapeAndReopen(page, "Create Trade Package");
    const pkgReopen = await dialogState(page);
    const pkgReset = pkgReopen.open &&
      pkgReopen.fields["CSI division number"] === "26 00 00" &&
      pkgReopen.fields["Trade package name"] === "" &&
      pkgReopen.fields["Budget estimate in dollars"] === "1250000" &&
      pkgReopen.fields["Scope summary"] === "" &&
      pkgReopen.fields["Mandatory inclusions, one per line"] === "Crane hoisting\nSeismic bracing\nTemporary power" &&
      pkgReopen.fields["Bid deadline"] === "2026-09-30";
    record("A24-04.4", "Create Trade Package modal: cancelled draft resets to the documented defaults", pkgReset, { pkgReopen });
    await closeTop(page);

    // ---------- 4. AI Spec Breakdown modal reset ----------
    await clickText(page, "AI Spec Breakdown");
    await delay(1600);
    const specInitial = await dialogState(page);
    const specInitialVal = findField(specInitial, "Architectural and engineering specifications") || "";
    await setInput(page, 'textarea[aria-label="Architectural and engineering specifications text"]', "QA24-SPEC-SENTINEL");
    await escapeAndReopen(page, "AI Spec Breakdown");
    const specReopen = await dialogState(page);
    const specReopenVal = findField(specReopen, "Architectural and engineering specifications") || "";
    const specOk = specInitial.open &&
      !/QA24-SPEC-SENTINEL/.test(specReopenVal) &&
      /Division 26|Electrical/i.test(specReopenVal);
    record("A24-04.5", "AI Spec Breakdown modal: edited/dirty spec is discarded on reopen and the sample is re-seeded", specOk, { specInitialLen: specInitialVal.length, specInitialHead: specInitialVal.slice(0, 60), specReopenLen: specReopenVal.length, specReopenHead: specReopenVal.slice(0, 60) });
    await closeTop(page);

    // ---------- 5. Add Contractor modal reset ----------
    await clickTab(page, "Discovery");
    await delay(1200);
    await clickText(page, "Add Contractor Manually");
    await delay(700);
    await page.evaluate(() => {
      const v = (e) => e.getBoundingClientRect().width > 1;
      const d = [...document.querySelectorAll('[role="dialog"]')].filter(v).pop();
      const set = (sel, val) => {
        const el = d.querySelector(sel);
        if (!el) return;
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      set('input[placeholder="e.g. Rosendin Electric, Inc."]', "QA24-CTR-SENTINEL");
      set('input[placeholder="estimating@rosendin.com"]', "sentinel@qa24.invalid");
      set('select[aria-label="License verification status"]', "Self-Reported");
    });
    await delay(300);
    await escapeAndReopen(page, "Add Contractor Manually");
    const ctrReopen = await dialogState(page);
    const ctrReset = ctrReopen.open &&
      findField(ctrReopen, "Rosendin Electric") === "" &&
      findField(ctrReopen, "estimating@rosendin.com") === "" &&
      ctrReopen.fields["License verification status"] === "Active & Verified";
    record("A24-04.6", "Add Contractor modal: cancelled draft resets company/email and license status default", ctrReset, { ctrReopen: ctrReopen.fields });
    await closeTop(page);

    // ---------- 6. Ingest Quote modal reset ----------
    await clickTab(page, "Bid Leveling");
    await delay(1200);
    await clickText(page, "Ingest Quote / PDF");
    await delay(700);
    await page.evaluate(() => {
      const v = (e) => e.getBoundingClientRect().width > 1;
      const d = [...document.querySelectorAll('[role="dialog"]')].filter(v).pop();
      const sel = d.querySelector('select[aria-label="Subcontractor or bidder for this proposal"]');
      if (sel) {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, "new_contractor");
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await delay(400);
    await setInput(page, 'input[aria-label="Document or proposal filename"]', "QA24-QUOTE-SENTINEL.pdf");
    await setInput(page, 'input[aria-label="New subcontractor company name"]', "QA24-INGEST-NAME-SENTINEL");
    await escapeAndReopen(page, "Ingest Quote / PDF");
    const ingestReopen = await dialogState(page);
    const ingestReset = ingestReopen.open &&
      ingestReopen.fields["Document or proposal filename"] === "" &&
      (ingestReopen.fields["New subcontractor company name"] === "" || ingestReopen.fields["New subcontractor company name"] === undefined) &&
      findField(ingestReopen, "OCR") !== "QA24-QUOTE-SENTINEL" && findField(ingestReopen, "OCR") !== "SENTINEL";
    record("A24-04.7", "Ingest Quote modal: cancelled filename/custom-bidder draft is cleared on reopen", ingestReset, { ingestReopen: ingestReopen.fields });
    await closeTop(page);

    // ---------- 7. project/package switch: no stale package ----------
    await page.evaluate(() => {
      const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      const opt = [...sel.options].find((o) => o.textContent.includes("AUDIT-QA24-REPEAT"));
      sel.value = opt.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await delay(2200);
    const repeatPackages = (await c.query("tradePackages:listByProject", { projectId: F.repeat.id })) || [];
    const switchState = await page.evaluate(() => {
      const body = (document.querySelector("main") || document.body).innerText;
      return {
        hasIntentNames: /QA24 Intent (Electrical|HVAC)/.test(body),
        hasRepeatNames: /QA24 Repeat (Electrical|HVAC)/.test(body),
        activeSummary: body.split("\n").slice(0, 12).join("\n"),
      };
    });
    record(
      "A24-04.8",
      "project switch: current project's packages render and no INTENT package names leak into the Repeat view",
      repeatPackages.length === 2 && switchState.hasRepeatNames && !switchState.hasIntentNames,
      { repeatPkgCount: repeatPackages.length, switchState }
    );

    record("A24-04.9", "ui modals diagnostics", diag.pageErrors.length === 0, {
      pageErrors: diag.pageErrors.slice(0, 5).map((x) => x.slice(0, 200)),
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(-5).map((e) => e.text.slice(0, 160)),
    });
  } catch (err) {
    record("A24-04.ERR", "ui modals aborted", false, { error: String(err?.stack ?? err).slice(0, 900) });
  } finally {
    writeEvidence("ui-modals", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("ui-modals", log);
    await browser.close();
    console.log(`ui modals: ${results.filter((r) => r.pass).length}/${results.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-modals-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});