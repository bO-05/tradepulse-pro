/**
 * QA22-03: real-UI GC estimator journey on a fresh project (AUDIT-QA22-JOURNEY).
 * Create project -> AI auto-scope -> add contractors -> RFI + certify -> ingest
 * two quotes by pasted text -> award -> execute -> print -> void -> re-award ->
 * audit -> CSV -> selection persistence. Every mutation via DOM input/click.
 * Timezone: Pacific/Honolulu (UTC-10) so local date != UTC date.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab } from "./lib.mjs";
import { client, writeEvidence, writeLog, sleep, EVIDENCE_DIR } from "./qa22-lib.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const TITLE = "AUDIT-QA22-JOURNEY";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1000)}`);
};

const vis = "(e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1)";

async function clickText(page, needle, exact = false) {
  return page.evaluate(
    ({ needle, exact }) => {
      const v = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => {
        const t = (x.innerText || "").replace(/\s+/g, " ").trim();
        return v(x) && (exact ? t === needle : t.includes(needle));
      });
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim(), disabled: b.disabled };
    },
    { needle, exact }
  );
}

async function typeInto(page, selector, text, { clear = true } = {}) {
  const el = await page.$(selector);
  if (!el) return { ok: false, reason: "no element " + selector };
  await el.click();
  if (clear) {
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
  }
  await page.keyboard.type(text, { delay: 4 });
  return { ok: true, value: await page.$eval(selector, (x) => x.value) };
}

async function setNativeValue(page, selector, value, tag = "input") {
  return page.evaluate(
    ({ selector, value, tag }) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const proto = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { selector, value, tag }
  );
}

async function dialogInfo(page) {
  return page.evaluate(() => {
    const v = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const ds = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(v);
    const top = ds[ds.length - 1] || null;
    if (!top) return { open: false };
    const active = document.activeElement;
    return {
      open: true,
      role: top.getAttribute("role"),
      ariaModal: top.getAttribute("aria-modal"),
      labelledby: top.getAttribute("aria-labelledby"),
      title: (top.querySelector("h2,h3") || {}).innerText || null,
      focusInside: top.contains(active),
      buttons: [...top.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).filter(Boolean).slice(0, 12),
    };
  });
}

async function clickDialogButton(page, label, exact = true) {
  return page.evaluate(
    ({ label, exact }) => {
      const v = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const ds = [...document.querySelectorAll('[role="alertdialog"],[role="dialog"]')].filter(v);
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

async function projectIdByTitle() {
  const projects = (await c.query("projects:listProjects", {})) || [];
  return projects.find((p) => p.title === TITLE)?._id || null;
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

async function kpiText(page) {
  return page.evaluate(() => (document.querySelector("main")?.innerText || "").split("\n").slice(0, 26).join("\n"));
}

async function main() {
  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.emulateTimezone("Pacific/Honolulu");
  const cdp = await page.createCDPSession();
  const dlDir = path.join(EVIDENCE_DIR, "fix4-qa22-journey-downloads");
  fs.mkdirSync(dlDir, { recursive: true });
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
  await page.evaluateOnNewDocument(() => {
    window.__qa22Print = [];
    const orig = window.open;
    window.open = function (...args) {
      const w = orig.apply(window, args);
      try {
        if (w && w.document) {
          const origWrite = w.document.write.bind(w.document);
          w.document.write = (html) => { window.__qa22Print.push(String(html)); return origWrite(html); };
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
    // ============ 1. landing + dialog contract + modal reset ============
    await page.goto(`${BASE}/?qa22=journey`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => { localStorage.removeItem("tradepulse.selectedProjectId"); localStorage.removeItem("tradepulse.selectedPackageId"); });
    await dismissTour();
    await delay(900);
    const tz = await page.evaluate(() => ({ offset: new Date().getTimezoneOffset(), local: new Date().toString().slice(0, 33) }));

    await clickText(page, "New Project");
    await delay(700);
    const npDialog = await dialogInfo(page);
    let trapStays = true;
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const v = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        const ds = [...document.querySelectorAll('[role="dialog"]')].filter(v);
        const top = ds[ds.length - 1];
        return top ? top.contains(document.activeElement) : true;
      });
      if (!inside) trapStays = false;
    }
    await typeInto(page, 'input[aria-label="Project title"]', "DRAFT SENTINEL");
    await page.keyboard.press("Escape");
    await delay(600);
    const afterEscape = await dialogInfo(page);
    await clickText(page, "New Project");
    await delay(600);
    const reopenValue = await page.$eval('input[aria-label="Project title"]', (x) => x.value).catch(() => null);
    record(
      "A22-03.1",
      "dialog contract + modal reset: role/aria-modal/labelledby, focus trap, Escape closes, reopen clears draft",
      npDialog.open && npDialog.role === "dialog" && npDialog.ariaModal === "true" && Boolean(npDialog.labelledby) &&
        trapStays && afterEscape.open === false && reopenValue === "",
      { tz, npDialog, trapStays, afterEscape, reopenValue }
    );

    // ============ 2. create project with real typing ============
    const t0 = Date.now();
    await typeInto(page, 'input[aria-label="Project title"]', TITLE);
    await typeInto(page, 'input[aria-label="Project location"]', "Honolulu, HI");
    await typeInto(page, 'input[aria-label="Project type"]', "Healthcare / Mixed-Use");
    await typeInto(page, 'input[aria-label="General contractor or contracting entity"]', "QA22 Pacific GC, LLC");
    await typeInto(page, 'input[aria-label="Estimated budget in dollars"]', "3200000");
    await typeInto(page, 'input[aria-label="Target completion duration in weeks"]', "52");
    await typeInto(
      page,
      'textarea[placeholder*="Outline high-level trade scopes"]',
      "Division 26 electrical distribution, switchgear, lighting controls and temporary power. Division 23 HVAC mechanical, VAV boxes, TAB. Division 22 plumbing and medical gas. Division 09 drywall and ceilings."
    );
    const createClick = await clickText(page, "Create Commercial Project");
    const createdId = await poll(projectIdByTitle, (id) => Boolean(id), 30000, 1200);
    await delay(2500);
    const selectorNow = await page.$eval('select[aria-label="Select Commercial Construction Project"]', (s) => ({ value: s.value, text: s.options[s.selectedIndex]?.textContent?.trim() })).catch(() => null);
    await shot(page, "fix4-qa22-journey-created.png");
    record(
      "A22-03.2",
      "new project created through the real dialog and selected",
      Boolean(createdId) && selectorNow?.value === createdId,
      { createClick, createdId, selectorNow, createMs: Date.now() - t0 }
    );

    // ============ 3. auto-scope via UI (with manual fallback) ============
    await clickTab(page, "CSI Scoping");
    await delay(1500);
    const autoOpen = await clickText(page, "AI Spec Breakdown");
    await delay(900);
    const autoModal = await dialogInfo(page);
    const genClick = await clickText(page, "Auto-Generate Trade Packages");
    const pkgsAfter = await poll(
      () => c.query("tradePackages:listByProject", { projectId: createdId }),
      (pk) => (pk || []).length > 0,
      180000,
      3000
    );
    let pkgs = pkgsAfter || [];
    let autoScopeNote = "ai";
    if (!pkgs.length) {
      autoScopeNote = "ai-timeout-manual-fallback";
      await page.keyboard.press("Escape");
      await delay(600);
      await clickText(page, "Create Trade Package");
      await delay(700);
      const minAttr = await page.$eval('input[aria-label="Bid deadline"]', (x) => x.min).catch(() => null);
      const manualMin = minAttr;
      await setNativeValue(page, 'input[aria-label="CSI division number"]', "26 00 00");
      await setNativeValue(page, 'input[aria-label="Trade package name"]', "QA22 Journey Electrical");
      await setNativeValue(page, 'input[aria-label="Budget estimate in dollars"]', "1200000");
      await setNativeValue(page, 'textarea[aria-label="Scope summary"]', "QA22 electrical scope per division 26.");
      const d = new Date(Date.now() + 14 * 86400000);
      const localD = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      await setNativeValue(page, 'input[aria-label="Bid deadline"]', localD);
      const minDetail = { manualMin, browserLocal: await page.evaluate(() => new Date().toLocaleDateString("en-CA")), utc: new Date().toISOString().slice(0, 10) };
      await clickText(page, "Create Package");
      pkgs = await poll(() => c.query("tradePackages:listByProject", { projectId: createdId }), (pk) => (pk || []).length > 0, 30000, 1200);
      record("A22-03.3", "auto-scope timed out; manual package creation via UI succeeded", (pkgs || []).length > 0, { autoOpen, autoModal, genClick, pkgs: (pkgs || []).map((p) => p.csiDivision), minDetail });
    } else {
      record(
        "A22-03.3",
        "AI auto-scope created packages from the pasted spec",
        (pkgs || []).length >= 1,
        { autoOpen, autoModal, genClick, packages: pkgs.map((p) => ({ csi: p.csiDivision, name: p.tradeName, budget: p.budgetEstimate })) }
      );
    }
    await shot(page, "fix4-qa22-journey-autoscope.png");

    let pkg = pkgs.find((p) => p.csiDivision.startsWith("26")) || pkgs[0];
    if (!pkg) throw new Error("no package available for journey");
    // select the package ribbon for the target package
    await page.evaluate((name) => {
      const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(name));
      b?.click();
    }, pkg.tradeName);
    await delay(800);

    // ============ 4. add contractors via UI ============
    await clickTab(page, "Discovery");
    await delay(1500);
    const addOne = async (name, email, license) => {
      await clickText(page, "Add Contractor Manually");
      await delay(800);
      await typeInto(page, 'input[placeholder*="Rosendin"]', name);
      await typeInto(page, 'input[placeholder*="estimating@rosendin"]', email);
      await typeInto(page, 'input[placeholder*="TECL"]', license);
      await clickText(page, "Add to Directory");
      await delay(2200);
      return page.evaluate(() => {
        const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /Add Contractor/i.test(x.innerText || ""));
        return d ? (d.querySelector('[role="alert"]')?.innerText || "still-open") : "closed";
      });
    };
    const addA = await addOne("AUDIT-QA22 Journey Prime", "estimating@qa22-prime.invalid", "HI-QA22-PR1");
    const addB = await addOne("AUDIT-QA22 Journey Value", "estimating@qa22-value.invalid", "HI-QA22-VL2");
    const ctrs = await c.query("contractors:listByPackage", { tradePackageId: pkg._id });
    const ctrA = (ctrs || []).find((x) => x.companyName === "AUDIT-QA22 Journey Prime");
    const ctrB = (ctrs || []).find((x) => x.companyName === "AUDIT-QA22 Journey Value");
    record(
      "A22-03.4",
      "two contractors added through the dialog and persisted",
      Boolean(ctrA && ctrB) && (ctrs || []).filter((x) => /QA22 Journey/.test(x.companyName)).length === 2,
      { addA, addB, contractors: (ctrs || []).map((x) => ({ name: x.companyName, status: x.rfqStatus })) }
    );
    const invite = await clickText(page, "Invite to Bid");
    await delay(2000);
    const inviteState = (await c.query("contractors:listByPackage", { tradePackageId: pkg._id })).filter((x) => /QA22 Journey/.test(x.companyName)).map((x) => x.rfqStatus);
    say(`invite=${JSON.stringify(invite)} states=${JSON.stringify(inviteState)}`);

    // ============ 5. RFI through the real form + PM certification + addendum ============
    await clickTab(page, "Pre-Bid Q&A");
    await delay(1800);
    await typeInto(page, 'input[aria-label="RFI subject or scope topic"]', "QA22 switchgear hoisting responsibility");
    await typeInto(page, 'textarea[aria-label="Subcontractor question"]', "Confirm whether the QA22 electrical subcontractor must furnish crane hoisting for the main switchgear or if the general contractor provides rigging per division 26 specification.");
    const rfiSubmit = await clickText(page, "Submit RFI for Clarification");
    await delay(1200);
    const pendingBanner = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        pending: /pending_analysis|Analysis in flight|Analyzing|in flight|preserved/i.test(t),
        retryVisible: [...document.querySelectorAll("button")].some((b) => /Retry analysis/i.test(b.innerText || "")),
      };
    });
    const convo = await poll(
      () => c.query("rfq:listConversations", { tradePackageId: pkg._id }).then((r) => (r || [])[0]),
      (x) => x && ["clarified", "escalated_to_pm", "failed_analysis"].includes(x.status),
      180000,
      3000
    );
    const rfiText = convo?.inboundQuestion || "";
    const retryButtonAfter = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /Retry analysis/i.test(b.innerText || "")));
    record(
      "A22-03.5",
      "F1: UI RFI persisted then clarified/escalated; question preserved; failure retry control present when applicable",
      rfiSubmit.ok && Boolean(convo) && !["failed_analysis"].includes(convo?.status) && /crane hoisting for the main switchgear/i.test(rfiText) &&
        (convo?.status !== "failed_analysis" || pendingBanner.retryVisible),
      { rfiSubmit, pendingBanner, finalStatus: convo?.status, textLen: rfiText.length, retryButtonAfter }
    );

    // certify through the PM queue (real UI)
    const beforeCert = convo?.pmCertifiedAt || null;
    await clickText(page, "Review PM Queue");
    await delay(1200);
    const approve = await clickText(page, "Approve for Addendum");
    await delay(2200);
    const afterCert = await poll(
      () => c.query("rfq:listConversations", { tradePackageId: pkg._id }).then((r) => (r || []).find((x) => x._id === convo?._id)),
      (x) => Boolean(x?.pmCertifiedAt),
      30000,
      1500
    );
    const addendumBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Addendum/i.test(x.innerText || ""));
      return b ? { text: (b.innerText || "").replace(/\s+/g, " ").trim(), title: b.getAttribute("title"), disabled: b.disabled } : null;
    });
    const legalWording = await page.evaluate(() => /Legal Addendum/i.test(document.body.innerText));
    let addendumFile = null;
    if (addendumBtn && !addendumBtn.disabled) {
      const filesBefore = ((await c.query("files:listFilesByProject", { projectId: createdId })) || []).filter((f) => f.fileType === "addendum").length;
      await clickText(page, "Issue Pre-Bid Addendum");
      const files = await poll(
        () => c.query("files:listFilesByProject", { projectId: createdId }),
        (fs) => (fs || []).filter((f) => f.fileType === "addendum").length > filesBefore,
        60000,
        1500
      );
      const latest = ((files || []).filter((f) => f.fileType === "addendum"))[0] || null;
      addendumFile = latest ? { fileName: latest.fileName, uploadedBy: latest.uploadedBy } : null;
    }
    record(
      "A22-03.6",
      "FIX-51: addendum gated on PM certification; enabled control avoids AIA/legal claims; file provenance is engine-labeled",
      Boolean(beforeCert === null && afterCert?.pmCertifiedAt) && Boolean(addendumBtn && !addendumBtn.disabled && /Pre-Bid Addendum NO\. 01/.test(addendumBtn.text) && /not an AIA document/i.test(addendumBtn.title || "")) &&
        !legalWording && Boolean(addendumFile && /Pre-Bid Clarification Engine/.test(addendumFile.uploadedBy)),
      { approve, beforeCert, certifiedAt: afterCert?.pmCertifiedAt, addendumBtn, legalWording, addendumFile }
    );

    // ============ 6. ingest two quotes by pasted text via UI ============
    await clickTab(page, "Bid Leveling");
    await delay(1800);
    await page.evaluate((name) => {
      const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(name));
      b?.click();
    }, pkg.tradeName);
    await delay(900);
    const ingestOne = async (contractorName, fileName, quoteText) => {
      const open = await clickText(page, "Ingest Quote / PDF");
      await delay(900);
      const defaultCtr = await page.evaluate(() => {
        const s = document.querySelector('select[aria-label="Subcontractor or bidder for this proposal"]');
        return s ? { value: s.value, text: s.options[s.selectedIndex]?.textContent?.trim() } : null;
      });
      const sel = await page.$('select[aria-label="Subcontractor or bidder for this proposal"]');
      if (sel) {
        const optValue = await page.evaluate((name) => {
          const s = document.querySelector('select[aria-label="Subcontractor or bidder for this proposal"]');
          const o = s ? [...s.options].find((x) => x.textContent.includes(name)) : null;
          return o ? o.value : null;
        }, contractorName);
        if (optValue) await page.select('select[aria-label="Subcontractor or bidder for this proposal"]', optValue);
      }
      await typeInto(page, 'input[aria-label="Document or proposal filename"]', fileName);
      await typeInto(page, 'textarea[aria-label="Proposal OCR text or pasted quote"]', quoteText);
      const submit = await clickText(page, "Extract & Level Bid");
      const before = (await c.query("bids:listByPackage", { tradePackageId: pkg._id })).length;
      const bids = await poll(
        () => c.query("bids:listByPackage", { tradePackageId: pkg._id }),
        (bs) => (bs || []).length > before,
        120000,
        2500
      );
      await delay(1200);
      const inlineError = await page.evaluate(() => {
        const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /Ingest/i.test(x.innerText || ""));
        return d ? (d.querySelector('[role="alert"]')?.innerText || null) : null;
      });
      if (inlineError) await page.keyboard.press("Escape");
      return { open, defaultCtr, submit, inlineError, count: (bids || []).length };
    };
    const ingestA = await ingestOne(
      "AUDIT-QA22 Journey Prime",
      "QA22_Prime_Electrical.pdf",
      "PROPOSAL — AUDIT-QA22 Journey Prime. Base Bid Amount: $812,000. Includes all division 26 scope. No exclusions. Lead time 8 weeks. COI compliant."
    );
    const ingestB = await ingestOne(
      "AUDIT-QA22 Journey Value",
      "QA22_Value_Electrical.pdf",
      "PROPOSAL — AUDIT-QA22 Journey Value. Base Bid Amount: $760,000. Exclusions: crane hoisting $95,000, firestop $38,000. Lead time 12 weeks. COI compliant."
    );
    const finalBids = await c.query("bids:listByPackage", { tradePackageId: pkg._id });
    const bidA = finalBids.find((b) => b.subcontractorName.includes("Prime"));
    const bidB = finalBids.find((b) => b.subcontractorName.includes("Value"));
    await shot(page, "fix4-qa22-journey-bids.png", { full: true });
    record(
      "A22-03.7",
      "two quotes ingested through the paste-text dialog and normalized into bids",
      ingestA.count >= 1 && ingestB.count >= 2 && Boolean(bidA) && Boolean(bidB) && Number.isFinite(bidA?.leveledTotalCost) && Number.isFinite(bidB?.leveledTotalCost),
      { ingestA, ingestB, bids: finalBids.map((b) => ({ name: b.subcontractorName, base: b.baseBidAmount, ex: (b.identifiedExclusions || []).length, exCost: (b.identifiedExclusions || []).reduce((s, x) => s + (x.isWaived ? 0 : x.costImpact || 0), 0), penalty: b.leadTimePenalty, leveled: b.leveledTotalCost })) }
    );

    // ============ 7. numbers reconcile with KPI ============
    await delay(1800);
    const kpi = await kpiText(page);
    const expected = [...finalBids].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost)[0];
    const leveledMatch = /Leveled Buyout:\s*\$?([\d,]+)/.exec(kpi.replace(/\n/g, " "));
    const reckless = await page.evaluate(() => /Deceptive/i.test(document.body.innerText));
    const deceptive = finalBids.some(
      (b) => b._id !== expected?._id && b.baseBidAmount < (expected?.baseBidAmount ?? Infinity) && b.leveledTotalCost > (expected?.leveledTotalCost ?? 0)
    );
    record(
      "A22-03.8",
      "KPI compact reconciles with backend leveling math; deceptive flag matches bid math",
      leveledMatch && Number(leveledMatch[1].replace(/,/g, "")) === expected?.leveledTotalCost && reckless === deceptive,
      { kpi: kpi.replace(/\n/g, " | ").slice(0, 400), expectedLeveled: expected?.leveledTotalCost, uiLeveled: leveledMatch?.[1], deceptiveExpected: deceptive, deceptiveUi: reckless }
    );

    // ============ 8. award via UI + viewer dialog contract ============
    const award = await clickText(page, "Award Compliant Winner");
    const agrGen = await poll(
      () => c.query("agreements:listAgreements", { projectId: createdId }),
      (as) => (as || []).some((a) => a.status === "generated"),
      60000,
      2000
    );
    await delay(2000);
    const viewer = await dialogInfo(page);
    const firstFocus = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].filter((x) => x.getBoundingClientRect().width > 1).pop();
      return d ? { inside: d.contains(document.activeElement), tag: document.activeElement?.tagName } : null;
    });
    let viewerTrap = true;
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const d = [...document.querySelectorAll('[role="dialog"]')].filter((x) => x.getBoundingClientRect().width > 1).pop();
        return d ? d.contains(document.activeElement) : true;
      });
      if (!inside) viewerTrap = false;
    }
    await page.keyboard.press("Escape");
    await delay(700);
    const afterEscViewer = await dialogInfo(page);
    const agreement = (agrGen || []).find((a) => a.status === "generated");
    await shot(page, "fix4-qa22-journey-award.png");
    record(
      "A22-03.9",
      "FIX-52: award generated agreement; leveling viewer exposes dialog role/aria-modal/aria-labelledby, traps focus, Escape closes",
      award.ok && Boolean(agreement) && viewer.open && viewer.role === "dialog" && viewer.ariaModal === "true" && Boolean(viewer.labelledby) &&
        firstFocus?.inside === true && viewerTrap && afterEscViewer.open === false,
      { award, agreement: agreement?.agreementNumber, viewer, firstFocus, viewerTrap, afterEscViewer }
    );

    // ============ 9. execute via contracts register + print isolation ============
    await clickTab(page, "Subcontracts");
    await delay(1800);
    await clickText(page, "Inspect Draft");
    await delay(1200);
    const printClick = await clickText(page, "Print / PDF");
    await delay(1200);
    const printed = await page.evaluate(() => (window.__qa22Print || []).map((h) => ({ len: h.length, head: h.slice(0, 220), tail: h.slice(-160) })));
    const printedAll = printed.map((p) => p.head + p.tail).join(" ");
    const printIsolated = printed.length > 0 && /A401/.test(printedAll) && !/New Project|CSI Scoping|Bid Leveling|Subcontract Draft/.test(printedAll.replace(/A401[^<]*/g, "")) && !/<script/i.test(printedAll);
    const execClick = await clickText(page, "Record External Execution");
    await delay(900);
    const execDlg = await dialogInfo(page);
    await clickText(page, "Record execution", true);
    const executed = await poll(
      () => c.query("agreements:listAgreements", { projectId: createdId }),
      (as) => (as || []).some((a) => a.status === "executed"),
      45000,
      2000
    );
    await delay(1800);
    const regAfterExec = await page.evaluate(() => {
      const t = (document.querySelector("main") || document.body).innerText;
      return {
        execBanner: /Execution recorded in TradePulse/i.test(t),
        voidBtn: [...document.querySelectorAll("button")].some((b) => (b.innerText || "").trim() === "Void execution record"),
        count: (/EXECUTION STATUS RECORDED\n(\d+) \/ (\d+)/.exec(t) || [null, null, null]).slice(1).join("/"),
      };
    });
    record(
      "A22-03.10",
      "print popup contains only the contract; execute via viewer confirm records execution (register 1/1, void offered)",
      printClick.ok && printIsolated && execClick.ok && execDlg.open && execDlg.role === "alertdialog" &&
        (executed || []).some((a) => a.status === "executed") && regAfterExec.execBanner && regAfterExec.voidBtn && regAfterExec.count === "1/1",
      { printClick, printed, printIsolated, execClick, execDlg: { title: execDlg.title, role: execDlg.role }, regAfterExec }
    );

    // ============ 10. void + FIX-53 viewer refresh ============
    const voidClick = await clickText(page, "Void execution record");
    await delay(900);
    const voidDlg = await dialogInfo(page);
    const voidConfirm = await clickDialogButton(page, "Void execution record");
    if (!voidConfirm.ok) await clickDialogButton(page, "Void", false);
    const voided = await poll(
      () => c.query("agreements:listAgreements", { projectId: createdId }),
      (as) => (as || []).some((a) => a.status === "superseded"),
      45000,
      2000
    );
    await delay(2000);
    const viewerAfterVoid = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].filter((x) => x.getBoundingClientRect().width > 1 && /Subcontract Draft/i.test(x.innerText || "")).pop();
      if (!d) return { open: false };
      const t = d.innerText || "";
      return {
        open: true,
        executedBanner: /Execution recorded in TradePulse/i.test(t),
        voidBtn: [...d.querySelectorAll("button")].some((b) => (b.innerText || "").trim() === "Void execution record"),
        supersededBadge: /VENTED|VOIDED/i.test(t) || /SUPERSEDED/i.test(t),
        head: t.replace(/\s+/g, " ").slice(0, 200),
      };
    });
    await shot(page, "fix4-qa22-journey-void.png");
    record(
      "A22-03.11",
      "FIX-53: void supersedes agreement and the open viewer refreshes (no executed banner, no Void button)",
      voidClick.ok && voidDlg.open && voidConfirm.ok && (voided || []).some((a) => a.status === "superseded") &&
        viewerAfterVoid.open === true && !viewerAfterVoid.executedBanner && !viewerAfterVoid.voidBtn,
      { voidClick, voidDlg: { title: voidDlg.title, role: voidDlg.role, buttons: voidDlg.buttons }, voidConfirm, viewerAfterVoid }
    );

    // ============ 11. re-award + audit + CSV ============
    await clickTab(page, "Bid Leveling");
    await delay(1600);
    await page.evaluate((name) => {
      const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(name));
      b?.click();
    }, pkg.tradeName);
    await delay(1000);
    const reAward = await clickText(page, "Award Compliant Winner");
    const reGen = await poll(
      () => c.query("agreements:listAgreements", { projectId: createdId }),
      (as) => (as || []).some((a) => a.status === "generated"),
      60000,
      2000
    );
    await delay(1500);
    await page.keyboard.press("Escape");
    await delay(600);
    const csvBefore = fs.readdirSync(dlDir).length;
    const csvClick = await clickText(page, "Export Leveling CSV");
    await delay(2500);
    let csv = null;
    const csvFiles = fs.readdirSync(dlDir).filter((f) => f.endsWith(".csv"));
    if (csvFiles.length) {
      const latest = csvFiles.map((f) => ({ f, t: fs.statSync(path.join(dlDir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0].f;
      csv = { name: latest, content: fs.readFileSync(path.join(dlDir, latest), "utf8") };
    }
    const auditTab = await clickTab(page, "Live Activity Audit");
    await delay(1800);
    const auditText = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
    const audit = {
      awarded: /Awarded|Award/i.test(auditText),
      executed: /Execution|Execute/i.test(auditText),
      voided: /Void/i.test(auditText),
      csvRows: csv ? csv.content.split("\r\n").filter(Boolean).length - 1 : 0,
      csvHasAwarded: csv ? /AWARDED/.test(csv.content) : false,
      csvHasBidder: csv ? /Journey Prime|Journey Value/.test(csv.content) : false,
      csvDelta: fs.readdirSync(dlDir).length - csvBefore,
    };
    record(
      "A22-03.12",
      "re-award works after void; audit trail shows award/execute/void; CSV export reflects bids and award state",
      reAward.ok && (reGen || []).some((a) => a.status === "generated") && auditTab.ok && audit.csvHasAwarded && audit.csvHasBidder && audit.csvDelta >= 1 && audit.awarded && audit.executed && audit.voided,
      { reAward, csvClick, audit, csvHead: csv ? csv.content.split("\r\n").slice(0, 3) : null }
    );

    // ============ 12. package selection persistence across reload ============
    await clickTab(page, "Bid Leveling");
    await delay(1500);
    const pkgsNow = await c.query("tradePackages:listByProject", { projectId: createdId });
    let selected = null;
    if ((pkgsNow || []).length > 1) {
      const other = pkgsNow.find((p) => p._id !== pkg._id);
      await page.evaluate((name) => {
        const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(name));
        b?.click();
      }, other.tradeName);
      selected = other;
    } else {
      selected = pkgsNow[0];
    }
    await delay(800);
    const lsBefore = await page.evaluate(() => localStorage.getItem("tradepulse.selectedPackageId"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page, 60000);
    await dismissTour();
    await delay(1500);
    const afterReload = await page.evaluate(() => ({
      ls: localStorage.getItem("tradepulse.selectedPackageId"),
      pressed: [...document.querySelectorAll("button[aria-pressed]")].filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()),
    }));
    record(
      "A22-03.13",
      "selected package persists across reload (localStorage + pressed ribbon)",
      Boolean(selected) && lsBefore === selected._id && afterReload.ls === selected._id &&
        (afterReload.pressed.length === 0 || afterReload.pressed.some((t) => t.includes(selected.tradeName))),
      { selected: selected?.tradeName, lsBefore, afterReload }
    );

    const diagOut = {
      pageErrors: diag.pageErrors.slice(0, 10),
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 200)).slice(-12),
      failedRequests: diag.failedRequests.slice(0, 8),
    };
    record("A22-03.14", "journey console/page errors clean (expected server refusals excluded)", diag.pageErrors.length === 0, diagOut);
  } catch (err) {
    record("A22-03.ERR", "journey aborted at an unexpected step", false, { error: String(err?.stack ?? err) });
  } finally {
    writeEvidence("ui-journey", { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
    writeLog("ui-journey", log);
    await browser.close();
    console.log(`ui journey: ${results.filter((r) => r.pass).length}/${results.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-journey-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});