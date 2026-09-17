import fs from "node:fs";
import path from "node:path";
import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, selectProjectByTitle, delay,
} from "./lib.mjs";

const EV = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/evidence";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const out = { startedAt: new Date().toISOString() };

  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await selectProjectByTitle(page, "AUDIT-REMED");
    await delay(1500);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").includes("Dismiss"));
      b?.click();
    });
    await delay(400);

    // ---------- Upload with select set to "spec"
    const normalPath = path.join(EV, "fix-upload-normal.txt");
    const selectState = await page.evaluate(() => {
      const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "spec"));
      if (!sel) return { found: false };
      sel.value = "spec";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return { found: true, value: sel.value };
    });
    out.uploadSelect = selectState;
    await delay(500);
    const input = await page.$("input#convex-file-upload");
    await input.uploadFile(normalPath);
    const poll = [];
    for (let i = 0; i < 20; i++) {
      await delay(1000);
      const s = await page.evaluate(() => {
        const t = document.body.innerText;
        return {
          counter: (t.match(/Project Documents in Convex Storage \((\d+)\)/) || [])[1],
          status: (t.match(/Uploading[^\n]*|Upload failed[^\n]*|Successfully uploaded[^\n]*/) || [])[0] || null,
          hasRow: t.includes("fix-upload-normal.txt"),
        };
      });
      poll.push({ t: i + 1, ...s });
      if (s.counter !== "0") break;
    }
    out["BUG-13-spec"] = { poll };

    // ---------- RFI submit with placeholders
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Pre-Bid Q&A"))?.click());
    await delay(1200);
    const subject = await page.$('input[placeholder*="Hoisting responsibility"]');
    const question = await page.$('textarea[placeholder*="scope coordination question"]');
    out.rfiFields = { subject: !!subject, question: !!question };
    if (subject && question) {
      await subject.click({ clickCount: 3 });
      await page.keyboard.type("AUDIT: Crane hoisting responsibility?");
      await question.click({ clickCount: 3 });
      await page.keyboard.type("AUDIT TEST: Please clarify whether crane hoisting and rigging to the penthouse is in the base bid or excluded.");
      await delay(600);
      const disabled = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Submit RFI"));
        return b ? b.disabled : null;
      });
      out["rfi-disabled-before-click"] = disabled;
      const t0 = Date.now();
      if (!disabled) await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Submit RFI"))?.click());
      const timeline = [];
      for (let i = 0; i < 30; i++) {
        await delay(1000);
        const s = await page.evaluate(() => {
          const t = document.body.innerText;
          return {
            count: (t.match(/All RFIs \((\d+)\)/) || [])[1],
            button: ([...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Analyzing") || (b.textContent || "").includes("Submit RFI")) || {}).textContent || null,
            formFilled: (() => { const q = document.querySelector('textarea[placeholder*="scope coordination"]'); return q ? q.value.length : null; })(),
          };
        });
        timeline.push({ t: Math.round((Date.now() - t0) / 1000), ...s });
        if (s.count && Number(s.count) > 0) break;
      }
      out["BUG-08"] = { timeline };
      out["BUG-09"] = await page.evaluate(() => {
        const t = document.body.innerText;
        return { hasTripleHash: /\n###\s|\n####\s/.test(t), hasBoldAsterisks: /\*\*[A-Za-z]/.test(t), sample: (t.match(/\*\*[^\n*]{0,70}\*\*/g) || []).slice(0, 6) };
      });
      out["BUG-10"] = await page.evaluate(() => ({ times: (document.body.innerText.match(/\b\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)\b/g) || []).slice(0, 12) }));
      // PM approve for addendum
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Approve for Addendum");
        b?.click();
      });
      await delay(2500);
    }
    await shot(page, "fix-BUG08-rfi-2.png", { full: true });

    out.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 10), pageErrors: diag.pageErrors, failedRequests: diag.failedRequests.slice(0, 10) };
    writeJson("fix-verify-fixture-5.json", out);
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
    writeJson("fix-verify-fixture-5.json", out);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(out, null, 2).slice(0, 12000));
};

run();