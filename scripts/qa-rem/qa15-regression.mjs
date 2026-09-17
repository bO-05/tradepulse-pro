// QA-15 Item 2: independent regression quick-pass (round 7).
// A) backend probes: CSI "99 99 99" rejected + $1 bid rejected (readable msgs, no state change)
// B) UI: CSI rejection readable in modal; guest RFI accepted (toast + backend persistence)
// C) deep link ?project=&tab=discovery boots; Discovery empty-state CTA "Go to CSI Scoping" navigates
// D) 8-tab sweep on populated QA-15 fixture: zero console errors / zero responses >= 400
// E) mobile 375x812: zero horizontal overflow (demo + fixture)
// Usage: node scripts/qa-rem/qa15-regression.mjs
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import {
  launchBrowser,
  EVIDENCE_DIR,
  BASE_URL,
  waitForAppReady,
  shot,
  delay,
  setInputValue,
  clickButtonByText,
} from "./qa1-lib.mjs";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(BACKEND);
const EMPTY_TAG = `QA-REM-QA15-EMPTY-${Date.now()}`;
const RFI_SUBJECT = `QA-15 guest RFI hoisting scope ${Date.now()}`;

const LOG = [];
const OUT = { site: BASE_URL, backend: BACKEND, startedAt: new Date().toISOString(), items: {}, steps: {} };
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};

const readable = (e) => {
  if (!e) return "";
  if (e.data !== undefined) return typeof e.data === "string" ? e.data : JSON.stringify(e.data);
  return String(e.message || e);
};

function attachNet(page) {
  const state = { consoleErrors: [], consoleWarnings: [], pageErrors: [], badResponses: [], requestFailed: [] };
  page.on("console", (m) => {
    if (m.type() === "error") state.consoleErrors.push(m.text());
    if (m.type() === "warning") state.consoleWarnings.push(m.text());
  });
  page.on("pageerror", (e) => state.pageErrors.push(String(e?.message || e)));
  page.on("response", (r) => {
    const s = r.status();
    if (s >= 400) state.badResponses.push(`${s} ${r.request().method()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => state.requestFailed.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText || "unknown"}`));
  return state;
}

async function dismissTour(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[title]")].find((x) =>
      /Close Demo Tour|Close Teleprompter/i.test(x.getAttribute("title") || "")
    );
    if (b) b.click();
  });
  await delay(250);
}

async function getSelectedProject(page) {
  return page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    if (!sel) return null;
    return sel.options[sel.selectedIndex]?.textContent?.trim() || null;
  });
}
async function urlTab(page) {
  return page.evaluate(() => new URLSearchParams(window.location.search).get("tab"));
}
async function bodyHas(page, text) {
  return page.evaluate((t) => document.body.innerText.includes(t), text);
}
async function clickTab(page, label, isMobile = false) {
  if (isMobile) {
    const ok = await page.evaluate((lbl) => {
      const sel = document.querySelector('select[aria-label="Navigate procurement stage"]');
      if (!sel) return false;
      const opt = [...sel.options].find((o) => o.textContent.trim() === lbl);
      if (!opt) return false;
      sel.value = opt.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, label);
    await delay(500);
    return ok;
  }
  const ok = await page.evaluate((lbl) => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().includes(lbl));
    if (!btn) return false;
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return true;
  }, label);
  await delay(500);
  return ok;
}
async function overflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const vw = window.innerWidth;
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && String(el.className).slice(0, 70)) || "",
          left: Math.round(r.left),
          right: Math.round(r.right),
          text: (el.textContent || "").trim().slice(0, 60),
        });
        if (offenders.length >= 12) break;
      }
    }
    return { innerWidth: vw, scrollWidth: doc.scrollWidth, overflowPx: Math.max(0, doc.scrollWidth - vw), offenders };
  });
}

const TAB_ORDER = [
  { id: "packages", label: "CSI Scoping", keyword: "CSI MasterFormat Trade Packages" },
  { id: "discovery", label: "Discovery", keyword: "Discovery & Directory" },
  { id: "qna", label: "Pre-Bid Q&A", keyword: "Pre-Bid RFI Autonomous Clarification" },
  { id: "leveling", label: "Bid Leveling", keyword: "Real-Time Forensic Bid Leveling Matrix" },
  { id: "coordination", label: "Scope Clash", keyword: "Cross-Trade Scope Clash" },
  { id: "contracts", label: "Subcontracts", keyword: "Subcontract Agreements Register" },
  { id: "audit", label: "Live Activity Audit", keyword: "Live Reactive Activity Audit Stream" },
  { id: "diagnostics", label: "Evals & Architecture", keyword: "Sponsor Integration Hub" },
];

async function main() {
  ev("=== QA-15 ITEM 2 REGRESSION ===");
  ev(`UTC: ${new Date().toISOString()}`);
  ev("");

  const allProjects = await client.query("projects:listProjects", {});
  const fixture = allProjects.find((p) => p.title.startsWith("QA-REM-QA15-O1-"));
  const demo = allProjects.find((p) => p.isDemoProject);
  if (!fixture) throw new Error("QA-15 O1 fixture not found");
  const packages = await client.query("tradePackages:listByProject", { projectId: fixture._id });
  const elecPkg = packages.find((p) => String(p.csiDivision).startsWith("26"));
  const bidsBefore = await client.query("bids:listAllProjectBids", { projectId: fixture._id });
  ev(`fixture=${fixture._id} pkg26=${elecPkg?._id} packages=${packages.length} bids=${bidsBefore.length}`);
  OUT.steps.fixture = { id: fixture._id, packages: packages.length, elecPkg: elecPkg?._id, bids: bidsBefore.length };
  OUT.items.fixture_ready = Boolean(fixture && elecPkg && packages.length === 2 && bidsBefore.length >= 1);

  // ---------------- A) backend probes ----------------
  const csiProbe = await client
    .mutation("tradePackages:createTradePackage", {
      projectId: fixture._id,
      csiDivision: "99 99 99",
      tradeName: "QA-15 Invalid CSI Probe",
      budgetEstimate: 400000,
      scopeSummary: "QA-15 invalid csi probe",
      mandatoryInclusions: [],
      bidDeadline: "2026-10-31",
    })
    .then((r) => ({ accepted: true, result: r }))
    .catch((e) => ({ accepted: false, message: readable(e) }));
  ev(`[A] backend CSI 99 99 99 -> accepted=${csiProbe.accepted} message=${JSON.stringify(csiProbe.message)}`);
  OUT.steps.backendCsi = csiProbe;
  OUT.items.backend_csi_rejected =
    csiProbe.accepted === false && Boolean(csiProbe.message) && !csiProbe.message.includes("[CONVEX") && /CSI|NN NN NN|division/i.test(csiProbe.message);

  const contractors = await client.query("contractors:listByPackage", { tradePackageId: elecPkg._id });
  const ctrId = contractors[0]?._id;
  const bidProbe = await client
    .mutation("bids:submitDirectBid", {
      tradePackageId: elecPkg._id,
      contractorId: ctrId,
      subcontractorName: "QA-15 Electric",
      baseBidAmount: 1,
    })
    .then((r) => ({ accepted: true, result: r }))
    .catch((e) => ({ accepted: false, message: readable(e) }));
  ev(`[A] backend $1 bid -> accepted=${bidProbe.accepted} message=${JSON.stringify(bidProbe.message)}`);
  OUT.steps.backendDollar1 = bidProbe;
  OUT.items.backend_dollar1_rejected =
    bidProbe.accepted === false && Boolean(bidProbe.message) && !bidProbe.message.includes("[CONVEX") && /\$1|1,000|implausibly/i.test(bidProbe.message);

  const packagesAfterProbe = await client.query("tradePackages:listByProject", { projectId: fixture._id });
  const bidsAfterProbe = await client.query("bids:listAllProjectBids", { projectId: fixture._id });
  ev(`[A] state unchanged: packages ${packages.length}->${packagesAfterProbe.length}, bids ${bidsBefore.length}->${bidsAfterProbe.length}`);
  OUT.items.backend_probe_no_state_change =
    packagesAfterProbe.length === packages.length && bidsAfterProbe.length === bidsBefore.length;
  ev("");

  const { browser, executablePath } = await launchBrowser();
  ev(`[browser] ${executablePath}`);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    const diag = attachNet(page);

    // ---------------- B1) UI CSI rejection ----------------
    await page.goto(`${BASE_URL}/?project=${fixture._id}&tab=packages`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(800);
    const openModal = await clickButtonByText(page, "Create Trade Package");
    await delay(600);
    await setInputValue(page, 'input[placeholder="e.g. 26 00 00"]', "99 99 99");
    await setInputValue(page, 'input[placeholder="e.g. Electrical & Lighting Systems"]', "QA-15 Invalid CSI Probe");
    await setInputValue(page, 'input[type="number"]', "400000");
    await setInputValue(page, 'textarea[placeholder="Scope details..."]', "QA-15 invalid CSI probe scope.");
    await page.evaluate(() => {
      const el = document.querySelector('input[type="date"]');
      if (!el) return;
      el.removeAttribute("min");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, "2026-10-31");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await delay(300);
    const submit = await clickButtonByText(page, "Create Package");
    let csiErrorText = null;
    {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        csiErrorText = await page.evaluate(() => {
          const h3 = [...document.querySelectorAll("h3")].find((h) => h.textContent.trim() === "Create CSI Trade Package");
          const root = h3?.closest("div.fixed");
          const el = root ? root.querySelector("p.text-rose-400") : null;
          return el ? el.textContent.trim() : null;
        });
        if (csiErrorText) break;
        await delay(400);
      }
    }
    await shot(page, "remediation-qa15-reg-01-csi-reject.png");
    ev(`[B1] openModal=${JSON.stringify(openModal)} submit=${JSON.stringify(submit)} errorText=${JSON.stringify(csiErrorText)}`);
    OUT.steps.uiCsi = { openModal, submit, errorText: csiErrorText };
    OUT.items.ui_csi_rejected_readable = Boolean(
      csiErrorText && !csiErrorText.includes("[CONVEX") && /CSI|NN NN NN|division/i.test(csiErrorText)
    );
    // close modal
    const modalStillOpen = await page.evaluate(() =>
      Boolean([...document.querySelectorAll("h3")].find((h) => h.textContent.trim() === "Create CSI Trade Package"))
    );
    if (modalStillOpen) {
      await clickButtonByText(page, "Cancel");
      await delay(600);
    }
    const pkgNoLeak = await client.query("tradePackages:listByProject", { projectId: fixture._id });
    OUT.items.ui_csi_no_package_leak = !pkgNoLeak.some((p) => p.tradeName === "QA-15 Invalid CSI Probe");
    ev(`[B1] no invalid package persisted: ${OUT.items.ui_csi_no_package_leak}`);
    ev("");

    // ---------------- B2) guest RFI ----------------
    // select the Div 26 package card
    const cardClick = await page.evaluate((tradeName) => {
      const h3 = [...document.querySelectorAll("h3")].find((x) => (x.textContent || "").trim() === tradeName);
      if (!h3) {
        return { ok: false, h3s: [...document.querySelectorAll("h3")].map((x) => x.textContent.trim()).slice(0, 20) };
      }
      (h3.closest("div[class*='cursor-pointer']") || h3.closest("div")).click();
      return { ok: true };
    }, "QA-15 Electrical");
    await delay(800);
    const qnaTab = await clickTab(page, "Pre-Bid Q&A");
    await delay(1000);
    const formState = await page.evaluate(() => {
      const select = [...document.querySelectorAll("select")].find((s) =>
        [...s.options].some((o) => o.value === "guest_contractor")
      );
      const subject = document.querySelector('input[placeholder="e.g. Hoisting responsibility for switchgear"]');
      const question = document.querySelector('textarea[placeholder="Ask a technical or scope coordination question..."]');
      const submit = [...document.querySelectorAll("button")].find((b) =>
        (b.textContent || "").includes("Submit RFI for Clarification")
      );
      return {
        guestOptionPresent: Boolean(select),
        subjectPresent: Boolean(subject),
        questionPresent: Boolean(question),
        submitPresent: Boolean(submit),
      };
    });
    ev(`[B2] cardClick=${JSON.stringify(cardClick)} qnaTab=${qnaTab} form=${JSON.stringify(formState)}`);
    const setGuest = await page.evaluate(() => {
      const select = [...document.querySelectorAll("select")].find((s) =>
        [...s.options].some((o) => o.value === "guest_contractor")
      );
      if (!select) return false;
      select.value = "guest_contractor";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    });
    await setInputValue(page, 'input[placeholder="e.g. Hoisting responsibility for switchgear"]', RFI_SUBJECT);
    await setInputValue(
      page,
      'textarea[placeholder="Ask a technical or scope coordination question..."]',
      "As a guest/inquiring subcontractor: does Division 26 include crane hoisting for rooftop switchgear?"
    );
    await delay(300);
    const t0 = Date.now();
    const rfiSubmit = await clickButtonByText(page, "Submit RFI for Clarification");
    let toastOk = false;
    let toastFail = null;
    {
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        const text = await page.evaluate(() => document.body.innerText);
        if (text.includes("RFI submitted to TradePulse autonomous AI clarification engine")) {
          toastOk = true;
          break;
        }
        const m = text.match(/RFI clarification failed:[^\n]*/);
        if (m) {
          toastFail = m[0];
          break;
        }
        await delay(500);
      }
    }
    let subjectVisible = false;
    {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (await bodyHas(page, RFI_SUBJECT)) {
          subjectVisible = true;
          break;
        }
        await delay(500);
      }
    }
    await shot(page, "remediation-qa15-reg-02-guest-rfi-submitted.png");
    const convos = await client.query("rfq:listConversations", { tradePackageId: elecPkg._id });
    const guestConvo = convos.find((c) => (c.inboundSubject || "").includes("QA-15 guest RFI"));
    ev(
      `[B2] setGuest=${setGuest} submit=${JSON.stringify(rfiSubmit)} toastOk=${toastOk} toastFail=${toastFail} subjectVisible=${subjectVisible} backendConvo=${Boolean(guestConvo)} (${Date.now() - t0}ms)`
    );
    if (guestConvo) {
      ev(`[B2] backend convo: status=${guestConvo.status} contractorId=${guestConvo.contractorId ?? "none"} replyLen=${(guestConvo.autonomousReply || "").length}`);
    }
    OUT.steps.guestRfi = {
      cardClick,
      qnaTab,
      formState,
      setGuest,
      rfiSubmit,
      toastOk,
      toastFail,
      subjectVisible,
      backendConvo: guestConvo
        ? { status: guestConvo.status, contractorId: guestConvo.contractorId ?? null, subject: guestConvo.inboundSubject }
        : null,
    };
    OUT.items.guest_rfi_accepted = Boolean(
      formState.guestOptionPresent && setGuest && toastOk && subjectVisible && guestConvo && (guestConvo.contractorId === undefined || guestConvo.contractorId === null)
    );
    ev("");

    // ---------------- C1) deep link discovery ----------------
    await page.goto(`${BASE_URL}/?project=${fixture._id}&tab=discovery`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(1000);
    const dl = {
      urlTab: await urlTab(page),
      selected: await getSelectedProject(page),
      discoveryContent: await bodyHas(page, "Discovery & Directory"),
      projectUrl: await page.evaluate(() => new URLSearchParams(window.location.search).get("project")),
    };
    await shot(page, "remediation-qa15-reg-03-deeplink-discovery.png");
    ev(`[C1] deep link: ${JSON.stringify(dl)}`);
    OUT.steps.deepLink = dl;
    OUT.items.deeplink_discovery_boots =
      dl.urlTab === "discovery" && dl.projectUrl === fixture._id && Boolean(dl.selected && dl.selected.includes("QA-REM-QA15-O1")) && dl.discoveryContent;
    ev("");

    // ---------------- C2) Discovery empty-state CTA ----------------
    const emptyId = await client.mutation("projects:createProject", {
      title: EMPTY_TAG,
      location: "Austin, TX",
      projectType: "QA round 7 empty",
      estBudget: 1200000,
      targetCompletionWeeks: 26,
      specDocumentText: "QA-15 empty CTA fixture.",
      isDemoProject: false,
    });
    await page.goto(`${BASE_URL}/?project=${emptyId}&tab=discovery`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(1000);
    const ctaVisible = await bodyHas(page, "Go to CSI Scoping");
    const ctaPrompt = await bodyHas(page, "Please select a trade package to manage subcontractor discovery");
    await shot(page, "remediation-qa15-reg-04-cta-empty.png");
    let ctaNavigated = null;
    if (ctaVisible) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Go to CSI Scoping"));
        if (b) b.click();
      });
      await delay(800);
      ctaNavigated = await urlTab(page);
      await shot(page, "remediation-qa15-reg-05-cta-after-click.png");
    }
    ev(`[C2] empty project CTA visible=${ctaVisible} prompt=${ctaPrompt} afterClickTab=${ctaNavigated}`);
    OUT.steps.cta = { emptyId, ctaVisible, ctaPrompt, ctaNavigated };
    OUT.items.cta_visible_and_navigates = Boolean(ctaVisible && ctaPrompt && ctaNavigated === "packages");
    await client.mutation("projects:deleteProject", { projectId: emptyId }).catch(() => {});
    const afterEmptyDelete = await client.query("projects:listProjects", {});
    OUT.items.empty_fixture_deleted = !afterEmptyDelete.some((p) => p._id === emptyId);
    ev("");

    // ---------------- D) 8-tab sweep ----------------
    await page.goto(`${BASE_URL}/?project=${fixture._id}&tab=packages`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(900);
    const base = {
      ce: diag.consoleErrors.length,
      cw: diag.consoleWarnings.length,
      pe: diag.pageErrors.length,
      br: diag.badResponses.length,
      rf: diag.requestFailed.length,
    };
    let sweepErrors = 0;
    for (const tab of TAB_ORDER) {
      const clicked = await clickTab(page, tab.label);
      await delay(900);
      const rec = {
        id: tab.id,
        clicked,
        urlTab: await urlTab(page),
        keywordFound: await bodyHas(page, tab.keyword),
        newConsoleErrors: diag.consoleErrors.slice(base.ce),
        newConsoleWarnings: diag.consoleWarnings.slice(base.cw),
        newPageErrors: diag.pageErrors.slice(base.pe),
        newBadResponses: diag.badResponses.slice(base.br),
        newRequestFailed: diag.requestFailed.slice(base.rf),
      };
      rec.ok = clicked && rec.urlTab === tab.id && rec.newConsoleErrors.length === 0 && rec.newPageErrors.length === 0 && rec.newBadResponses.length === 0;
      if (!rec.ok) sweepErrors += 1;
      OUT.steps.tabs = OUT.steps.tabs || [];
      OUT.steps.tabs.push(rec);
      await shot(page, `remediation-qa15-reg-tab-${tab.id}.png`);
      ev(
        `[D] ${tab.id}: clicked=${clicked} urlTab=${rec.urlTab} content=${rec.keywordFound} consoleErr=${rec.newConsoleErrors.length} pageErr=${rec.newPageErrors.length} bad>=400=${rec.newBadResponses.length} reqFailed=${rec.newRequestFailed.length} ${rec.ok ? "OK" : "ISSUE"}`
      );
    }
    OUT.items.tab_sweep_clean = sweepErrors === 0;
    OUT.items.tab_sweep_content_all = (OUT.steps.tabs || []).every((t) => t.keywordFound);
    OUT.steps.tabSweepTotals = {
      consoleErrors: diag.consoleErrors.length,
      consoleWarnings: diag.consoleWarnings.length,
      pageErrors: diag.pageErrors.length,
      badResponses: diag.badResponses.length,
      requestFailed: diag.requestFailed.length,
    };
    ev(
      `[D] sweep failures=${sweepErrors}; totals consoleErr=${diag.consoleErrors.length} pageErr=${diag.pageErrors.length} bad>=400=${diag.badResponses.length} reqFailed=${diag.requestFailed.length}`
    );
    ev("");

    // ---------------- E) mobile 375x812 ----------------
    const mobile = await browser.newPage();
    await mobile.setViewport({ width: 375, height: 812 });
    OUT.steps.mobile = [];
    for (const proj of [
      { type: "demo", id: demo._id },
      { type: "fixture", id: fixture._id },
    ]) {
      const rec = { type: proj.type, id: proj.id, tabs: [], maxOverflow: 0 };
      await mobile.goto(`${BASE_URL}/?project=${proj.id}&tab=packages`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForAppReady(mobile, 45000);
      await dismissTour(mobile);
      await delay(800);
      for (const tab of TAB_ORDER) {
        const clicked = await clickTab(mobile, tab.label, true);
        await delay(650);
        const ov = await overflow(mobile);
        rec.tabs.push({ id: tab.id, clicked, overflowPx: ov.overflowPx, offenders: ov.offenders });
        rec.maxOverflow = Math.max(rec.maxOverflow, ov.overflowPx);
      }
      await shot(mobile, `remediation-qa15-reg-mobile-${proj.type}.png`);
      OUT.steps.mobile.push(rec);
      ev(`[E] mobile ${proj.type}: maxOverflow=${rec.maxOverflow}px tabs=${rec.tabs.map((t) => `${t.id}:${t.overflowPx}`).join(" ")}`);
    }
    await mobile.close();
    OUT.items.mobile_no_overflow = OUT.steps.mobile.every((m) => m.maxOverflow === 0);
  } finally {
    await browser.close();
  }

  const failed = Object.entries(OUT.items).filter(([, v]) => !v).map(([k]) => k);
  OUT.finishedAt = new Date().toISOString();
  OUT.overall = failed.length === 0 ? "PASS" : "FAIL";
  ev("");
  ev(`ITEMS: ${Object.entries(OUT.items).map(([k, v]) => `${k}=${v ? "PASS" : "FAIL"}`).join(" | ")}`);
  ev(`OVERALL: ${OUT.overall}${failed.length ? ` (failed: ${failed.join(", ")})` : ""}`);

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-regression.txt"), LOG.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-regression.json"), JSON.stringify(OUT, null, 2), "utf8");
  console.log("Wrote regression evidence.");
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "remediation-qa15-regression.txt"),
    LOG.join("\n") + `\nFATAL: ${e?.stack || e?.message}\n`,
    "utf8"
  );
  process.exit(1);
});