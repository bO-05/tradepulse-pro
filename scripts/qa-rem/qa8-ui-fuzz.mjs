// QA-8 (round 3) UI fuzz: New Project bad inputs, non-creation proof, valid QA-REM create, empty-state shots.
// Usage: node scripts/qa-rem/qa8-ui-fuzz.mjs
import {
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  delay,
  BASE_URL,
  writeLog,
  getSelectorState,
  bodyText,
} from "./qa1-lib.mjs";
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";

const BACKEND = "https://brainy-skunk-440.convex.cloud";
const EVIDENCE_DIR =
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/evidence";
const backend = new ConvexHttpClient(BACKEND);

const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 500) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "…" : s;
};

const diag = {};
const httpErrors = [];
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
  if (d.console.length) parts.push(`console=${J(d.console, 300)}`);
  if (d.pageErrors.length) parts.push(`pageErrors=${J(d.pageErrors, 300)}`);
  if (d.failedReq.length) parts.push(`failedReq=${J(d.failedReq, 300)}`);
  if (d.httpErrors.length) parts.push(`httpErrors=${J(d.httpErrors.map((x) => `${x.method} ${x.status} ${x.url}`), 300)}`);
  return parts.length ? parts.join(" | ") : "clean";
}

async function fillFieldByLabel(page, label, value) {
  return page.evaluate(
    (label, value) => {
      const forms = [...document.querySelectorAll("form")];
      const form = forms.find((f) => (f.textContent || "").includes("Project Title"));
      if (!form) return { ok: false, reason: "create form not found" };
      const candidates = [...form.querySelectorAll("label")].filter((l) => l.textContent.trim() === label);
      if (!candidates.length) return { ok: false, reason: `label not found: ${label}` };
      const el = candidates[0].parentElement.querySelector("input, textarea, select") || candidates[0].nextElementSibling;
      if (!el) return { ok: false, reason: `input after label not found: ${label}` };
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
      return { ok: true, tag: el.tagName, value: String(el.value).slice(0, 80), valueLength: el.value.length };
    },
    label,
    value
  );
}

async function formState(page) {
  return page.evaluate(() => {
    const forms = [...document.querySelectorAll("form")];
    const form = forms.find((f) => (f.textContent || "").includes("Project Title"));
    if (!form) return null;
    const submit = form.querySelector('button[type="submit"]');
    const titleInput = [...form.querySelectorAll("label")]
      .find((l) => l.textContent.trim() === "Project Title")
      ?.parentElement.querySelector("input");
    return {
      formValid: form.checkValidity(),
      submitDisabled: submit ? submit.disabled : null,
      titleValidationMessage: titleInput ? titleInput.validationMessage : null,
      titleValid: titleInput ? titleInput.checkValidity() : null,
    };
  });
}

async function readFormError(page) {
  return page.evaluate(() => {
    const forms = [...document.querySelectorAll("form")];
    const form = forms.find((f) => (f.textContent || "").includes("Project Title"));
    if (!form) return null;
    const p = [...form.querySelectorAll('p,div[role="alert"]')].find((x) => /rose|red|error/i.test(x.className || ""));
    return p ? p.textContent.trim() : null;
  });
}

async function readToast(page) {
  return page.evaluate(() => {
    const spans = [...document.querySelectorAll("div,span,p")].filter(
      (el) => el.children.length === 0 && /fixed|z-50|toast/i.test(el.className || "")
    );
    const texts = spans.map((el) => (el.textContent || "").trim()).filter(Boolean);
    return texts.length ? texts.join(" | ").slice(0, 300) : null;
  });
}

async function clickExactButton(page, text) {
  return page.evaluate((t) => {
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((x) => (x.textContent || "").trim() === t);
    if (!b) return { ok: false, available: btns.map((x) => (x.textContent || "").trim()).filter(Boolean).slice(0, 80) };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, disabled: b.disabled, text: b.textContent.trim() };
  }, text);
}

async function dispatchSubmit(page) {
  return page.evaluate(() => {
    const forms = [...document.querySelectorAll("form")];
    const form = forms.find((f) => (f.textContent || "").includes("Project Title"));
    if (!form) return { ok: false, reason: "form not found" };
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    return { ok: true };
  });
}

async function isModalOpen(page) {
  return page.evaluate(() => Boolean(document.querySelector('[aria-labelledby="new-project-title"]')));
}

async function closeModal(page) {
  return page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Close new project dialog"]');
    if (!b) return false;
    b.click();
    return true;
  });
}

async function backendTitles(note) {
  const ps = await backend.query("projects:listProjects");
  ev(`${note} backend projects=${ps.length}: ${J(ps.map((p) => `${p.title}${p.isDemoProject ? " [DEMO]" : ""}`), 600)}`);
  return ps;
}

async function run() {
  const { browser } = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(25000);
    Object.assign(diag, attachDiagnostics(page));
    page.on("response", (r) => {
      if (r.status() >= 400) httpErrors.push({ status: r.status(), method: r.request().method(), url: r.url() });
    });

    ev("=== QA-8 UI FUZZ / NON-CREATION PROOF ===");
    ev(`Base URL: ${BASE_URL}`);
    ev(`UTC: ${new Date().toISOString()}`);
    ev("");

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await delay(1500);

    const before = await backendTitles("[pre-fuzz]");
    const baselineIds = new Set(before.map((p) => p._id));
    const sel0 = await getSelectorState(page);
    ev(`[pre-fuzz] selector options=${sel0.options.length}`);

    const base = {
      "Location": "QA8 Fuzz Lab",
      "Project Type": "Fuzz Harness",
      "General Contractor / Contracting Entity": "QA-REM QA8 (non-persistent test input)",
      "Estimated Budget ($)": "2500000",
      "Duration (Weeks)": "52",
      "Specification Summary": "",
    };

    const cases = [
      { name: "empty-title", title: "", budget: "2500000", weeks: "52", bypass: true, expect: "client: 'Project title is required.' after bypassed native required" },
      { name: "whitespace-title", title: "   ", budget: "2500000", weeks: "52", expect: "client: 'Project title is required.'" },
      { name: "10000-char-title", title: "QA-REM-QA8-fuzz-10k-" + "A".repeat(10000), budget: "2500000", weeks: "52", expect: "server: 500-char limit ConvexError" },
      { name: "budget-0", title: "QA-REM-QA8-fuzz-budget-0", budget: "0", weeks: "52", expect: "client: budget > $0" },
      { name: "budget-1e15", title: "QA-REM-QA8-fuzz-budget-1e15", budget: "1000000000000000", weeks: "52", expect: "server: max $1,000,000,000 ConvexError" },
      { name: "weeks-0", title: "QA-REM-QA8-fuzz-weeks-0", budget: "2500000", weeks: "0", expect: "client: 1-520 weeks" },
      { name: "weeks-99999", title: "QA-REM-QA8-fuzz-weeks-99999", budget: "2500000", weeks: "99999", expect: "client: 1-520 weeks" },
    ];

    let staleErrorCheck = null;

    for (const c of cases) {
      const b = snapDiag();
      const opened = await page.evaluate(() => {
        const btns = [...document.querySelectorAll("button")];
        const b2 = btns.find((x) => (x.textContent || "").trim().includes("New Project"));
        if (!b2) return false;
        b2.click();
        return true;
      });
      if (!opened) {
        ev(`CASE ${c.name} :: FAILED to open modal`);
        continue;
      }
      await page.waitForSelector('[aria-labelledby="new-project-title"]', { timeout: 10000 });
      for (const [label, value] of Object.entries(base)) await fillFieldByLabel(page, label, value);
      await fillFieldByLabel(page, "Project Title", c.title);
      await fillFieldByLabel(page, "Estimated Budget ($)", c.budget);
      await fillFieldByLabel(page, "Duration (Weeks)", c.weeks);

      const s1 = await formState(page);
      let submit = await clickExactButton(page, "Create Commercial Project");
      let bypassed = false;
      if (c.bypass && s1 && !s1.formValid) {
        await dispatchSubmit(page);
        bypassed = true;
      }
      await delay(2000);
      const err = await readFormError(page);
      const modalOpen = await isModalOpen(page);
      const s2 = await formState(page);
      const toast = await readToast(page);
      const d = deltaDiag(b);
      ev(
        `CASE ${c.name} :: expect=${c.expect}\n` +
          `  titleLen=${c.title.length} budget=${c.budget} weeks=${c.weeks} :: formValid(pre)=${s1 ? s1.formValid : "?"} titleMsg="${s1 ? s1.titleValidationMessage : "?"}"\n` +
          `  submit=${J({ ok: submit.ok, disabled: submit.disabled })} nativeBypassed=${bypassed} modalStillOpen=${modalOpen}\n` +
          `  createError="${err}" titleValid(post)=${s2 ? s2.titleValid : "?"} toast=${J(toast)}\n` +
          `  diag=${diagLine(d)}`
      );
      await shot(page, `remediation-qa8-fuzz-project-${c.name}.png`);

      if (c.name === "whitespace-title") {
        await closeModal(page);
        await delay(400);
        const reopenedOpen = await page.evaluate(() => {
          const btns = [...document.querySelectorAll("button")];
          const b2 = btns.find((x) => (x.textContent || "").trim().includes("New Project"));
          if (!b2) return false;
          b2.click();
          return true;
        });
        await delay(500);
        const staleErr = await readFormError(page);
        staleErrorCheck = { reopenedOpen, staleErr };
        ev(`CASE whitespace :: stale-error-after-close-reopen = ${J(staleErrorCheck)}`);
        await shot(page, "remediation-qa8-ux-stale-error-reopen.png");
      }

      if (await isModalOpen(page)) await closeModal(page);
      await delay(400);
    }

    ev("");
    const afterFuzz = await backendTitles("[post-fuzz]");
    const createdByFuzz = afterFuzz.filter((p) => !baselineIds.has(p._id));
    ev(
      `[post-fuzz] NON-CREATION PROOF :: new projects since baseline=${createdByFuzz.length} ${
        createdByFuzz.length ? J(createdByFuzz.map((p) => `${p._id} "${p.title}"`)) : "(none — all invalid cases blocked)"
      }`
    );
    const sel1 = await getSelectorState(page);
    ev(`[post-fuzz] selector options=${sel1.options.length} (was ${sel0.options.length})`);
    const selectorDeltas = sel1.options.filter((o) => !sel0.options.some((o0) => o0.value === o.value));
    ev(`[post-fuzz] selector new options=${J(selectorDeltas)}`);
    await shot(page, "remediation-qa8-fuzz-post-state.png");

    ev("");
    ev("[valid] create one QA-REM project");
    const qaTitle = `QA-REM-QA8-UX-${Date.now()}`;
    const bCreate = snapDiag();
    const openedAgain = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const b2 = btns.find((x) => (x.textContent || "").trim().includes("New Project"));
      if (!b2) return false;
      b2.click();
      return true;
    });
    await page.waitForSelector('[aria-labelledby="new-project-title"]', { timeout: 10000 });
    for (const [label, value] of Object.entries(base)) await fillFieldByLabel(page, label, value);
    await fillFieldByLabel(page, "Project Title", qaTitle);
    await fillFieldByLabel(page, "Estimated Budget ($)", "3000000");
    await fillFieldByLabel(page, "Duration (Weeks)", "40");
    await fillFieldByLabel(page, "Specification Summary", "QA-8 empty-state fixture. No trade packages by design.");
    await clickExactButton(page, "Create Commercial Project");
    await delay(3500);
    const selAfter = await getSelectorState(page);
    const createdOpt = selAfter.options.find((o) => o.text.includes(qaTitle));
    const modalAfterCreate = await isModalOpen(page);
    ev(
      `[valid] openedAgain=${openedAgain} modalStillOpen=${modalAfterCreate} created=${J({
        id: createdOpt ? createdOpt.value : null,
        text: createdOpt ? createdOpt.text : null,
      })} selectedNow=${J(selAfter.selectedText)} ${diagLine(deltaDiag(bCreate))}`
    );
    await shot(page, "remediation-qa8-valid-project-created.png");

    const afterCreate = await backendTitles("[post-create]");
    const createdNow = afterCreate.filter((p) => !baselineIds.has(p._id));
    ev(`[post-create] new projects=${createdNow.length} :: ${J(createdNow.map((p) => `${p._id} "${p.title}"`))}`);
    if (createdOpt) {
      fs.writeFileSync(
        path.join(EVIDENCE_DIR, "remediation-qa8-fixture.json"),
        JSON.stringify({ qaProjectId: createdOpt.value, qaProjectTitle: qaTitle, createdAt: new Date().toISOString() }, null, 2)
      );
    }

    // empty-state UX shots on the new (package-less) QA project
    ev("");
    ev("[empty-state] QA-REM project tabs");
    for (const label of ["CSI Scoping", "Discovery", "Bid Leveling", "Subcontracts", "Evals & Architecture"]) {
      await clickExactButton(page, label);
      await delay(1600);
      const bt = await bodyText(page);
      ev(`EMPTY TAB ${label} :: hasEmptyHint=${/no trade packages|no .* yet|empty|create.*package|get started/i.test(bt)} textSample=${J(bt.slice(0, 220))}`);
      await shot(page, `remediation-qa8-empty-${label.replace(/[^A-Za-z]/g, "").toLowerCase()}.png`);
    }

    ev("");
    ev(`[stale-error-reopen] ${J(staleErrorCheck)}`);
    const finalDiag = diagLine(deltaDiag({ console: 0, pageErrors: 0, failedReq: 0, httpErrors: 0 }));
    ev(`[final diag] ${finalDiag}`);

    const dest = writeLog("remediation-qa8-ui-fuzz.txt", LOG);
    console.log(`Wrote ${dest}`);
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});