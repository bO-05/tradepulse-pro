// QA-6 phase-3 probe: negative quote observation, deep links (fresh pages), mobile, empty-state UX.
// Usage: node scripts/qa-rem/qa6c-remaining.mjs
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
const J = (o, max = 600) => {
  const s = JSON.stringify(o);
  return s.length > max ? s.slice(0, max) + "…" : s;
};
const QA_PROJECT_ID = "jx76zg0y52h5akc52gq4wwx0z58ehxvy";
const QA_PACKAGE_ID = "k178m859p5zhg6h6vaebh80qms8eh129";
const safeShot = async (page, name) => {
  try {
    return await shot(page, name);
  } catch (e) {
    ev(`shot FAILED ${name}: ${e.message}`);
    return null;
  }
};

async function bidsFor(pkgId) {
  const bids = await client.query("bids:listByPackage", { tradePackageId: pkgId });
  return bids.map((b) => ({ sub: b.subcontractorName, base: b.baseBidAmount, leveled: b.leveledTotalCost }));
}

async function run() {
  const { browser } = await launchBrowser();
  try {
    ev("=== QA-6c REMAINING PHASES ===");
    ev(`UTC: ${new Date().toISOString()}`);

    // ---------- A. selector inventory + negative quote ----------
    {
      const page = await browser.newPage();
      const diag = attachDiagnostics(page);
      await page.goto(BASE_URL, { waitUntil: "load", timeout: 60000 });
      await waitForAppReady(page);
      await delay(2000);
      const sel = await getSelectorState(page);
      ev("");
      ev("[A] project selector inventory on fresh visit");
      ev(`total options=${sel.options.length}`);
      ev(`default selected="${sel.selectedText}"`);
      const qaOpts = sel.options.filter((o) => /^QA-REM-/.test(o.text));
      ev(`QA-REM options=${qaOpts.length}`);
      const longest = qaOpts.reduce((a, b) => (b.text.length > a.text.length ? b : a), { text: "" });
      ev(`longest QA-REM option length=${longest.text.length} sample="${longest.text.slice(0, 80)}..."`);
      const tourOpen = await page.evaluate(() => document.body.innerText.includes("Scene 01/06") || document.body.innerText.includes("Scene 0"));
      ev(`demo tour visible by default: ${tourOpen} (App.tsx:140 useState(true))`);

      // negative quote on QA package
      await page.evaluate((id) => {
        const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
        const opt = [...s.options].find((o) => o.value === id);
        if (opt) {
          s.value = id;
          s.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, QA_PROJECT_ID);
      await delay(2500);
      await clickButtonByText(page, "Bid Leveling");
      await delay(2000);
      const beforeBids = await bidsFor(QA_PACKAGE_ID);
      ev("");
      ev(`[A2] negative quote case; bids BEFORE=${J(beforeBids)}`);
      let open = await clickButtonByText(page, "Ingest Quote / PDF");
      await delay(1200);
      let isOpen = await page.evaluate(() =>
        [...document.querySelectorAll("form")].some((f) => (f.textContent || "").includes("Extract & Level Bid"))
      );
      if (!isOpen) {
        await clickButtonByText(page, "Ingest Direct Quote / PDF");
        await delay(1200);
        isOpen = await page.evaluate(() =>
          [...document.querySelectorAll("form")].some((f) => (f.textContent || "").includes("Extract & Level Bid"))
        );
      }
      ev(`open=${J(open)} modalOpen=${isOpen}`);
      if (isOpen) {
        await page.evaluate(() => {
          const form = [...document.querySelectorAll("form")].find((f) => (f.textContent || "").includes("Extract & Level Bid"));
          const s = form.querySelector("select");
          if (s) {
            s.value = "new_contractor";
            s.dispatchEvent(new Event("change", { bubbles: true }));
          }
          const input = [...document.querySelectorAll("input")].find((i) => (i.placeholder || "").includes("Subcontractor Company Name"));
          if (input) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "QA6c Negative Probe " + Date.now());
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
        await delay(300);
        await page.evaluate(() => {
          const form = [...document.querySelectorAll("form")].find((f) => (f.textContent || "").includes("Extract & Level Bid"));
          const lab = [...form.querySelectorAll("label")].find((l) => l.textContent.trim() === "Proposal OCR Text / Paste Direct Quote");
          const el = lab.parentElement.querySelector("textarea");
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(
            el,
            "Subcontractor: QA6c Negative LLC\nBase Bid: -$50,000 lump sum for complete Division 26 electrical scope."
          );
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await delay(500);
        const t0 = Date.now();
        await page.evaluate(() => {
          const form = [...document.querySelectorAll("form")].find((f) => (f.textContent || "").includes("Extract & Level Bid"));
          form.querySelector('button[type="submit"]').click();
        });
        let sawToast = null;
        let sawError = null;
        let closedAt = null;
        for (let i = 0; i < 100; i++) {
          await delay(700);
          const st = await page.evaluate(() => {
            const form = [...document.querySelectorAll("form")].find((f) => (f.textContent || "").includes("Extract & Level Bid"));
            const err = form ? (form.querySelector('div[role="alert"]')?.textContent.trim() || null) : null;
            const all = [...document.querySelectorAll("div")];
            const toastEl = all.find((d) =>
              /^(Quote ingested|Ingestion failed)/.test((d.textContent || "").trim()) &&
              d.children.length <= 2
            );
            return { open: Boolean(form), err, toast: toastEl ? toastEl.textContent.trim() : null };
          });
          if (st.toast && !sawToast) sawToast = { at: Date.now() - t0, text: st.toast.slice(0, 200) };
          if (st.err && !sawError) sawError = { at: Date.now() - t0, text: st.err.slice(0, 200) };
          if (!st.open && closedAt === null) closedAt = Date.now() - t0;
          if (sawToast || sawError) break;
        }
        ev(`negative result: closedAt=${closedAt}ms error=${J(sawError)} toast=${J(sawToast)}`);
        const consoleErr = diag.consoleLogs.filter((l) => l.type === "error").slice(-3).map((l) => l.text.split("\n")[0]);
        ev(`negative consoleErrors=${J(consoleErr)}`);
        const ls = await page.evaluate(() => {
          const keys = Object.keys(localStorage);
          const store = localStorage.getItem("tradepulse_standalone_v3") || "";
          return { keys, storeLen: store.length, hasNegativeName: /QA6c Negative Probe|QA6b Fuzz negative/.test(store) };
        });
        ev(`localStorage: ${J(ls)}`);
        await safeShot(page, "remediation-qa6c-negative-quote.png");
      }
      const afterBids = await bidsFor(QA_PACKAGE_ID);
      ev(`bids AFTER negative=${J(afterBids)}`);
      await page.close();
    }

    // ---------- B. deep links (fresh page each) ----------
    ev("");
    ev("[B] deep links / bad ids (fresh page per URL)");
    const urls = [
      ["query-bad-id", `${BASE_URL}/?project=jx70000000000000000000000000000000`],
      ["query-mock-id", `${BASE_URL}/?project=proj_domain_tower`],
      ["query-real-qa-id", `${BASE_URL}/?project=${QA_PROJECT_ID}`],
      ["path-project", `${BASE_URL}/project/does-not-exist-qa6`],
      ["path-bid", `${BASE_URL}/bid/does-not-exist-qa6`],
    ];
    for (const [nm, u] of urls) {
      const page = await browser.newPage();
      const diag = attachDiagnostics(page);
      try {
        await page.goto(u, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector('select[aria-label="Select Commercial Construction Project"]', { timeout: 30000 });
        await delay(2200);
        const sel = await getSelectorState(page);
        const bt = await bodyText(page);
        const has404 = /not found|does not exist/i.test(bt);
        ev(
          `URL ${nm}: selected="${sel.selectedText}" visible404=${has404} consoleErrors=${
            diag.consoleLogs.filter((l) => l.type === "error").length
          } pageErrors=${diag.pageErrors.length}`
        );
      } catch (e) {
        ev(`URL ${nm}: NAV FAILED: ${e.message}`);
      }
      await page.close().catch(() => {});
    }

    // ---------- C. mobile ----------
    ev("");
    ev("[C] mobile 375x812");
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      try {
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
            bodyScrollWidth: document.body.scrollWidth,
            overflowCount: over.length,
            overflowSample: over.slice(0, 6).map((el) => `${el.tagName}.${String(el.className).split(" ").slice(0, 2).join(".")}`),
            headerButtons: [...document.querySelectorAll("header button")].filter((b) => b.getBoundingClientRect().width > 0).length,
            pipelineTabLabelsVisible: [...document.querySelectorAll("header button span")].filter(
              (s) => s.getBoundingClientRect().width > 0 && /CSI Scoping|Discovery|Pre-Bid|Bid Leveling|Scope Clash|Subcontracts/.test(s.textContent)
            ).length,
          };
        });
        ev(`landing: ${J(mLanding, 1000)}`);
        await safeShot(page, "remediation-qa6c-mobile-landing.png");
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
            hScrollableBlocks: [...document.querySelectorAll("div")].filter((d) => d.scrollWidth > d.clientWidth + 5 && d.clientWidth > 250).length,
            bidCards: document.body.innerText.match(/Rank #\d/g)?.length || 0,
          };
        });
        ev(`leveling: ${J(mLevel, 1000)}`);
        await safeShot(page, "remediation-qa6c-mobile-leveling.png");
      } catch (e) {
        ev(`mobile phase error: ${e.message}`);
      }
      await page.close().catch(() => {});
    }

    // ---------- D. empty-state UX on QA project ----------
    ev("");
    ev("[D] empty-state UX on QA project (has 1 package + bids from fuzz)");
    {
      const page = await browser.newPage();
      await page.goto(BASE_URL, { waitUntil: "load", timeout: 60000 });
      await waitForAppReady(page);
      await page.evaluate((id) => {
        const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
        const opt = [...s.options].find((o) => o.value === id);
        if (opt) {
          s.value = id;
          s.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, QA_PROJECT_ID);
      await delay(2500);
      const labels = ["CSI Scoping", "Discovery", "Pre-Bid Q&A", "Bid Leveling", "Scope Clash", "Subcontracts", "Live Activity Audit", "Evals & Architecture"];
      for (const label of labels) {
        await clickButtonByText(page, label);
        await delay(1400);
        const bt = await bodyText(page);
        const lines = bt.split("\n").map((s) => s.trim()).filter(Boolean);
        const interesting = lines.filter((l) =>
          /^(No |Create |Run |Ingest |Dispatch |Add |Next|Start|Awaiting|Configure|0 )/i.test(l) ||
          /No .*(Packages|Contractors|RFIs|Bids|Clashes|Agreements|Events)|empty state/i.test(l)
        );
        ev(`UX[${label}]: ${J(interesting.slice(0, 10), 700)}`);
      }
      await safeShot(page, "remediation-qa6c-ux-empty.png");
      await page.close().catch(() => {});
    }

    ev("");
    ev("[DONE]");
  } finally {
    writeLog("remediation-qa6c-remaining.txt", LOG);
    await browser.close();
  }
}

run().catch((e) => {
  LOG.push("PROBE FAILED: " + (e && e.stack ? e.stack : String(e)));
  writeLog("remediation-qa6c-remaining.txt", LOG);
  console.error("PROBE FAILED:", e);
  process.exit(1);
});