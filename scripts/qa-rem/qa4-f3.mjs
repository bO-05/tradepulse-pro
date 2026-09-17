import { ConvexHttpClient } from "convex/browser";
import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  bodyText,
  delay,
  waitForBodyText,
  clickTab,
  clickButtonByText,
  createProjectViaUI,
  summarizeDiagnostics,
  writeLog,
  writeJson,
} from "./qa4-lib.mjs";

const log = [];
const say = (s) => { console.log(s); log.push(s); };
const CLOUD = "https://brainy-skunk-440.convex.cloud";

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
say(`F3 TARGET: ${BASE_URL}`);
const page = await browser.newPage();
const diag = attachDiagnostics(page);

const title = `QA-REM-QA4-F3-${Date.now()}`;
say(`F3 PROJECT: ${title}`);
let result = { f3: "FAIL", title };

async function createManualPackage(page, { csi, name, scope }) {
  const open = await clickButtonByText(page, "Create Trade Package", { exact: true });
  if (!open.ok) return { ok: false, step: "open", open };
  await delay(400);
  const fill = await page.evaluate((csiVal, nameVal, scopeVal) => {
    const dialogs = [...document.querySelectorAll("div.fixed")];
    const dlg = dialogs.find((d) => (d.textContent || "").includes("Create CSI Trade Package"));
    if (!dlg) return { ok: false, reason: "modal not found" };
    const inputs = [...dlg.querySelectorAll("input")];
    const ta = [...dlg.querySelectorAll("textarea")];
    const proto = HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    const taSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    const set = (el, v) => {
      const s = el instanceof HTMLTextAreaElement ? taSetter : setter;
      s.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set(inputs[0], csiVal);
    set(inputs[1], nameVal);
    set(inputs[2], "900000");
    set(ta[0], scopeVal);
    set(ta[1], "QA inclusion one\nQA inclusion two");
    set(inputs[3], "2026-10-31");
    return { ok: true, values: inputs.map((i) => i.value) };
  }, csi, name, scope);
  if (!fill.ok) return { ok: false, step: "fill", fill };
  await delay(200);
  const submit = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll("div.fixed")];
    const dlg = dialogs.find((d) => (d.textContent || "").includes("Create CSI Trade Package"));
    if (!dlg) return { ok: false, reason: "modal not found" };
    const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Create Package");
    if (!btn) return { ok: false, reason: "submit missing" };
    btn.click();
    return { ok: true };
  });
  await waitForBodyText(page, ["created successfully", "Error creating package", "already exists"], 25000);
  await delay(600);
  return { ok: submit.ok, fill, submit, toast: await bodyText(page) };
}

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  const created = await createProjectViaUI(page, { title, budget: 1800000, weeks: 30 });
  say(`CREATE: ${JSON.stringify(created.waited)}`);
  await delay(700);

  const client = new ConvexHttpClient(CLOUD);
  const projects = await client.query("projects:listProjects", {});
  const proj = projects.find((p) => p.title === title);
  if (!proj) throw new Error("project not found in backend");
  const projectId = proj._id;
  result.projectId = projectId;
  say(`BACKEND PROJECT: ${projectId}`);

  // ---------- F3a: pure backend addendum on zero packages (zero pending RFIs) ----------
  let backendOk = false;
  let backendDetail = null;
  const t = Date.now();
  try {
    const addendum = await client.action("files:generatePreBidAddendum", { projectId });
    const files = await client.query("files:listFilesByProject", { projectId });
    const rec = files.find((f) => f.fileType === "addendum");
    let http = null;
    let head = null;
    if (rec?.url) {
      const r = await fetch(rec.url);
      http = r.status;
      head = (await r.text()).slice(0, 120);
    }
    backendOk = Boolean(addendum?.success && addendum?.storageId && rec && http === 200 && (head || "").includes("ADDENDUM NO. 01"));
    backendDetail = { success: addendum?.success, storageId: addendum?.storageId, fileName: rec?.fileName, http, head, elapsedMs: Date.now() - t };
  } catch (err) {
    backendDetail = { error: err?.message || String(err), elapsedMs: Date.now() - t };
  }
  say(`F3a BACKEND ZERO-PACKAGE ADDENDUM: ok=${backendOk} ${JSON.stringify(backendDetail)}`);

  // ---------- F3b: UI addendum with one package and zero RFIs ----------
  const pkgCreate = await createManualPackage(page, {
    csi: "26 00 00",
    name: "QA F3 Electrical Package",
    scope: "QA verification scope for addendum issuance with zero subcontractor RFIs.",
  });
  say(`MANUAL PACKAGE CREATE: ${JSON.stringify(pkgCreate.ok)}`);
  await waitForBodyText(page, ["QA F3 Electrical Package"], 20000);
  await delay(900);
  const tab = await clickTab(page, "Pre-Bid Q&A");
  say(`QNA TAB: ${JSON.stringify(tab)}`);
  const qnaReady = await waitForBodyText(page, ["Issue Legal Addendum NO. 01"], 25000);
  say(`QNA READY: ${JSON.stringify(qnaReady)}`);
  await delay(600);
  const qnaText = await bodyText(page);
  const queueZero = /PM Review Queue \(0\)/.test(qnaText);
  const noEscalation = !qnaText.includes("Require PM Certification");
  // Backend RFI count for the package must be zero
  const pkgs = await client.query("tradePackages:listByProject", { projectId });
  const convos = pkgs.length ? await client.query("rfq:listConversations", { tradePackageId: pkgs[0]._id }) : [];
  say(`ZERO-RFI PRECHECK: queueZero=${queueZero} noEscalation=${noEscalation} backendConversations=${convos.length} escalatedInSql=NA`);
  const preShot = await shot(page, "remediation-qa4-f3-01-zero-rfi-qna.png");

  const t0 = Date.now();
  const clicked = await clickButtonByText(page, "Issue Legal Addendum NO. 01");
  say(`ADDENDUM CLICK: ${JSON.stringify(clicked)}`);
  const waited = await waitForBodyText(
    page,
    ["Successfully Issued & Filed", "Addendum generation failed", "PM certification is required"],
    90000
  );
  const durationMs = Date.now() - t0;
  await delay(800);
  const shotPath = await shot(page, "remediation-qa4-f3-02-addendum-result.png");
  const text = await bodyText(page);
  const downloadHref = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((x) => (x.textContent || "").includes("Download Addendum"));
    return a ? a.getAttribute("href") : null;
  });
  say(`UI ADDENDUM: hit="${waited.hit}" elapsed=${durationMs}ms queueZero=${queueZero} noEscalation=${noEscalation} shot=${shotPath}`);
  say(`UI ADDENDUM HREF: ${downloadHref ? downloadHref.slice(0, 100) + "..." : null}`);

  const filesAfter = await client.query("files:listFilesByProject", { projectId });
  const addenda = filesAfter.filter((f) => f.fileType === "addendum");
  let uiHttp = null;
  let uiHead = null;
  if (downloadHref) {
    const r = await fetch(downloadHref);
    uiHttp = r.status;
    uiHead = (await r.text()).slice(0, 120);
  }
  say(`F3b BACKEND: addendumFiles=${addenda.length} uiDownloadHttp=${uiHttp} head=${JSON.stringify(uiHead)}`);

  const f3bpass = waited.hit === "Successfully Issued & Filed" && addenda.length >= 1 && uiHttp === 200 && (uiHead || "").includes("ADDENDUM NO. 01");
  const pass = backendOk && f3bpass && queueZero && noEscalation && convos.length === 0;
  result.f3 = pass ? "PASS" : "FAIL";
  result.backendZeroPackage = { ok: backendOk, detail: backendDetail };
  result.uiAddendum = { hit: waited.hit, durationMs, downloadHttp: uiHttp, downloadHead: uiHead, addendumFiles: addenda.length, queueZero, noEscalation, backendConversations: convos.length };
  result.diagSummary = summarizeDiagnostics(diag);
  say(`DIAGNOSTICS: ${JSON.stringify(result.diagSummary)}`);
  say(`F3 RESULT: ${result.f3}`);
} catch (err) {
  say(`F3 ERROR: ${err.stack || err}`);
  result.error = String(err);
  result.diagSummary = summarizeDiagnostics(diag);
} finally {
  const logPath = writeLog("remediation-qa4-f3-log.txt", log);
  writeJson("remediation-qa4-f3-result.json", result);
  say(`LOG: ${logPath}`);
  console.log("JSON_RESULT " + JSON.stringify(result));
  await browser.close();
  process.exitCode = result.f3 === "PASS" ? 0 : 1;
}