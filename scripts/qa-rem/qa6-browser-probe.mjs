// QA-6 adversarial browser probe: tab/console sweep, bad-input fuzzing, deep links, mobile, UX.
// Usage: node scripts/qa-rem/qa6-browser-probe.mjs
import {
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  delay,
  BASE_URL,
  writeLog,
  getSelectorState,
  selectProjectByTitle,
  bodyText,
  clickButtonByText,
} from "./qa1-lib.mjs";

const LOG = [];
const CASE = {};
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 400) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "â€¦" : s;
};

const diag = {};
let httpErrors = [];

function snapDiag() {
  return {
    console: diag.consoleLogs.length,
    pageErrors: diag.pageErrors.length,
    failedReq: diag.failedRequests.length,
    httpErrors: httpErrors.length,
  };
}
function deltaDiag(before) {
  return {
    console: diag.consoleLogs.slice(before.console).map((l) => `[${l.type}] ${l.text}`),
    pageErrors: diag.pageErrors.slice(before.pageErrors),
    failedReq: diag.failedRequests.slice(before.failedReq),
    httpErrors: httpErrors.slice(before.httpErrors),
  };
}
function diagLine(d) {
  const parts = [];
  if (d.console.length) parts.push(`console=${J(d.console)}`);
  if (d.pageErrors.length) parts.push(`pageErrors=${J(d.pageErrors)}`);
  if (d.failedReq.length) parts.push(`failedReq=${J(d.failedReq)}`);
  if (d.httpErrors.length)
    parts.push(`httpErrors=${J(d.httpErrors.map((x) => `${x.method} ${x.status} ${x.url}`))}`);
  return parts.length ? parts.join(" | ") : "clean";
}

async function fillFieldByLabel(page, formText, label, value) {
  return page.evaluate(
    (formText, label, value) => {
      const forms = [...document.querySelectorAll("form")];
      const form = forms.find((f) => (f.textContent || "").includes(formText));
      if (!form) return { ok: false, reason: `form not found: ${formText}` };
      const candidates = [...form.querySelectorAll("label")].filter(
        (l) => l.textContent.trim() === label
      );
      if (!candidates.length) {
        return {
          ok: false,
          reason: `label not found: ${label}`,
          labels: [...form.querySelectorAll("label")].map((l) => l.textContent.trim()),
        };
      }
      const el =
        candidates[0].parentElement.querySelector("input, textarea, select") ||
        candidates[0].nextElementSibling;
      if (!el) return { ok: false, reason: `input not found after label: ${label}` };
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, tag: el.tagName, value: el.value, validity: el.validity ? {...el.validity} : null };
    },
    formText,
    label,
    value
  );
}

async function readFormError(page, formText) {
  return page.evaluate((formText) => {
    const forms = [...document.querySelectorAll("form")];
    const form = forms.find((f) => (f.textContent || "").includes(formText));
    if (!form) return null;
    const p = [...form.querySelectorAll('p,div[role="alert"]')].find((x) => /rose|red|error/i.test(x.className));
    return p ? p.textContent.trim() : null;
  }, formText);
}

async function clickExactButton(page, text) {
  return page.evaluate((t) => {
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((x) => (x.textContent || "").trim() === t);
    if (!b) return { ok: false, available: btns.map((x) => (x.textContent || "").trim()).filter(Boolean).slice(0, 80) };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, disabled: b.disabled };
  }, text);
}

async function checkFormState(page, formText) {
  return page.evaluate((formText) => {
    const forms = [...document.querySelectorAll("form")];
    const form = forms.find((f) => (f.textContent || "").includes(formText));
    if (!form) return null;
    const submit = form.querySelector('button[type="submit"]');
    return {
      formValid: form.checkValidity(),
      submitDisabled: submit ? submit.disabled : null,
      submitLabel: submit ? submit.textContent.trim() : null,
      fields: [...form.querySelectorAll("input,textarea,select")].map((el) => ({
        tag: el.tagName,
        type: el.type,
        value: String(el.value).slice(0, 60),
        required: el.required,
        valid: el.checkValidity ? el.checkValidity() : null,
        patternMismatch: el.validity ? el.validity.patternMismatch : undefined,
        rangeUnderflow: el.validity ? el.validity.rangeUnderflow : undefined,
      })),
    };
  }, formText);
}

async function run() {
  const { browser } = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(25000);
    Object.assign(diag, attachDiagnostics(page));
    page.on("response", (r) => {
      if (r.status() >= 400) {
        httpErrors.push({ status: r.status(), method: r.request().method(), url: r.url() });
      }
    });

    ev("=== QA-6 BROWSER PROBE ===");
    ev(`Base URL: ${BASE_URL}`);
    ev(`UTC: ${new Date().toISOString()}`);
    ev("");

    ev("[P0] initial load");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(1500);
    const initialSel = await getSelectorState(page);
    ev(`initial selector: ${J({ value: initialSel.value, text: initialSel.selectedText, count: initialSel.options.length })}`);
    ev(`initial diag: ${diagLine(deltaDiag({ console: 0, pageErrors: 0, failedReq: 0, httpErrors: 0 }))}`);
    await shot(page, "remediation-qa6-01-initial-load.png");

    // ---- Phase 1: tab sweep on demo project ----
    ev("");
    ev("[P1] tab sweep (demo project)");
    const demoSelect = await selectProjectByTitle(page, "The Domain Tower B");
    ev(`select demo: ${J(demoSelect)}`);
    await delay(2500);
    const tabs = [
      ["packages", "CSI Scoping"],
      ["discovery", "Discovery"],
      ["qna", "Pre-Bid Q&A"],
      ["leveling", "Bid Leveling"],
      ["coordination", "Scope Clash"],
      ["contracts", "Subcontracts"],
      ["audit", "Live Activity Audit"],
      ["diagnostics", "Evals & Architecture"],
    ];
    for (const [id, label] of tabs) {
      const before = snapDiag();
      const clicked = await clickButtonByText(page, label);
      await delay(1800);
      const d = deltaDiag(before);
      const bt = await bodyText(page);
      const hasServerErr = /Server Error|Something went wrong|An error occurred/i.test(bt);
      ev(`TAB ${id} (${label}) clicked=${J(clicked)} :: ${diagLine(d)} :: serverErrorText=${hasServerErr}`);
      await shot(page, `remediation-qa6-tab-${id}.png`);
    }
    await clickButtonByText(page, "CSI Scoping");
    await delay(1200);

    // Download precedence check on seeded spec: capture response size for /specs/ link target
    ev("");
    ev("[P1b] seeded-file download precedence check (network)");
    const dlProbe = await page.evaluate(async () => {
      const res = await fetch("/specs/26_00_00_Electrical_Systems_Spec.pdf");
      const buf = await res.arrayBuffer();
      return { status: res.status, bytes: buf.byteLength, type: res.headers.get("content-type") };
    });
    ev(`/specs/26_00_00... fetched by app origin -> ${J(dlProbe)} (UI download link uses file.url = /specs/...)`);

    // ---- Phase 2: project-create bad-input fuzzing ----
    ev("");
    ev("[P2] project create bad-input fuzzing");
    const openModal = await clickButtonByText(page, "New Project");
    await page.waitForSelector('[aria-labelledby="new-project-title"]', { timeout: 10000 });
    ev(`open modal: ${J(openModal)}`);

    const cases = [
      {
        name: "empty-title",
        title: "",
        budget: "2500000",
        weeks: "52",
        note: "native required blocks submit",
      },
      {
        name: "whitespace-title",
        title: "   ",
        budget: "2500000",
        weeks: "52",
        note: "client-side validation expected",
      },
      {
        name: "10000-char-title",
        title: "Q".repeat(10000),
        budget: "2500000",
        weeks: "52",
        note: "server-side 500-char validation expected (ConvexError)",
      },
      { name: "budget-0", title: "QA-REM-qa6-budget-zero", budget: "0", weeks: "52", note: "client-side validation" },
      { name: "budget-negative", title: "QA-REM-qa6-budget-neg", budget: "-1", weeks: "52", note: "client-side validation" },
      { name: "budget-1e15", title: "QA-REM-qa6-budget-1e15", budget: "1000000000000000", weeks: "52", note: "server-side max validation" },
      { name: "weeks-0", title: "QA-REM-qa6-weeks-zero", budget: "2500000", weeks: "0", note: "client-side validation" },
      { name: "weeks-99999", title: "QA-REM-qa6-weeks-99999", budget: "2500000", weeks: "99999", note: "client-side validation" },
    ];

    for (const c of cases) {
      const before = snapDiag();
      await fillFieldByLabel(page, "Project Title", "Project Title", c.title).catch(() => {});
      await fillFieldByLabel(page, "Project Title", "Estimated Budget ($)", c.budget).catch(() => {});
      await fillFieldByLabel(page, "Project Title", "Duration (Weeks)", c.weeks).catch(() => {});
      const state1 = await checkFormState(page, "Project Title");
      let submit;
      try {
        submit = await clickExactButton(page, "Create Commercial Project");
      } catch (e) {
        submit = { ok: false, reason: String(e && e.message) };
      }
      // If native constraint validation blocked the click, force form.requestSubmit() to reach client handler
      const blockedNatively = submit && submit.ok && state1 && !state1.formValid;
      if (blockedNatively) {
        await page.evaluate(() => {
          const form = [...document.querySelectorAll("form")].find((f) =>
            (f.textContent || "").includes("Project Title")
          );
          if (form) form.requestSubmit();
        });
      }
      await delay(1600);
      const err = await readFormError(page, "Project Title");
      const modalStillOpen = await page.evaluate(() =>
        Boolean(document.querySelector('[aria-labelledby="new-project-title"]'))
      );
      const state2 = await checkFormState(page, "Project Title");
      const d = deltaDiag(before);
      ev(
        `CASE project ${c.name} :: formValid=${state1 ? state1.formValid : "?"} submitDisabled=${
          state1 ? state1.submitDisabled : "?"
        } nativeBlocked=${Boolean(blockedNatively)} error="${err}" modalOpen=${modalStillOpen} :: ${diagLine(d)}`
      );
      if (state2) {
        const longField = state2.fields.find((f) => f.value.length > 100);
        if (longField) ev(`      long field len=${longField.value.length} (truncated in UI print)`);
      }
      await shot(page, `remediation-qa6-fuzz-project-${c.name}.png`);
      // reset title to safe value before next case
      await fillFieldByLabel(page, "Project Title", "Project Title", "QA-REM-qa6-reset").catch(() => {});
    }

    // valid project creation (also verifies F1 durability path)
    ev("");
    ev("[P2b] valid project create -> selector appearance");
    const ts = Date.now();
    const qaTitle = `QA-REM-qa6-ux-${ts}`;
    CASE.qaTitle = qaTitle;
    await fillFieldByLabel(page, "Project Title", "Project Title", qaTitle);
    await fillFieldByLabel(page, "Project Title", "Estimated Budget ($)", "2500000");
    await fillFieldByLabel(page, "Project Title", "Duration (Weeks)", "52");
    const beforeCreate = snapDiag();
    await clickExactButton(page, "Create Commercial Project");
    await delay(3000);
    const selAfter = await getSelectorState(page);
    const created = selAfter.options.find((o) => o.text.includes(qaTitle));
    CASE.qaId = created ? created.value : null;
    ev(
      `created=${J({ id: CASE.qaId, title: created ? created.text : null })} selectedNow=${J(
        selAfter.selectedText
      )} :: ${diagLine(deltaDiag(beforeCreate))}`
    );
    await shot(page, "remediation-qa6-02-project-created.png");

    // ---- Phase 3: package create bad-input fuzzing on QA project ----
    ev("");
    ev("[P3] package create fuzzing on QA project");
    // ensure QA project selected
    if (CASE.qaId) {
      await page.evaluate((id) => {
        const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
        sel.value = id;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }, CASE.qaId);
      await delay(1500);
    }
    await clickButtonByText(page, "CSI Scoping");
    await delay(1200);

    const pkgCases = [
      { name: "csi-26", csi: "26", patternRemoved: true, budget: "1000000", name2: "QA6 invalid csi 26", deadline: "2026-12-31" },
      { name: "csi-AB-CD-EF", csi: "AB CD EF", patternRemoved: true, budget: "1000000", name2: "QA6 invalid csi letters", deadline: "2026-12-31" },
      { name: "csi-99-99-99", csi: "99 99 99", patternRemoved: false, budget: "1000000", name2: "QA-REM-qa6-div99", deadline: "2026-12-31" },
      { name: "past-deadline", csi: "26 00 00", patternRemoved: false, budget: "1000000", name2: "QA6 past deadline", deadline: "2020-01-01", removeMin: true },
    ];
    for (const c of pkgCases) {
      const before = snapDiag();
      const open = await clickExactButton(page, "Create Trade Package");
      await delay(700);
      if (c.patternRemoved) {
        await page.evaluate(() => {
          const input = [...document.querySelectorAll('input[placeholder="e.g. 26 00 00"]')][0];
          if (input) input.removeAttribute("pattern");
        });
      }
      if (c.removeMin) {
        await page.evaluate(() => {
          const input = [...document.querySelectorAll('input[type="date"]')][0];
          if (input) input.removeAttribute("min");
        });
      }
      await fillFieldByLabel(page, "CSI Division Number", "CSI Division Number", c.csi).catch(() => {});
      await fillFieldByLabel(page, "CSI Division Number", "Trade Package Name", c.name2).catch(() => {});
      await fillFieldByLabel(page, "CSI Division Number", "Budget Estimate ($)", c.budget).catch(() => {});
      await fillFieldByLabel(page, "CSI Division Number", "Scope Summary", "QA-6 fuzz scope").catch(() => {});
      await fillFieldByLabel(page, "CSI Division Number", "Bid Deadline", c.deadline).catch(() => {});
      const state1 = await checkFormState(page, "CSI Division Number");
      const submit = await clickExactButton(page, "Create Package");
      await delay(2200);
      const err = await readFormError(page, "CSI Division Number");
      const modalOpen = await page.evaluate(() =>
        [...document.querySelectorAll("form")].some((f) => (f.textContent || "").includes("CSI Division Number"))
      );
      const d = deltaDiag(before);
      const csiField = state1 ? state1.fields.find((f) => f.patternMismatch !== undefined) : null;
      ev(
        `CASE package ${c.name} :: csi="${c.csi}" formValid=${state1 ? state1.formValid : "?"} patternMismatch=${
          csiField ? csiField.patternMismatch : "?"
        } submit=${J({ ok: submit.ok, disabled: submit.disabled })} error="${err}" modalStillOpen=${modalOpen} :: ${diagLine(d)}`
      );
      await shot(page, `remediation-qa6-fuzz-package-${c.name}.png`);
      // close modal if still open
      if (modalOpen) {
        await clickExactButton(page, "Cancel").catch(() => {});
        await delay(500);
      }
    }

    // ---- Phase 4: RFI fuzzing ----
    ev("");
    ev("[P4] RFI submit fuzzing on QA project");
    await clickButtonByText(page, "Pre-Bid Q&A");
    await delay(1500);
    const rfiEmpty = await checkFormState(page, "Subject / Scope Topic");
    ev(`CASE rfi empty :: formValid=${rfiEmpty ? rfiEmpty.formValid : "?"} submitDisabled=${rfiEmpty ? rfiEmpty.submitDisabled : "?"} label=${rfiEmpty ? rfiEmpty.submitLabel : "?"}`);
    await shot(page, "remediation-qa6-fuzz-rfi-empty.png");

    const subject = "QA-6 10k character fuzz";
    const question = "Q".repeat(10000);
    const beforeRfi = snapDiag();
    await fillFieldByLabel(page, "Subject / Scope Topic", "Subject / Scope Topic", subject).catch(() => {});
    await fillFieldByLabel(page, "Subject / Scope Topic", "Subcontractor Question", question).catch(() => {});
    const rfiFilled = await checkFormState(page, "Subject / Scope Topic");
    const tRfi = Date.now();
    await clickExactButton(page, "Submit RFI for Clarification");
    let rfiDone = false;
    let rfiLabel = null;
    for (let i = 0; i < 40; i++) {
      await delay(3000);
      const st = await checkFormState(page, "Subject / Scope Topic");
      rfiLabel = st ? st.submitLabel : null;
      if (rfiLabel && !/Analyzing/i.test(rfiLabel)) {
        rfiDone = true;
        break;
      }
    }
    const rfiMs = Date.now() - tRfi;
    const rfiText = await bodyText(page);
    const rfiResult = /escalated|clarified|processed|RFI/i.test(rfiText);
    ev(
      `CASE rfi 10000-char :: filledLen=${J(question.length)} submitState=${J(rfiFilled && rfiFilled.submitDisabled)} completed=${rfiDone} elapsedMs=${rfiMs} finalLabel=${J(rfiLabel)} :: ${diagLine(
        deltaDiag(beforeRfi)
      )}`
    );
    await shot(page, "remediation-qa6-fuzz-rfi-10k.png");

    // ---- Phase 5: quote ingest fuzzing ----
    ev("");
    ev("[P5] inbound quote fuzzing on QA project (one LLM action per case)");
    await clickButtonByText(page, "Bid Leveling");
    await delay(2000);
    const quoteCases = [
      { name: "absurd-low-1usd", amount: "$1", text: "Subcontractor: QA6 Lowball LLC\nBase Bid: $1 lump sum for complete Division 26 electrical scope. All inclusions covered." },
      { name: "absurd-high-999m", amount: "$999,999,999", text: "Subcontractor: QA6 Highball LLC\nBase Bid: $999,999,999 lump sum for complete Division 26 electrical scope." },
      { name: "negative-50000", amount: "-$50,000", text: "Subcontractor: QA6 Negative LLC\nBase Bid: -$50,000 lump sum for complete Division 26 electrical scope." },
    ];
    for (const q of quoteCases) {
      const before = snapDiag();
      const open = await clickExactButton(page, "Ingest Quote / PDF");
      const open2 = open.ok ? open : await clickExactButton(page, "Ingest Direct Quote / PDF");
      await delay(900);
      // contractor selector / new contractor name
      await page.evaluate(() => {
        const forms = [...document.querySelectorAll("form")];
        const form = forms.find((f) => (f.textContent || "").includes("Extract & Level Bid"));
        if (!form) return;
        const sel = form.querySelector("select");
        if (sel) {
          const opt = [...sel.options].find((o) => /new|enter/i.test(o.textContent)) || [...sel.options][0];
          if (opt) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      });
      await delay(400);
      await fillFieldByLabel(page, "Extract & Level Bid", "Document / Proposal Filename (PDF)", `QA6_${q.name}.pdf`).catch(() => {});
      await fillFieldByLabel(page, "Extract & Level Bid", "Proposal OCR Text / Paste Direct Quote", q.text).catch(() => {});
      const nameInput = await page.evaluate(() => {
        const el = [...document.querySelectorAll("input")].find((i) =>
          (i.placeholder || "").includes("Subcontractor Company Name")
        );
        if (!el) return null;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(el, "QA6 Fuzz Bidder " + Date.now());
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return el.value;
      });
      const filled = await checkFormState(page, "Extract & Level Bid");
      const tQ = Date.now();
      await clickExactButton(page, "Extract & Level Bid");
      let qDone = false;
      let qLabel = null;
      for (let i = 0; i < 40; i++) {
        await delay(3000);
        const st = await checkFormState(page, "Extract & Level Bid");
        if (!st) {
          qDone = true; // modal closed -> success/failure done
          break;
        }
        qLabel = st.submitLabel;
        if (qLabel && !/Extracting/i.test(qLabel)) {
          qDone = true;
          break;
        }
      }
      const err = await readFormError(page, "Extract & Level Bid");
      const modalOpen = await page.evaluate(() =>
        [...document.querySelectorAll("form")].some((f) => (f.textContent || "").includes("Extract & Level Bid"))
      );
      const bt = await bodyText(page);
      const toast = (bt.match(/[^\n]*(?:toast|leveled|failed|success)[^\n]*/i) || [null])[0];
      ev(
        `CASE quote ${q.name} (${q.amount}) :: nameInput=${J(nameInput)} filled=${J(
          filled && filled.fields.map((f) => f.value.slice(0, 30))
        )} completed=${qDone} elapsedMs=${Date.now() - tQ} modalOpen=${modalOpen} error="${err}" toastâ‰ˆ${J(toast)} :: ${diagLine(
          deltaDiag(before)
        )}`
      );
      await shot(page, `remediation-qa6-fuzz-quote-${q.name}.png`);
      if (modalOpen) {
        await clickExactButton(page, "Cancel").catch(() => {});
        await delay(600);
      }
    }

    // ---- Phase 6: deep links / bad URL ids ----
    ev("");
    ev("[P6] deep link / URL id behavior");
    const urls = [
      { name: "query-bad-id", url: `${BASE_URL}/?project=jx70000000000000000000000000000000` },
      { name: "query-mock-id", url: `${BASE_URL}/?project=proj_domain_tower` },
      { name: "query-project-param", url: CASE.qaId ? `${BASE_URL}/?project=${CASE.qaId}` : `${BASE_URL}/?project=x` },
      { name: "path-deep-route", url: `${BASE_URL}/project/does-not-exist-qa6` },
      { name: "path-bid-route", url: `${BASE_URL}/bid/does-not-exist-qa6` },
    ];
    for (const u of urls) {
      const before = snapDiag();
      await page.goto(u.url, { waitUntil: "domcontentloaded" });
      await waitForAppReady(page);
      await delay(2000);
      const sel = await getSelectorState(page);
      const bt = await bodyText(page);
      const hasErr = /Server Error|Something went wrong|not found/i.test(bt);
      ev(
        `URL ${u.name} -> selected="${sel.selectedText}" urlErrorText=${hasErr} :: ${diagLine(deltaDiag(before))}`
      );
    }
    await shot(page, "remediation-qa6-03-deep-link-result.png");

    // ---- Phase 7: mobile 375x812 ----
    ev("");
    ev("[P7] mobile 375x812");
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await selectProjectByTitle(page, "The Domain Tower B");
    await delay(2500);
    const mobileMetrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const over = [...document.querySelectorAll("*")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > window.innerWidth + 1;
      });
      const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      const navButtons = [...document.querySelectorAll("header button")];
      return {
        innerWidth: window.innerWidth,
        scrollWidth: doc.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        overflowCount: over.length,
        overflowSample: over.slice(0, 8).map((el) => `${el.tagName}.${(el.className || "").toString().split(" ").slice(0, 2).join(".")}`),
        selectorRect: sel ? sel.getBoundingClientRect().toJSON() : null,
        visibleHeaderButtons: navButtons.filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.textContent.trim().slice(0, 40)),
        pipelineTabLabelsVisible: [...document.querySelectorAll("header button span")].filter(
          (s) => s.getBoundingClientRect().width > 0 && /CSI Scoping|Discovery|Pre-Bid|Bid Leveling|Scope Clash|Subcontracts/.test(s.textContent)
        ).length,
      };
    });
    ev(`mobile landing metrics: ${J(mobileMetrics, 1200)}`);
    await shot(page, "remediation-qa6-04-mobile-landing.png");
    clickButtonByText(page, "Bid Leveling");
    await delay(2000);
    const mobileLeveling = await page.evaluate(() => {
      const doc = document.documentElement;
      const over = [...document.querySelectorAll("*")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > window.innerWidth + 1;
      });
      const table = document.querySelector("table");
      return {
        scrollWidth: doc.scrollWidth,
        overflowCount: over.length,
        overflowSample: over.slice(0, 8).map((el) => `${el.tagName}.${(el.className || "").toString().split(" ").slice(0, 2).join(".")}`),
        hasTable: Boolean(table),
        tableVisible: table ? table.getBoundingClientRect().width > 0 : false,
        cardLike: [...document.querySelectorAll("div")].filter((d) =>
          /bid/i.test(d.className) && d.getBoundingClientRect().width > 300
        ).length,
      };
    });
    ev(`mobile leveling metrics: ${J(mobileLeveling, 900)}`);
    await shot(page, "remediation-qa6-05-mobile-leveling.png");

    // mobile nav usability: can tabs be reached/clicked?
    const mobileTabClick = await clickButtonByText(page, "CSI Scoping");
    const mobileTabState = await getSelectorState(page);
    ev(`mobile tab click CSI Scoping: ${J(mobileTabClick)} selectorStill=${J(mobileTabState.selectedText)}`);
    await shot(page, "remediation-qa6-06-mobile-csi.png");

    // ---- Phase 8: fresh-project UX ----
    ev("");
    ev("[P8] fresh QA project UX");
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(1500);
    if (CASE.qaId) {
      await page.evaluate((id) => {
        const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
        sel.value = id;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }, CASE.qaId);
      await delay(2200);
    }
    const ux = {};
    for (const [tab, label] of tabs) {
      await clickButtonByText(page, label);
      await delay(1400);
      const bt = await bodyText(page);
      const lines = bt.split("\n").map((s) => s.trim()).filter(Boolean);
      const idx = lines.findIndex((l) => l.includes(label) || l.includes("No "));
      ux[tab] = lines.slice(Math.max(0, idx - 2), idx + 8).join(" | ").slice(0, 420);
      await shot(page, `remediation-qa6-ux-empty-${tab}.png`);
    }
    for (const [k, v] of Object.entries(ux)) ev(`UX empty ${k}: ${v}`);
    // role confusion check: does any visible copy imply subcontractor vs GC identity ambiguity?
    const roleCopy = await page.evaluate(() => document.body.innerText.match(/[^\n]*(?:General Contractor|Subcontractor|as a GC|bidder)[^\n]*/gi)?.slice(0, 10));
    ev(`UX role copy sample: ${J(roleCopy)}`);
    await shot(page, "remediation-qa6-07-ux-fresh-project.png");

    ev("");
    ev("=== DATASET ===");
    ev(`Created QA project: ${CASE.qaTitle} (${CASE.qaId})`);
    ev(`httpError events total: ${httpErrors.length}`);
    ev(`console events total: ${diag.consoleLogs.length}; pageErrors=${diag.pageErrors.length}; failedRequests=${diag.failedRequests.length}`);
    ev("NOTE: seeded demo project was only read/selected, never mutated or deleted.");
  } finally {
    const dest = writeLog("remediation-qa6-browser-probe.txt", LOG);
    console.log(`Wrote ${dest}`);
    await browser.close();
  }
}

run().catch((e) => {
  console.error("PROBE FAILED:", e);
  LOG.push("PROBE FAILED: " + (e && e.stack ? e.stack : String(e)));
  writeLog("remediation-qa6-browser-probe.txt", LOG);
  process.exit(1);
});