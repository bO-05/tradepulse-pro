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

  const clickTab = async (titlePrefix) => {
    await page.evaluate((p) => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(p));
      b?.click();
    }, titlePrefix);
    await delay(900);
  };
  const clickByText = async (t, exact = false) => page.evaluate(({ t, exact }) => {
    const b = [...document.querySelectorAll("button")].find((x) => { const s = (x.textContent || "").trim(); return exact ? s === t : s.includes(t); });
    if (!b) return { ok: false };
    b.click();
    return { ok: true, text: (b.textContent || "").trim() };
  }, { t, exact });

  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await selectProjectByTitle(page, "AUDIT-REMED");
    await delay(1500);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").includes("Dismiss"));
      b?.click();
    });
    await delay(500);

    // ---------- BUG-04 focused: empty spec
    await clickTab("01:");
    await clickByText("AI Spec Breakdown");
    await delay(900);
    out["BUG-04"] = await page.evaluate(() => {
      const h = [...document.querySelectorAll("h2,h3")].find((el) => (el.textContent || "").includes("AI Specification Breakdown"));
      if (!h) return { dialog: false };
      let dlg = h;
      for (let i = 0; i < 8 && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("textarea")) break; }
      const ta = dlg.querySelector("textarea");
      const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Auto-Generate Trade Packages"));
      return { dialog: true, textareaValue: ta ? ta.value : null, textareaLen: ta ? ta.value.length : null, submitDisabled: btn ? btn.disabled : null, target: (dlg.innerText.match(/Target Project: [^\n]*/) || [])[0] };
    });
    await shot(page, "fix-BUG04-focused.png");
    await page.keyboard.press("Escape");
    await delay(500);

    // ---------- Uploads (BUG-13/12/14)
    const payloadName = "26_00_00_Electrical_Systems_Spec.txt";
    const payloadPath = path.join(EV, "fix-upload-collision-payload.txt");
    fs.writeFileSync(payloadPath, "AUDIT COLLISION PAYLOAD - NOT the real spec (43 bytes-ish)");
    const normalPath = path.join(EV, "fix-upload-normal.txt");
    fs.writeFileSync(normalPath, "AUDIT-UPLOAD-PROOF: uploaded by remediation harness 2026-09-17.");

    const uploadOne = async (filePath, typeValue) => {
      await page.select("select#convex-file-upload ~ *, select", "spec").catch(async () => {
        await page.evaluate(() => {
          const selects = [...document.querySelectorAll("select")];
          const target = selects.find((s) => [...s.options].some((o) => o.value === "spec"));
          if (target) { target.value = "spec"; target.dispatchEvent(new Event("change", { bubbles: true })); }
        });
      });
      const input = await page.$("input#convex-file-upload");
      await input.uploadFile(filePath);
      await page.evaluate(() => {
        const i = document.querySelector("input#convex-file-upload");
        i.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await delay(5000);
    };

    const before = await page.evaluate(() => (document.body.innerText.match(/Project Documents in Convex Storage \((\d+)\)/) || [])[1]);
    out["upload-before"] = before;
    await uploadOne(payloadPath);
    out["upload-after-1"] = await page.evaluate(() => (document.body.innerText.match(/Project Documents in Convex Storage \((\d+)\)/) || [])[1]);
    const fileRowState = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("26_00_00_Electrical_Systems_Spec.txt"));
      const text = document.body.innerText;
      return { found: rows.length > 0, status: (text.match(/Upload failed[^\n]*/g) || []).slice(0, 3), success: (text.match(/Successfully uploaded[^\n]*/g) || []).slice(0, 3), uploadingMsg: (text.match(/Uploading[^\n]*/g) || []).slice(0, 3) };
    });
    out["upload-1-result"] = fileRowState;
    await shot(page, "fix-BUG13-upload-1.png", { full: true });

    // download collision file
    const dlHandleInfo = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("26_00_00_Electrical_Systems_Spec.txt") && (d.innerText || "").includes("Download"));
      const row = rows[rows.length - 1];
      if (!row) return { ok: false };
      const btn = [...row.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Download"));
      btn?.click();
      return { ok: true, rowText: row.innerText.replace(/\n+/g, " | ").slice(0, 300) };
    });
    out["download-click"] = dlHandleInfo;
    await delay(4000);
    const dlFiles = fs.existsSync(DL) ? fs.readdirSync(DL).map((f) => ({ f, size: fs.statSync(path.join(DL, f)).size })) : [];
    out["download-files"] = dlFiles;
    const dlCandidates = dlFiles.filter((f) => f.f.endsWith(".txt") || f.f.endsWith(".pdf"));
    if (dlCandidates.length > 0) {
      const target = dlCandidates.sort((a, b) => b.size - a.size)[0];
      const content = fs.readFileSync(path.join(DL, target.f), "utf8").slice(0, 300);
      out["download-content-head"] = content;
    }
    out["download-before-preview"] = dlFiles.length;

    // preview of the collision file
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("26_00_00_Electrical_Systems_Spec.txt") && (d.innerText || "").includes("Preview"));
      const row = rows[rows.length - 1];
      const btn = row ? [...row.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Preview")) : null;
      btn?.click();
    });
    await delay(1500);
    out["BUG-14"] = await page.evaluate(() => {
      const t = document.body.innerText;
      const caption = (t.match(/100% Real Construction Document Specification[^\n]*/) || [])[0];
      const bodyHasPayload = t.includes("AUDIT COLLISION PAYLOAD");
      return { caption, bodyHasPayload };
    });
    await shot(page, "fix-BUG14-preview-caption.png");
    await page.evaluate(() => {
      const modal = [...document.querySelectorAll("div")].find((d) => (d.innerText || "").includes("AUDIT COLLISION PAYLOAD") && (d.innerText || "").includes("Close"));
      const close = modal ? [...modal.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Close") : null;
      close?.click();
    });
    await delay(600);

    // ---------- BUG-15 stacked confirms
    const openFileConfirm = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("fix-upload-normal.txt") || (d.innerText || "").includes("26_00_00_Electrical_Systems_Spec.txt"));
      const row = rows[rows.length - 1];
      const btn = row ? [...row.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "").includes("Delete file")) : null;
      btn?.click();
      return { ok: !!btn };
    });
    out["stack-file-confirm"] = openFileConfirm;
    await delay(800);
    const stack1 = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="alertdialog"]')];
      return d.map((x) => { const r = x.getBoundingClientRect(); return { title: (x.querySelector("h2") || {}).textContent, top: Math.round(r.top), bottom: Math.round(r.bottom), z: getComputedStyle(x.parentElement).zIndex }; });
    });
    // second confirm: JS-click header Delete (project delete) while first is open
    const openProjectConfirm = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Delete custom project"));
      b?.click();
      return { ok: !!b };
    });
    out["stack-project-confirm"] = openProjectConfirm;
    await delay(900);
    const stack2 = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="alertdialog"]')];
      return d.map((x) => { const r = x.getBoundingClientRect(); return { title: (x.querySelector("h2") || {}).textContent, top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), clipTop: r.top < 0 || r.top < 2, inHeader: !!x.closest("header") }; });
    });
    out["BUG-15"] = { firstOpen: stack1, afterSecond: stack2 };
    await shot(page, "fix-BUG15-stacked-confirms.png");
    // cancel both safely
    await page.evaluate(() => {
      for (const d of [...document.querySelectorAll('[role="alertdialog"]')]) {
        const cancel = [...d.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Cancel");
        cancel?.click();
      }
    });
    await delay(600);
    out["after-cancel-dialogs"] = await page.evaluate(() => document.querySelectorAll('[role="alertdialog"]').length);

    // ---------- RFI submit (BUG-08/09/10)
    await clickTab("03:");
    const t0 = Date.now();
    await page.evaluate(() => {
      const inputs = [...document.querySelectorAll("input,textarea")];
      const subj = inputs.find((i) => (i.placeholder || "").toLowerCase().includes("subject"));
      const q = inputs.find((i) => (i.placeholder || "").toLowerCase().includes("question"));
      const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      if (subj) { iset.call(subj, "AUDIT: Crane hoisting responsibility?"); subj.dispatchEvent(new Event("input", { bubbles: true })); }
      if (q) { tset.call(q, "AUDIT TEST: Please clarify whether crane hoisting and rigging to the penthouse is in the base bid or excluded."); q.dispatchEvent(new Event("input", { bubbles: true })); }
    });
    const rfiSubmit = await clickByText("Submit RFI for Clarification");
    out["rfi-submit"] = { ...rfiSubmit, t0 };
    // poll for UI feedback and appearance
    const feedback = [];
    for (let i = 0; i < 24; i++) {
      await delay(1000);
      const snap = await page.evaluate(() => {
        const t = document.body.innerText;
        return {
          count: (t.match(/All RFIs \((\d+)\)/) || [])[1],
          buttonLabel: ([...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Analyzing") || (b.textContent || "").includes("Submit RFI")) || {}).textContent,
          formCleared: (() => { const q = [...document.querySelectorAll("textarea")].find((x) => (x.placeholder || "").toLowerCase().includes("question")); return q ? q.value.length === 0 : null; })(),
        };
      });
      feedback.push({ t: Math.round((Date.now() - t0) / 1000), ...snap });
      if (snap.count && Number(snap.count) > 0) break;
    }
    out["BUG-08"] = { timeline: feedback };
    out["BUG-09"] = await page.evaluate(() => {
      const t = document.body.innerText;
      const raw = t.match(/\*\*[^*]{3,40}\*\*|^###\s|^\s*---\s*$/gm) || [];
      return { rawMarkdownSamples: raw.slice(0, 8), hasTripleHash: /\n###\s/.test(t), hasBoldAsterisks: /\*\*[A-Z]/.test(t) };
    });
    out["BUG-10/28"] = await page.evaluate(() => {
      const t = document.body.innerText;
      const times = t.match(/\b\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)\b/g) || [];
      return { times: times.slice(0, 10) };
    });
    await shot(page, "fix-BUG08-rfi-submitted.png", { full: true });

    // ---------- BUG-17: Simulate Inbound Quote opens dock
    await clickTab("04:");
    const sim = await clickByText("Simulate Inbound Quote");
    out["BUG-17-click"] = sim;
    await delay(1500);
    out["BUG-17"] = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return { dialogOpened: !!dlg, dialogTitle: dlg ? (dlg.innerText.match(/[^\n]*Simulation Engine[^\n]*/) || [])[0] : null, dockButton: !!document.body.innerText.match(/1-Click Run Full Autonomous Procurement Lifecycle/) };
    });
    await shot(page, "fix-BUG17-simulate-inbound.png");
    await page.keyboard.press("Escape");
    await delay(600);

    // ---------- Evals Run ID (BUG-31)
    await clickTab("Evals");
    const runEval = async () => {
      await clickByText("Run Chief Estimator Evals");
      await delay(9000);
      return page.evaluate(() => {
        const m = document.body.innerText.match(/Run ID: (eval_\d+)/);
        return m ? m[1] : null;
      });
    };
    out["eval-run-1"] = await runEval();
    out["eval-run-2"] = await runEval();
    out["BUG-31"] = { sameId: out["eval-run-1"] === out["eval-run-2"], run1: out["eval-run-1"], run2: out["eval-run-2"] };
    await shot(page, "fix-BUG31-evals-rerun.png", { full: true });

    out.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 10), pageErrors: diag.pageErrors, failedRequests: diag.failedRequests.slice(0, 10) };
    writeJson("fix-verify-fixture-3.json", out);
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
    writeJson("fix-verify-fixture-3.json", out);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(out, null, 2).slice(0, 16000));
};

run();