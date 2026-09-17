import fs from "node:fs";
import path from "node:path";
import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, selectProjectByTitle, delay,
} from "./lib.mjs";

const EV = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/evidence";
const DL = path.join(EV, "downloads");
fs.mkdirSync(DL, { recursive: true });

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const out = { startedAt: new Date().toISOString(), checks: {} };
  const client = await page.target().createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL }).catch(() => {});

  const clickTabText = async (t) => {
    await page.evaluate((t) => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === t || (x.textContent || "").includes(t));
      b?.click();
    }, t);
    await delay(1000);
  };

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

    // ---------- Upload with polling
    const normalPath = path.join(EV, "fix-upload-normal.txt");
    fs.writeFileSync(normalPath, "AUDIT-UPLOAD-PROOF: uploaded by remediation harness 2026-09-17. line2.");
    const input = await page.$("input#convex-file-upload");
    out.inputFound = !!input;
    const counter0 = await page.evaluate(() => (document.body.innerText.match(/Project Documents in Convex Storage \((\d+)\)/) || [])[1]);
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
      if (s.counter !== counter0 || s.hasRow) break;
    }
    out["BUG-13"] = { counter0, poll };

    // ---------- Download the uploaded file and compare bytes
    const dl = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("fix-upload-normal.txt") && (d.innerText || "").includes("Download"));
      const row = rows[rows.length - 1];
      if (!row) return { ok: false };
      const btn = [...row.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Download"));
      btn?.click();
      return { ok: true, row: row.innerText.replace(/\n+/g, " | ").slice(0, 320) };
    });
    out["download-click"] = dl;
    await delay(4000);
    out["download-files"] = fs.existsSync(DL) ? fs.readdirSync(DL).map((f) => ({ f, size: fs.statSync(path.join(DL, f)).size })) : [];
    const uploaded = out["download-files"].find((f) => f.f.includes("fix-upload-normal"));
    if (uploaded) {
      const buf = fs.readFileSync(path.join(DL, uploaded.f));
      out["download-uploaded-content"] = buf.toString("utf8").slice(0, 200);
      out["download-uploaded-isTrueBytes"] = buf.toString("utf8").includes("AUDIT-UPLOAD-PROOF");
    }

    // ---------- Preview caption
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("fix-upload-normal.txt") && (d.innerText || "").includes("Preview"));
      const row = rows[rows.length - 1];
      row ? [...row.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Preview"))?.click() : null;
    });
    await delay(1200);
    out["BUG-14"] = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        caption: (t.match(/100% Real Construction Document Specification[^\n]*/) || [])[0] || null,
        bodyHasProof: t.includes("AUDIT-UPLOAD-PROOF"),
      };
    });
    await shot(page, "fix-BUG14-caption-2.png");
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Close");
      btn?.click();
    });
    await delay(500);

    // ---------- RFI submit via real typing
    await clickTabText("Pre-Bid Q&A");
    const ta = await page.$$("textarea");
    out.textareaCount = ta.length;
    const subjectInput = await page.$('input[placeholder*="Switchgear"]');
    const questionArea = await page.$('textarea[placeholder*="unclear"]');
    out.rfiFields = { subject: !!subjectInput, question: !!questionArea };
    if (subjectInput && questionArea) {
      await subjectInput.click({ clickCount: 3 });
      await page.keyboard.type("AUDIT: Crane hoisting responsibility?");
      await questionArea.click({ clickCount: 3 });
      await page.keyboard.type("AUDIT TEST: Please clarify whether crane hoisting and rigging to the penthouse is in the base bid or excluded.");
      await delay(500);
      const state = await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Submit RFI"));
        return { disabled: btn ? btn.disabled : null };
      });
      out["rfi-button-state"] = state;
      const t0 = Date.now();
      if (!state.disabled) await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Submit RFI"))?.click());
      const timeline = [];
      for (let i = 0; i < 30; i++) {
        await delay(1000);
        const s = await page.evaluate(() => {
          const t = document.body.innerText;
          return {
            count: (t.match(/All RFIs \((\d+)\)/) || [])[1],
            button: ([...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Analyzing") || (b.textContent || "").includes("Submit RFI")) || {}).textContent || null,
            pendingBanner: /analyzing|in flight|processing|will appear/i.test(t),
          };
        });
        timeline.push({ t: Math.round((Date.now() - t0) / 1000), ...s });
        if (s.count && Number(s.count) > 0) break;
      }
      out["BUG-08"] = { timeline };
      out["BUG-09"] = await page.evaluate(() => {
        const t = document.body.innerText;
        return { hasTripleHash: /\n###\s/.test(t), hasBoldAsterisks: /\*\*[A-Za-z]/.test(t), sample: (t.match(/\*\*[^\n*]{0,60}\*\*/g) || []).slice(0, 5), headingSample: (t.match(/(^|\n)### [^\n]{0,60}/g) || []).slice(0, 3) };
      });
      out["BUG-10"] = await page.evaluate(() => ({ times: (document.body.innerText.match(/\b\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)\b/g) || []).slice(0, 10) }));
    }
    await shot(page, "fix-BUG08-rfi-timeline.png", { full: true });

    // ---------- Addendum (BUG-11)
    const addendumBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Issue Legal Addendum"));
      if (!b) return { ok: false };
      b.click();
      return { ok: true };
    });
    out["addendum-click"] = addendumBtn;
    await delay(8000);
    out["BUG-11"] = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        success: (t.match(/Official Pre-Bid Legal Addendum[^\n]*/) || [])[0] || null,
        filename: (t.match(/ADDENDUM[A-Z0-9_.]*\.md/) || [])[0] || null,
        claimsAia401: t.includes("AIA A401 standard pre-bid legal addendum"),
        error: (t.match(/Addendum generation failed[^\n]*/) || [])[0] || null,
      };
    });
    await shot(page, "fix-BUG11-addendum.png", { full: true });

    // ---------- Evals run ID (BUG-31)
    await clickTabText("Evals & Architecture");
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Run Chief Estimator Evals"))?.click());
    await delay(12000);
    const run1 = await page.evaluate(() => (document.body.innerText.match(/Run ID: (eval_\d+)/) || [])[1] || null);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Run Chief Estimator Evals"))?.click());
    await delay(12000);
    const run2 = await page.evaluate(() => (document.body.innerText.match(/Run ID: (eval_\d+)/) || [])[1] || null);
    out["BUG-31"] = { run1, run2, sameId: run1 === run2, parity: await page.evaluate(() => (document.body.innerText.match(/PARITY ACHIEVED[^\n]*|Zero Cheating/g) || []).slice(0, 4)) };
    await shot(page, "fix-BUG31-evals.png", { full: true });

    out.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 10), pageErrors: diag.pageErrors, failedRequests: diag.failedRequests.slice(0, 10) };
    writeJson("fix-verify-fixture-4.json", out);
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
    writeJson("fix-verify-fixture-4.json", out);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(out, null, 2).slice(0, 16000));
};

run();