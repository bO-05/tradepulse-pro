/**
 * QA8 hunt — Project Files (upload/wrong-type/oversize/preview/download/delete),
 * Live Activity Audit rendering + empty state, Evals & Architecture claim/source check,
 * 375px + 200% + keyboard-only sweeps on Audit/Files.
 * Fixture: AUDIT-QA8-hunt-2026-09-18 (created and deleted here).
 * Evidence: evidence/fix4-qa8-30-hunt.json + screenshots.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  attachDiagnostics,
  clickHeaderTab,
  delay,
  gotoDemo,
  launchBrowser,
  selectProjectByTitle,
  setViewport,
  writeJson,
} from "./qa6-lib.mjs";
import { shot } from "./lib.mjs";
import { client, fixtureName, writeEvidence } from "./qa8-lib.mjs";

const c = client();
const prefix = fixtureName("hunt");
const out = { ranAt: new Date().toISOString(), fixture: { title: prefix }, files: {}, audit: {}, evals: {}, responsive: {}, diagnostics: {} };

const tmpDir = path.join(os.tmpdir(), "opencode", "qa8-files");
fs.mkdirSync(tmpDir, { recursive: true });
const normalTxt = path.join(tmpDir, "AUDIT-QA8-normal-spec.txt");
fs.writeFileSync(normalTxt, "Division 26 00 00 Electrical specification for QA8 verification.\n", "utf8");
const fakePdf = path.join(tmpDir, "AUDIT-QA8-quote-proposal.pdf");
fs.writeFileSync(fakePdf, "This is plain text content stored inside a .pdf-named file for QA8.\n", "utf8");
const wrongTxt = path.join(tmpDir, "AUDIT-QA8-coi.txt");
fs.writeFileSync(wrongTxt, "QA8 text file that must not pass as an ACORD 25 COI certificate.\n", "utf8");
const exeFile = path.join(tmpDir, "AUDIT-QA8-unsupported.exe");
fs.writeFileSync(exeFile, "MZ qa8 unsupported binary placeholder\n", "utf8");

let projectId;
const checks = [];
const addCheck = (id, label, ok, observed) => {
  checks.push({ id, label, ok, observed: String(observed).slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id} ${label} :: ${String(observed).slice(0, 200)}`);
};

try {
  projectId = await c.mutation("projects:createProject", {
    title: prefix,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use",
    estBudget: 1_000_000,
    targetCompletionWeeks: 30,
    specDocumentText: "QA8 hunt fixture.",
    isDemoProject: false,
  });
  const pkg = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision: "26 00 00",
    tradeName: "QA8 Hunt Electrical",
    budgetEstimate: 500_000,
    scopeSummary: "QA8 hunt scope.",
    mandatoryInclusions: ["Code compliance"],
    bidDeadline: "2026-10-31",
  });
  out.fixture.projectId = projectId;
  out.fixture.packageId = pkg;

  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diagnostics = attachDiagnostics(page);
  try {
    await gotoDemo(page);

    // ------------------------------------------------------------ Evals & Architecture (demo)
    await clickHeaderTab(page, "Evals & Architecture");
    await delay(1800);
    const evalsText = await page.evaluate(() => document.body.innerText);
    const evalQuery = await c.query("evals:getLatestEvalRun", {});
    const providers = await c.query("llmRouter:getProviderAvailability", {});
    out.evals.latestRun = evalQuery?.run
      ? {
          runId: evalQuery.run.runId,
          createdAt: evalQuery.run.createdAt ?? evalQuery.run.timestamp ?? null,
          totalCases: evalQuery.run.totalCases,
          passedCases: evalQuery.run.passedCases,
          holdoutMape: evalQuery.run.holdoutMape,
        }
      : null;
    out.evals.providers = providers;
    out.evals.uiTextSample = evalsText.slice(0, 2600);
    out.evals.uiHasRunId = /Run ID:/i.test(evalsText);
    out.evals.uiRunIdMatches = out.evals.latestRun ? evalsText.includes(out.evals.latestRun.runId) : null;
    out.evals.uiKeyClaims = {
      openAiConfigured: /OpenAI/i.test(evalsText),
      noKeyDisclaimer: /no API key is configured|not configured|BYOK/i.test(evalsText),
      mapeShown: /MAPE/i.test(evalsText),
      generatedAt: /Generated|Last run|Run ID/i.test(evalsText),
    };
    await shot(page, "fix4-qa8-30-evals.png");
    addCheck(
      "H-EVALS-1",
      "Evals tab shows a Run ID and it matches the stored latest run",
      out.evals.uiHasRunId && out.evals.uiRunIdMatches !== false,
      `hasRunId=${out.evals.uiHasRunId} matches=${out.evals.uiRunIdMatches} stored=${out.evals.latestRun?.runId}`
    );

    // ------------------------------------------------------------ Audit rendering (demo)
    await clickHeaderTab(page, "Live Activity Audit");
    await delay(1200);
    const auditUi = await page.evaluate(() => {
      const text = document.body.innerText;
      const rows = [...document.querySelectorAll("main > div > div")].length;
      return {
        textSample: text.slice(0, 2000),
        eventCountLabel: (text.match(/Activity Events \((\d+)\)/) || [])[1] ?? null,
        timestampSamples: (text.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}, \d{1,2}:\d{2}:\d{2} [AP]M GMT[+-]\d+/g) || []).slice(0, 4),
        hasWebsocketLabel: /useQuery WebSocket Feed/.test(text),
        hasAiaClaim: /AIA subcontract awards/i.test(text),
      };
    });
    const demoProjects = await c.query("projects:listProjects", {});
    const demo = demoProjects.find((p) => /Domain Tower B/i.test(p.title));
    const demoLogs = demo ? await c.query("auditLogs:listRecentLogs", { projectId: demo._id, limit: 100 }) : [];
    const eventTypes = [...new Set(demoLogs.map((l) => l.eventType))];
    out.audit.demo = {
      eventCountLabel: auditUi.eventCountLabel,
      queryLogCount: demoLogs.length,
      eventTypes,
      timestampSamples: auditUi.timestampSamples,
      hasWebsocketLabel: auditUi.hasWebsocketLabel,
      hasAiaClaim: auditUi.hasAiaClaim,
      textSample: auditUi.textSample,
    };
    await shot(page, "fix4-qa8-30-audit-demo.png");
    addCheck(
      "H-AUDIT-1",
      "Audit event count label equals query row count",
      Number(auditUi.eventCountLabel) === demoLogs.length,
      `ui=${auditUi.eventCountLabel} query=${demoLogs.length}`
    );
    addCheck(
      "H-AUDIT-2",
      "Audit header avoids AIA-licensed claim language",
      !auditUi.hasAiaClaim,
      `hasAiaClaim=${auditUi.hasAiaClaim}`
    );

    // ------------------------------------------------------------ Fixture: empty audit state + files
    await selectProjectByTitle(page, prefix);
    await delay(1600);
    await clickHeaderTab(page, "Live Activity Audit");
    await delay(1000);
    const emptyAudit = await page.evaluate(() => document.body.innerText.includes("No activity records in audit stream yet."));
    out.audit.emptyState = emptyAudit;
    await shot(page, "fix4-qa8-30-audit-empty.png");
    addCheck("H-AUDIT-3", "Fresh project shows audit empty state", emptyAudit, emptyAudit);

    // ------------------------------------------------------------ Files
    await clickHeaderTab(page, "01: CSI Scoping");
    await delay(1200);
    const filesInitial = await page.evaluate(() => document.body.innerText.match(/Project Documents in Convex Storage \((\d+)\)/)?.[1] ?? null);
    out.files.initialCount = filesInitial;

    const upload = async (paths) => {
      const input = await page.$("#convex-file-upload");
      await input.uploadFile(...paths);
      await delay(2200);
      return page.evaluate(() => document.body.innerText.match(/Upload (?:failed: )?[^\n]*/)?.[0] ?? null);
    };

    // 1) normal txt as spec
    let msg = await upload([normalTxt]);
    let count = await page.evaluate(() => document.body.innerText.match(/Project Documents in Convex Storage \((\d+)\)/)?.[1] ?? null);
    const normalStored = await c.query("files:listFilesByProject", { projectId });
    addCheck("H-FILES-1", "txt spec upload succeeds and record persists", msg?.includes("Successfully uploaded") && normalStored.some((f) => f.fileName === "AUDIT-QA8-normal-spec.txt"), `msg=${msg} count=${count} records=${normalStored.length}`);

    // 2) fake pdf (text content in .pdf) as quote_pdf
    await page.select('select[aria-label="Document type for upload"]', "quote_pdf");
    msg = await upload([fakePdf]);
    const fakeRecord = (await c.query("files:listFilesByProject", { projectId })).find((f) => f.fileName === "AUDIT-QA8-quote-proposal.pdf");
    addCheck("H-FILES-2", "pdf-named text file uploads and is labeled by extension", !!fakeRecord, `msg=${msg} record=${JSON.stringify(fakeRecord ? { t: fakeRecord.fileType, text: (fakeRecord.textContent || "").slice(0, 40) } : null)}`);

    // 3) wrong type: coi_certificate + .txt
    await page.select('select[aria-label="Document type for upload"]', "coi_certificate");
    msg = await upload([wrongTxt]);
    out.files.wrongTypeMessage = msg;
    addCheck("H-FILES-3", "txt rejected for ACORD COI type with clear message", /must use \.pdf/i.test(msg || ""), msg);

    // 4) unsupported extension
    await page.select('select[aria-label="Document type for upload"]', "spec");
    msg = await upload([exeFile]);
    out.files.unsupportedMessage = msg;
    addCheck("H-FILES-4", "unsupported .exe rejected with clear message", /upload PDF, DWG, DXF, or TXT/i.test(msg || ""), msg);

    // 5) oversize synthetic (51MB) never reaches network
    const beforeReqs = diagnostics.requests.length;
    msg = await page.evaluate(async () => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(51 * 1024 * 1024)], "AUDIT-QA8-oversize.txt", { type: "text/plain" }));
      const input = document.querySelector("#convex-file-upload");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1500));
      return document.body.innerText.match(/Upload (?:failed: )?[^\n]*/)?.[0] ?? null;
    });
    await delay(800);
    const afterReqs = diagnostics.requests.length;
    out.files.oversizeMessage = msg;
    addCheck("H-FILES-5", "51MB file rejected client-side before network", /50 MB/i.test(msg || "") && afterReqs === beforeReqs, `msg=${msg} reqDelta=${afterReqs - beforeReqs}`);

    // 6) preview + download + delete of the normal file
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("div")].find((d) => d.innerText?.startsWith("AUDIT-QA8-normal-spec.txt"));
      const btn = row && [...row.querySelectorAll("button")].find((b) => b.getAttribute("title") === "Preview authentic specification/document text");
      if (btn) btn.click();
    });
    await delay(600);
    const preview = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        open: text.includes("Close document preview"),
        hasFileName: text.includes("AUDIT-QA8-normal-spec.txt"),
        hasBodyText: text.includes("Electrical specification for QA8 verification"),
      };
    });
    await shot(page, "fix4-qa8-30-files-preview.png");
    await page.keyboard.press("Escape");
    await delay(400);
    addCheck("H-FILES-6", "txt preview shows stored content", preview.open && preview.hasBodyText, JSON.stringify(preview));

    // download (store bytes interception)
    const downloadDir = path.resolve("evidence", "fix4-qa8-downloads");
    fs.mkdirSync(downloadDir, { recursive: true });
    const cdp = await page.createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir, eventsEnabled: true });
    const downloads = [];
    cdp.on("Browser.downloadWillBegin", (e) => downloads.push(e.suggestedFilename));
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("div")].find((d) => d.innerText?.startsWith("AUDIT-QA8-normal-spec.txt"));
      const btn = row && [...row.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "").startsWith("Download"));
      if (btn) btn.click();
    });
    await delay(1200);
    out.files.downloadNames = downloads;
    addCheck("H-FILES-7", "download produces the stored file name", downloads.includes("AUDIT-QA8-normal-spec.txt"), JSON.stringify(downloads));

    // delete with confirm
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("div")].find((d) => d.innerText?.startsWith("AUDIT-QA8-normal-spec.txt"));
      const btn = row && [...row.querySelectorAll("button")].find((b) => b.getAttribute("title") === "Delete file from storage");
      if (btn) btn.click();
    });
    await delay(500);
    await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="alertdialog"]')].filter((e) => e.getBoundingClientRect().width > 0).pop();
      const b = dlg && [...dlg.querySelectorAll("button")].find((x) => /Delete file/.test(x.innerText));
      if (b) b.click();
    });
    await delay(1500);
    const afterDelete = await c.query("files:listFilesByProject", { projectId });
    const deletedGone = !afterDelete.some((f) => f.fileName === "AUDIT-QA8-normal-spec.txt");
    const statusAfterDelete = await page.evaluate(() => document.body.innerText.match(/File deleted from storage\.|Delete failed:[^\n]*/)?.[0] ?? null);
    addCheck("H-FILES-8", "delete removes record and reports truthfully", deletedGone && /File deleted/.test(statusAfterDelete || ""), `gone=${deletedGone} status=${statusAfterDelete}`);

    // ------------------------------------------------------------ responsive / keyboard
    const surfaceProbe = async (id, tabLabel) => {
      await setViewport(page, 375, 800);
      await delay(800);
      await clickHeaderTab(page, tabLabel);
      await delay(1000);
      const m375 = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        mainScrollW: document.querySelector("main")?.scrollWidth ?? null,
      }));
      await shot(page, `fix4-qa8-30-375-${id}.png`);
      // keyboard-only: 25 tabs, record off-viewport or clipped focus
      const kb = await page.evaluate(() => {
        const a = document.activeElement;
        return { start: a ? a.tagName.toLowerCase() : null };
      });
      let offscreen = 0;
      const stops = [];
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press("Tab");
        await delay(25);
        const pos = await page.evaluate(() => {
          const a = document.activeElement;
          if (!a) return null;
          const r = a.getBoundingClientRect();
          return {
            tag: a.tagName.toLowerCase(),
            name: (a.getAttribute("aria-label") || a.innerText || "").trim().slice(0, 40),
            w: Math.round(r.width),
            h: Math.round(r.height),
            inView: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth,
          };
        });
        if (pos && !pos.inView) offscreen++;
        if (pos) stops.push(pos);
      }
      await setViewport(page, 720, 900);
      await delay(600);
      const m200 = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
      }));
      await shot(page, `fix4-qa8-30-200pct-${id}.png`);
      await setViewport(page, 1440, 900);
      out.responsive[id] = { m375, m200, keyboardStart: kb.start, offscreenStops: offscreen, stopSample: stops.slice(0, 6) };
      addCheck(`H-RESP-${id}`, `${id} 375px no horizontal overflow`, m375.overflowX <= 2, JSON.stringify(m375));
      addCheck(`H-RESP-${id}-200`, `${id} 200% no horizontal overflow`, m200.overflowX <= 2, JSON.stringify(m200));
      addCheck(`H-KB-${id}`, `${id} keyboard tab stays in viewport`, offscreen === 0, `offscreen=${offscreen}/${stops.length}`);
    };
    await surfaceProbe("audit", "Live Activity Audit");
    await surfaceProbe("files", "01: CSI Scoping");
    await surfaceProbe("diagnostics", "Evals & Architecture");

    await delay(400);
    const errors = diagnostics.consoleLogs.filter((l) => l.type === "error");
    const dupCounts = {};
    for (const r of diagnostics.requests) {
      const key = `${r.method} ${r.url}`;
      dupCounts[key] = (dupCounts[key] || 0) + 1;
    }
    out.diagnostics = {
      consoleErrors: errors.map((e) => e.text.slice(0, 220)).slice(0, 20),
      pageErrors: diagnostics.pageErrors,
      failedRequests: diagnostics.failedRequests,
      requestCount: diagnostics.requests.length,
      topDuplicates: Object.entries(dupCounts)
        .filter(([, n]) => n > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([k, n]) => `${n}x ${k}`),
    };
  } finally {
    await browser.close();
  }
} catch (err) {
  out.fatal = String(err?.stack ?? err);
  console.error("FATAL", err);
} finally {
  const all = await c.query("projects:listProjects", {});
  const mine = all.filter((p) => p.title.startsWith("AUDIT-QA8-"));
  out.cleanup = { deleted: [], leftover: [] };
  for (const p of mine) {
    try {
      await c.mutation("projects:deleteProject", { projectId: p._id });
      out.cleanup.deleted.push(p._id);
    } catch (err) {
      out.cleanup.deleted.push(`${p._id}:FAILED:${err?.message ?? err}`);
    }
  }
  await delay(1200);
  const after = await c.query("projects:listProjects", {});
  out.cleanup.leftover = after.filter((p) => p.title.startsWith("AUDIT-QA8-")).map((p) => p._id);
  out.checks = checks;
  writeEvidence("30-hunt", out);
  writeJson("fix4-qa8-30-hunt.json", out);
  const failed = checks.filter((k) => !k.ok);
  console.log(`\nQA8-30 done. checks=${checks.length} failed=${failed.length} cleanupLeftover=${out.cleanup.leftover.length}`);
  for (const f of failed) console.log(`  FAIL ${f.id} ${f.label}: observed=${f.observed}`);
}