import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  getSelectorState,
  selectProjectByTitle,
  bodyText,
  delay,
  waitForBodyText,
  clickTab,
  clickButtonByText,
  createProjectViaUI,
  summarizeDiagnostics,
  writeLog,
  writeJson,
  fixtureTxt,
  EVIDENCE_DIR,
} from "./qa4-lib.mjs";

const log = [];
const say = (s) => { console.log(s); log.push(s); };
const CLOUD = "https://brainy-skunk-440.convex.cloud";

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
say(`F3/F4 TARGET: ${BASE_URL}`);
const page = await browser.newPage();
const diag = attachDiagnostics(page);

const stamp = Date.now();
const title = `QA-REM-QA4-F3F4-${stamp}`;
const uploadName = `QA-REM-QA4-F4-upload-${stamp}.txt`;
const fixturePath = fixtureTxt(uploadName, `QA-REM QA4 live upload verification payload ${stamp}. CSI Division 26 electrical scope text for upload test.`);
say(`PROJECT: ${title}`);
say(`UPLOAD FILE: ${uploadName} | fixture=${fixturePath}`);

let result = { f3: "FAIL", f4: "FAIL", title };

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  const created = await createProjectViaUI(page, { title, budget: 2750000, weeks: 40 });
  say(`CREATE: ${JSON.stringify(created.waited)}`);
  await delay(800);

  const client = new ConvexHttpClient(CLOUD);
  const projects = await client.query("projects:listProjects", {});
  const proj = projects.find((p) => p.title === title);
  if (!proj) throw new Error("project not found in backend after UI create");
  const projectId = proj._id;
  say(`BACKEND PROJECT: ${projectId}`);

  // Pre-check: zero pending RFIs / zero packages
  const pkgsBefore = await client.query("tradePackages:listByProject", { projectId });
  say(`PRE-ADDENDUM packages=${pkgsBefore.length} (implies zero conversations/RFIs)`);

  // ---------- F3: Legal Addendum via UI ----------
  const tab = await clickTab(page, "Pre-Bid Q&A");
  say(`QNA TAB: ${JSON.stringify(tab)}`);
  const qnaReady = await waitForBodyText(page, ["Issue Legal Addendum NO. 01", "No active project"], 20000);
  say(`QNA READY: ${JSON.stringify(qnaReady)}`);
  await delay(500);
  const qnaShot = await shot(page, "remediation-qa4-f3-01-qna-zero-pending.png");
  const qnaText = await bodyText(page);
  say(`QNA STATE: escalatedBanner=${qnaText.includes("Require PM Certification")} queue0=${qnaText.includes("PM Review Queue (0)")} shot=${qnaShot}`);

  const t0 = Date.now();
  const clicked = await clickButtonByText(page, "Issue Legal Addendum NO. 01");
  say(`ADDENDUM CLICK: ${JSON.stringify(clicked)} at t0`);
  const addendumWait = await waitForBodyText(
    page,
    ["Successfully Issued & Filed", "Addendum generation failed", "PM certification is required"],
    90000
  );
  const durationMs = Date.now() - t0;
  await delay(800);
  const addendumShot = await shot(page, "remediation-qa4-f3-02-addendum-result.png");
  const afterText = await bodyText(page);
  const downloadHref = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((x) => (x.textContent || "").includes("Download Addendum"));
    return a ? a.getAttribute("href") : null;
  });
  say(`ADDENDUM WAIT: hit="${addendumWait.hit}" elapsed=${durationMs}ms shot=${addendumShot} downloadHref=${downloadHref ? downloadHref.slice(0, 90) + "..." : null}`);
  say(`ADDENDUM BANNER TEXT PRESENT: issued=${afterText.includes("Successfully Issued & Filed")} failed=${afterText.includes("Addendum generation failed")}`);

  // Backend persisted record + storage id
  const filesAfterAddendum = await client.query("files:listFilesByProject", { projectId });
  const addendumFile = filesAfterAddendum.find((f) => f.fileType === "addendum");
  const addendumStorageId = addendumFile?.storageId ?? null;
  let downloadStatus = null;
  let downloadBodyHead = null;
  if (addendumFile?.url) {
    const resp = await fetch(addendumFile.url);
    downloadStatus = resp.status;
    downloadBodyHead = (await resp.text()).slice(0, 120);
  }
  say(`F3 BACKEND: addendumFile=${addendumFile ? addendumFile.fileName : "MISSING"} storageId=${addendumStorageId} urlHttp=${downloadStatus} bodyHead=${JSON.stringify(downloadBodyHead)}`);

  const f3pass =
    addendumWait.hit === "Successfully Issued & Filed" &&
    Boolean(addendumFile) &&
    Boolean(addendumStorageId) &&
    downloadStatus === 200 &&
    (downloadBodyHead || "").includes("ADDENDUM NO. 01");
  result.f3 = f3pass ? "PASS" : "FAIL";
  result.f3detail = { durationMs, addendumStorageId, fileName: addendumFile?.fileName, downloadStatus, downloadBodyHead };

  // ---------- F4: TXT upload via UI ----------
  const tab2 = await clickTab(page, "CSI Scoping");
  say(`PACKAGES TAB: ${JSON.stringify(tab2)}`);
  const filesReady = await waitForBodyText(page, ["Convex File Storage", "Upload to Convex Storage"], 20000);
  say(`FILES READY: ${JSON.stringify(filesReady)}`);
  await delay(500);

  const selectSet = await page.evaluate(() => {
    const sels = [...document.querySelectorAll("select")];
    const sel = sels.find((s) => [...s.options].some((o) => o.textContent.includes("CSI Specification PDF")));
    if (!sel) return { ok: false, available: sels.map((s) => [...s.options].map((o) => o.textContent.trim())) };
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(sel, "spec");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: sel.value };
  });
  say(`FILE CATEGORY SELECT: ${JSON.stringify(selectSet)}`);

  const fileInput = await page.$("#convex-file-upload");
  if (!fileInput) throw new Error("file input #convex-file-upload not found");
  await fileInput.uploadFile(fixturePath);
  say(`UPLOAD DISPATCHED: ${uploadName}`);
  const uploadWait = await waitForBodyText(page, ["Successfully uploaded", "Upload failed"], 60000);
  await delay(1200);
  const uploadShot = await shot(page, "remediation-qa4-f4-01-upload-success.png");
  const uploadText = await bodyText(page);
  say(`UPLOAD WAIT: hit="${uploadWait.hit}" listed=${uploadText.includes(uploadName)} shot=${uploadShot}`);

  // Reload and re-select the project to prove persistence
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page, 45000);
  await delay(1200);
  const sel = await selectProjectByTitle(page, title);
  say(`POST-RELOAD SELECT: ${JSON.stringify(sel)}`);
  const reloadWait = await waitForBodyText(page, [uploadName, "No Trade Packages Configured"], 25000);
  await delay(800);
  const reloadText = await bodyText(page);
  const reloadShot = await shot(page, "remediation-qa4-f4-02-after-reload-file-listed.png");
  say(`POST-RELOAD: waitHit="${reloadWait.hit}" listedAfterReload=${reloadText.includes(uploadName)} shot=${reloadShot}`);

  const filesAfterReload = await client.query("files:listFilesByProject", { projectId });
  const txtFile = filesAfterReload.find((f) => f.fileName === uploadName);
  let txtHttp = null;
  let txtBodyHead = null;
  if (txtFile?.url) {
    const r2 = await fetch(txtFile.url);
    txtHttp = r2.status;
    txtBodyHead = (await r2.text()).slice(0, 80);
  }
  say(`F4 BACKEND: file=${txtFile ? txtFile.fileName : "MISSING"} type=${txtFile?.fileType} size=${txtFile?.fileSize} urlHttp=${txtHttp} bodyHead=${JSON.stringify(txtBodyHead)}`);

  const f4pass = uploadWait.hit === "Successfully uploaded" && uploadText.includes(uploadName) && reloadText.includes(uploadName) && Boolean(txtFile) && txtHttp === 200;
  result.f4 = f4pass ? "PASS" : "FAIL";
  result.f4detail = { fileName: uploadName, uploadHit: uploadWait.hit, listedAfterReload: reloadText.includes(uploadName), storageId: txtFile?.storageId, urlHttp: txtHttp, size: txtFile?.fileSize };

  const diagSummary = summarizeDiagnostics(diag);
  say(`DIAGNOSTICS: ${JSON.stringify(diagSummary)}`);
  result.diagSummary = diagSummary;
  result.projectId = projectId;
  say(`F3 RESULT: ${result.f3} | F4 RESULT: ${result.f4}`);
} catch (err) {
  say(`F3F4 ERROR: ${err.stack || err}`);
  result.error = String(err);
  result.diagSummary = summarizeDiagnostics(diag);
} finally {
  const logPath = writeLog("remediation-qa4-f3f4-log.txt", log);
  writeJson("remediation-qa4-f3f4-result.json", result);
  say(`LOG: ${logPath}`);
  console.log("JSON_RESULT " + JSON.stringify(result));
  await browser.close();
  process.exitCode = result.f3 === "PASS" && result.f4 === "PASS" ? 0 : 1;
}