// QA-6 focused follow-up: quote fuzz with ground-truth reads, deep links, mobile, empty-state UX.
// Usage: node scripts/qa-rem/qa6-followup.mjs
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
import { ConvexHttpClient } from "convex/browser";

const client = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const LOG = [];
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};
const J = (o, max = 500) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "…" : s;
};

const QA_PROJECT_ID = process.argv[2] || "jx76zg0y52h5akc52gq4wwx0z58ehxvy";
const QA_PACKAGE_ID = process.argv[3] || "k178m859p5zhg6h6vaebh80qms8eh129";

async function bidsFor(pkgId) {
  const bids = await client.query("bids:listByPackage", { tradePackageId: pkgId });
  return bids.map((b) => ({
    sub: b.subcontractorName,
    base: b.baseBidAmount,
    leveled: b.leveledTotalCost,
    lead: b.longLeadEquipmentWeeks,
  }));
}

async function modalOpen(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("form")].some((f) => (f.textContent || "").includes("Extract & Level Bid"))
  );
}
async function modalError(page) {
  return page.evaluate(() => {
    const forms = [...document.querySelectorAll("form")];
    const form = forms.find((f) => (f.textContent || "").includes("Extract & Level Bid"));
    if (!form) return null;
    const d = form.querySelector('div[role="alert"]');
    return d ? d.textContent.trim() : null;
  });
}
async function submitDisabled(page) {
  return page.evaluate(() => {
    const forms = [...document.querySelectorAll("form")];
    const form = forms.find((f) => (f.textContent || "").includes("Extract & Level Bid"));
    if (!form) return null;
    const b = form.querySelector('button[type="submit"]');
    return b ? { disabled: b.disabled, label: b.textContent.trim() } : null;
  });
}
async function toasts(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("div")]
      .map((d) => (d.textContent || "").trim())
      .filter((t) => /^(Quote ingested|Ingestion failed|Project .* created|Upload failed)/.test(t))
      .slice(0, 3)
  );
}

async function fillWithinForm(page, formText, label, value) {
  return page.evaluate(
    (formText, label, value) => {
      const form = [...document.querySelectorAll("form")].find((f) =>
        (f.textContent || "").includes(formText)
      );
      if (!form) return { ok: false, reason: "form missing" };
      const lab = [...form.querySelectorAll("label")].find((l) => l.textContent.trim() === label);
      if (!lab) return { ok: false, reason: "label missing " + label };
      const el = lab.parentElement.querySelector("input,textarea,select");
      if (!el) return { ok: false, reason: "field missing" };
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: el.value };
    },
    formText,
    label,
    value
  );
}

async function run() {
  const { browser } = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    const diag = attachDiagnostics(page);
    const httpErrors = [];
    page.on("response", (r) => {
      if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    });

    ev("=== QA-6 FOLLOW-UP PROBE ===");
    ev(`UTC: ${new Date().toISOString()} | QA project: ${QA_PROJECT_ID} | package: ${QA_PACKAGE_ID}`);
    ev(`bids BEFORE: ${J(await bidsFor(QA_PACKAGE_ID))}`);
    ev("");

    await page.goto(BASE_URL, { waitUntil: "load", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1500);
    // select QA project
    await page.evaluate((id) => {
      const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      const opt = [...sel.options].find((o) => o.value === id);
      if (opt) {
        sel.value = id;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, QA_PROJECT_ID);
    await delay(2500);
    ev(`selector now: ${J(await getSelectorState(page), 300)}`);
    await clickButtonByText(page, "Bid Leveling");
    await delay(2000);
    ev(`tab body snippet: ${J((await bodyText(page)).slice(0, 200))}`);
    await shot(page, "remediation-qa6b-00-leveling-qa-package.png");

    const quoteCases = [
      {
        name: "high-999m",
        text: "Subcontractor: QA6 Highball LLC\nBase Bid: $999,999,999 lump sum for complete Division 26 electrical scope.",
      },
      {
        name: "negative-50000",
        text: "Subcontractor: QA6 Negative LLC\nBase Bid: -$50,000 lump sum for complete Division 26 electrical scope.",
      },
      {
        name: "zero-0usd",
        text: "Subcontractor: QA6 Zero LLC\nBase Bid: $0 lump sum for complete Division 26 electrical scope.",
      },
    ];

    for (const c of quoteCases) {
      ev("");
      ev(`--- CASE ${c.name} ---`);
      const beforeCnt = diag.consoleLogs.length;
      // open modal (toolbar or empty-state button)
      let open = await clickButtonByText(page, "Ingest Quote / PDF");
      await delay(1200);
      let isOpen = await modalOpen(page);
      if (!isOpen) {
        open = await clickButtonByText(page, "Ingest Direct Quote / PDF");
        await delay(1200);
        isOpen = await modalOpen(page);
      }
      ev(`openModal click=${J(open)} modalOpen=${isOpen}`);
      if (!isOpen) {
        await shot(page, `remediation-qa6b-quote-${c.name}-NO-MODAL.png`);
        continue;
      }
      // select new_contractor and fill
      const selRes = await page.evaluate(() => {
        const form = [...document.querySelectorAll("form")].find((f) =>
          (f.textContent || "").includes("Extract & Level Bid")
        );
        const sel = form.querySelector("select");
        if (!sel) return "no-select";
        const opt = [...sel.options].find((o) => o.value === "new_contractor");
        if (opt) {
          sel.value = "new_contractor";
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          return "new_contractor";
        }
        return "options:" + [...sel.options].map((o) => o.value).join(",");
      });
      await delay(300);
      const name = `QA6b Fuzz ${c.name} ${Date.now()}`;
      await page.evaluate((n) => {
        const input = [...document.querySelectorAll("input")].find((i) =>
          (i.placeholder || "").includes("Subcontractor Company Name")
        );
        if (input) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, n);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, name);
      await fillWithinForm(page, "Extract & Level Bid", "Proposal OCR Text / Paste Direct Quote", c.text);
      await fillWithinForm(page, "Extract & Level Bid", "Document / Proposal Filename (PDF)", `QA6b_${c.name}.pdf`);
      await delay(500);
      const pre = await submitDisabled(page);
      ev(`select=${selRes} name="${name}" submitState=${J(pre)}`);
      await shot(page, `remediation-qa6b-quote-${c.name}-01-filled.png`);

      const t0 = Date.now();
      const clicked = await page.evaluate(() => {
        const form = [...document.querySelectorAll("form")].find((f) =>
          (f.textContent || "").includes("Extract & Level Bid")
        );
        if (!form) return { ok: false, reason: "form missing" };
        const b = form.querySelector('button[type="submit"]');
        if (!b) return { ok: false, reason: "submit missing" };
        b.click();
        return { ok: true, disabled: b.disabled };
      });
      ev(`submit click=${J(clicked)}`);
      let state = "unknown";
      for (let i = 0; i < 40; i++) {
        await delay(1500);
        const openNow = await modalOpen(page);
        const errNow = await modalError(page);
        const lbl = await submitDisabled(page);
        if (!openNow) {
          state = `modal-closed after ${Date.now() - t0}ms`;
          break;
        }
        if (errNow) {
          state = `error-visible after ${Date.now() - t0}ms: "${errNow}"`;
          break;
        }
        if (lbl && !/Extracting/i.test(lbl.label)) {
          state = `idle-modal after ${Date.now() - t0}ms label="${lbl.label}"`;
          break;
        }
      }
      await delay(800);
      const err = await modalError(page);
      const openNow = await modalOpen(page);
      const t = await toasts(page);
      const consoleDelta = diag.consoleLogs.slice(beforeCnt).filter((l) => l.type === "error").map((l) => l.text.split("\n")[0]);
      const bidsNow = await bidsFor(QA_PACKAGE_ID);
      ev(`RESULT ${c.name}: state=${state} modalOpen=${openNow} error="${err}" toast=${J(t)} consoleErrors=${J(consoleDelta)}`);
      ev(`bids AFTER ${c.name}: ${J(bidsNow)}`);
      await shot(page, `remediation-qa6b-quote-${c.name}-02-after.png`);
      if (openNow) {
        await clickButtonByText(page, "Cancel");
        await delay(800);
      }
    }

    // ---- deep links (robust) ----
    ev("");
    ev("[deep links]");
    const urls = [
      ["query-bad-id", `${BASE_URL}/?project=jx70000000000000000000000000000000`],
      ["query-mock-id", `${BASE_URL}/?project=proj_domain_tower`],
      ["query-real-qa-id", `${BASE_URL}/?project=${QA_PROJECT_ID}`],
      ["path-project", `${BASE_URL}/project/does-not-exist-qa6`],
      ["path-bid", `${BASE_URL}/bid/does-not-exist-qa6`],
    ];
    for (const [nm, u] of urls) {
      try {
        const before = diag.consoleLogs.length;
        await page.goto(u, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForSelector('select[aria-label="Select Commercial Construction Project"]', { timeout: 30000 });
        await delay(2000);
        const sel = await getSelectorState(page);
        const bt = await bodyText(page);
        const errText = /Server Error|Something went wrong/i.test(bt);
        ev(`URL ${nm} -> selected="${sel.selectedText}" errorText=${errText} consoleDelta=${diag.consoleLogs.length - before}`);
      } catch (e) {
        ev(`URL ${nm} -> NAV FAILED: ${e.message}`);
      }
    }
    await shot(page, "remediation-qa6b-03-deep-link.png");

    // ---- mobile ----
    ev("");
    ev("[mobile 375x812]");
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.goto(BASE_URL, { waitUntil: "load", timeout: 60000 });
    await waitForAppReady(page);
    await selectProjectByTitle(page, "The Domain Tower B");
    await delay(2500);
    const mLanding = await page.evaluate(() => {
      const over = [...document.querySelectorAll("*")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > window.innerWidth + 1;
      });
      return {
        innerWidth: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        overflowCount: over.length,
        overflowSample: over.slice(0, 6).map((el) => `${el.tagName}.${String(el.className).split(" ").slice(0, 2).join(".")}`),
        visiblePipelineTabs: [...document.querySelectorAll("header button")].filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && /CSI Scoping|Discovery|Pre-Bid|Bid Leveling|Scope Clash|Subcontracts|Live Activity|Evals/.test(b.textContent);
        }).length,
        utilityLabelsVisible: [...document.querySelectorAll("header button span")].filter(
          (s) => s.getBoundingClientRect().width > 0 && /Live Activity Audit|Evals & Architecture/.test(s.textContent)
        ).length,
      };
    });
    ev(`landing: ${J(mLanding, 900)}`);
    await shot(page, "remediation-qa6b-04-mobile-landing.png");
    await clickButtonByText(page, "Bid Leveling");
    await delay(2200);
    const mLevel = await page.evaluate(() => {
      const over = [...document.querySelectorAll("*")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > window.innerWidth + 1;
      });
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        overflowCount: over.length,
        overflowSample: over.slice(0, 6).map((el) => `${el.tagName}.${String(el.className).split(" ").slice(0, 2).join(".")}`),
        tablePresent: Boolean(document.querySelector("table")),
        hScrollContainers: [...document.querySelectorAll("div")].filter((d) => d.scrollWidth > d.clientWidth + 5 && d.clientWidth > 300).length,
      };
    });
    ev(`leveling: ${J(mLevel, 900)}`);
    await shot(page, "remediation-qa6b-05-mobile-leveling.png");

    // ---- empty-state UX on QA project ----
    ev("");
    ev("[UX empty-state QA project]");
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(BASE_URL, { waitUntil: "load", timeout: 60000 });
    await waitForAppReady(page);
    await page.evaluate((id) => {
      const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      const opt = [...sel.options].find((o) => o.value === id);
      if (opt) {
        sel.value = id;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, QA_PROJECT_ID);
    await delay(2500);
    const tabLabels = ["CSI Scoping", "Discovery", "Pre-Bid Q&A", "Bid Leveling", "Scope Clash", "Subcontracts", "Live Activity Audit", "Evals & Architecture"];
    for (const label of tabLabels) {
      await clickButtonByText(page, label);
      await delay(1500);
      const bt = await bodyText(page);
      const lines = bt.split("\n").map((s) => s.trim()).filter(Boolean);
      const interesting = lines.filter((l) =>
        /No |Create |Run |Ingest |Dispatch |Add |empty|Next|Start|Package|Contractor|Bid|RFI|Clash|Agreement/i.test(l)
      );
      ev(`UX[${label}]: ${J(interesting.slice(0, 12), 700)}`);
    }
    await shot(page, "remediation-qa6b-06-ux-empty.png");

    ev("");
    ev(`httpErrors>=400 total: ${httpErrors.length} ${J(httpErrors.slice(0, 10))}`);
    ev(`console errors total: ${diag.consoleLogs.filter((l) => l.type === "error").length}; pageErrors=${diag.pageErrors.length}; failedRequests=${diag.failedRequests.length}`);
    ev(`bids FINAL: ${J(await bidsFor(QA_PACKAGE_ID))}`);
    ev("NOTE: demo project only selected/read. QA-REM-qa6 project is QA-owned.");
  } finally {
    writeLog("remediation-qa6b-followup.txt", LOG);
    await browser.close();
  }
}

run().catch((e) => {
  LOG.push("PROBE FAILED: " + (e && e.stack ? e.stack : String(e)));
  writeLog("remediation-qa6b-followup.txt", LOG);
  console.error("PROBE FAILED:", e);
  process.exit(1);
});