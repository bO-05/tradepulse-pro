/**
 * QA9 J5b: file row button inventory, download capture (blob + saved file), delete flow.
 * Evidence: evidence/fix4-qa9-j5b-*.json
 */
import fs from "node:fs";
import path from "node:path";
import { client, launchBrowser, attachDiagnostics, diagnosticsSummary, waitForAppReady, delay, selectProjectByTitle, clickByText, shot, writeEvidence, EVIDENCE_DIR, FIXTURE_TAG } from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J5-FILES`;
const proj = (await c.query("projects:listProjects", {})).find((p) => p.title === PROJECT);
const result = { journey: "J5b", data: {} };
const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
const dlDir = path.join(EVIDENCE_DIR, "fix4-qa9-j5-downloads");
fs.mkdirSync(dlDir, { recursive: true });

try {
  await page.evaluateOnNewDocument(() => {
    window.__qa9Blobs = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = (blob) => { const u = orig.call(URL, blob); window.__qa9Blobs.push({ url: u, size: blob && blob.size, type: blob && blob.type }); return u; };
  });
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, PROJECT);
  await delay(1500);
  await page.keyboard.press("Digit1");
  await page.waitForSelector('select[aria-label="Document type for upload"]', { timeout: 15000 });
  await delay(800);
  result.data.rows = await page.evaluate(() => {
    const names = ["QA9_J5_Spec.txt", "QA9_J5_Quote.txt"];
    return names.map((n) => {
      const rows = [...document.querySelectorAll("div")].filter((d) => (d.textContent || "").includes(n) && d.querySelector("button")).sort((a, b) => a.textContent.length - b.textContent.length);
      const row = rows[0];
      return row ? { name: n, buttons: [...row.querySelectorAll("button")].map((b) => `${(b.textContent || "").trim()}|${b.getAttribute("title") || ""}`), text: row.textContent.slice(0, 160) } : { name: n, row: null };
    });
  });
  const cdp = await page.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir, eventsEnabled: true });
  cdp.on("Browser.downloadWillBegin", (e) => { result.data.downloadBegin = result.data.downloadBegin || []; result.data.downloadBegin.push(e.suggestedFilename); });
  cdp.on("Browser.downloadProgress", (e) => { result.data.downloadProgress = result.data.downloadProgress || []; result.data.downloadProgress.push(e.state); });

  for (const name of ["QA9_J5_Spec.txt", "QA9_J5_Quote.txt"]) {
    const click = await page.evaluate((n) => {
      const rows = [...document.querySelectorAll("div")].filter((d) => (d.textContent || "").includes(n) && d.querySelector('button[title="Download file from Convex Storage"]')).sort((a, b) => a.textContent.length - b.textContent.length);
      const row = rows[0];
      if (!row) return false;
      row.querySelector('button[title="Download file from Convex Storage"]').click();
      return true;
    }, name);
    await delay(3000);
    result.data[`click_${name}`] = click;
  }
  await delay(2000);
  result.data.blobs = await page.evaluate(() => (window.__qa9Blobs || []).map((b) => b.size));
  result.data.downloadedFiles = fs.readdirSync(dlDir);
  const specFile = fs.existsSync(path.join(dlDir, "QA9_J5_Spec.txt")) ? fs.readFileSync(path.join(dlDir, "QA9_J5_Spec.txt"), "utf8") : null;
  result.data.specDownload = specFile ? { bytes: specFile.length, hasConcrete: specFile.includes("CAST-IN-PLACE CONCRETE") } : null;
  result.data.quoteDownload = fs.existsSync(path.join(dlDir, "QA9_J5_Quote.txt")) ? fs.readFileSync(path.join(dlDir, "QA9_J5_Quote.txt"), "utf8").slice(0, 100) : null;

  const delOpen = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("div")].filter((d) => (d.textContent || "").includes("QA9_J5_Quote.txt") && d.querySelector('button[title="Delete file from storage"]')).sort((a, b) => a.textContent.length - b.textContent.length);
    const row = rows[0];
    if (!row) return false;
    row.querySelector('button[title="Delete file from storage"]').click();
    return true;
  });
  result.data.delOpen = delOpen;
  await delay(800);
  result.data.dialog = await page.evaluate(() => {
    const t = document.body.innerText;
    const btns = [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter((x) => /Delete file/i.test(x));
    return { hasDialog: /Delete file\?/.test(t), buttons: btns };
  });
  const confirmed = await clickByText(page, "Delete file", { exact: true });
  result.data.confirmed = confirmed;
  await delay(3000);
  const files = await c.query("files:listFilesByProject", { projectId: proj._id });
  result.data.remaining = files.map((f) => f.fileName);
  await shot(page, "fix4-qa9-j5b.png");
  result.console = diagnosticsSummary(diag);
} catch (err) {
  result.crash = String(err?.message ?? err);
} finally {
  writeEvidence("j5b-files", result);
  await browser.close();
}
console.log(JSON.stringify(result.data, null, 1).slice(0, 2500));