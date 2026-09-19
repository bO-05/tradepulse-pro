import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog, client, EVIDENCE_DIR } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const STORAGE_BASE = "https://brainy-skunk-440.convex.cloud/api/storage/";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = { cases: [] };

const tmp = path.join("C:", "Users", "user", "AppData", "Local", "Temp", "opencode", "qa18-files");
fs.mkdirSync(tmp, { recursive: true });

const zeroPath = path.join(tmp, "qa18-zero.txt");
fs.writeFileSync(zeroPath, "");
const longName = "QA18-" + "L".repeat(240) + ".txt";
const longDir = "D:\\q18";
fs.mkdirSync(longDir, { recursive: true });
const longPath = path.join(longDir, longName);
fs.writeFileSync(longPath, "QA18 long name content");
const bigPath = path.join(tmp, "qa18-tenmb.txt");
fs.writeFileSync(bigPath, "A".repeat(10 * 1024 * 1024));
const ninePath = path.join(tmp, "qa18-ninemb-spec.txt");
fs.writeFileSync(ninePath, "B".repeat(9 * 1024 * 1024));
const noTextPdfPath = path.join(tmp, "qa18-notext.pdf");
const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n4 0 obj<</Length 0>>stream\nendstream\nendobj\nxref\n0 5\ntrailer<</Size 5/Root 1 0 R>>\n%%EOF\n`;
fs.writeFileSync(noTextPdfPath, pdf);
say(`fixtures: zero=${fs.statSync(zeroPath).size} longNameLen=${longName.length} big=${fs.statSync(bigPath).size} pdf=${fs.statSync(noTextPdfPath).size}`);

async function recordCount(c) {
  const files = await c.query("files:listFilesByProject", { projectId: fx.file.id });
  return files || [];
}

async function main() {
  const c = client();
  const before = await recordCount(c);
  say(`DB file rows before: ${before.length}`);

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const uploads = [];
  page.on("response", async (res) => {
    try {
      if (res.request().method() === "POST" && /upload|storage/i.test(res.url())) {
        const body = await res.text();
        uploads.push({ url: res.url().slice(0, 160), status: res.status(), body: body.slice(0, 300) });
      }
    } catch {}
  });

  await page.goto(`${BASE}/?project=${fx.file.id}&tab=packages&qa18=files`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await delay(1000);

  const fileInput = await page.$('input[type="file"]');
  say(`file input found: ${!!fileInput}`);

  const runCase = async (label, filePath, docType = "blueprint") => {
    await page.evaluate((t) => {
      const sel = document.querySelector('[aria-label="Document type for upload"]');
      if (sel) {
        sel.value = t;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, docType);
    await delay(300);
    const uploadsBefore = uploads.length;
    const rowsBefore = (await recordCount(c)).length;
    const statusSeen = [];
    const poll = (async () => {
      for (let i = 0; i < 40; i++) {
        const t = await page.evaluate(() => {
          const el = [...document.querySelectorAll("p, div, span")].find((x) => /Uploading|Upload failed|Successfully uploaded|Drop upload failed|unsupported|File size|Unsupported/.test(x.textContent || "") && (x.textContent || "").length < 300);
          return el ? (el.textContent || "").trim().slice(0, 250) : null;
        });
        if (t) statusSeen.push(t);
        await delay(300);
      }
    })();
    await fileInput.uploadFile(filePath);
    await Promise.race([poll, delay(13000)]);
    await delay(1500);
    const rowsAfter = await recordCount(c);
    const newUploads = uploads.slice(uploadsBefore);
    let storageProbe = null;
    for (const u of newUploads) {
      try {
        const parsed = JSON.parse(u.body);
        if (parsed.storageId) {
          const r = await fetch(STORAGE_BASE + parsed.storageId);
          storageProbe = { storageId: parsed.storageId, httpStatus: r.status, bytes: (await r.arrayBuffer()).byteLength };
        }
      } catch {}
    }
    const entry = {
      label,
      status: [...new Set(statusSeen)].slice(-4),
      newUploads,
      rowsBefore: rowsBefore.length ?? rowsBefore,
      rowsAfter: rowsAfter.length,
      rowDelta: rowsAfter.length - (rowsBefore.length ?? rowsBefore),
      storageProbe,
      pageErrors: diag.pageErrors.slice(-2),
    };
    say(`[case ${label}] ${JSON.stringify(entry)}`);
    out.cases.push(entry);
    await shot(page, `fix4-qa18-file-${label}.png`);
  };

  await runCase("zero-byte", zeroPath, "spec");
  await runCase("long-filename", longPath);
  await runCase("no-text-pdf", noTextPdfPath);
  await runCase("tenmb-txt", bigPath, "spec");
  await runCase("nineMB-txt-spec", ninePath, "spec");

  const after = await recordCount(c);
  out.summary = { before: before.length, after: after.length, newRows: after.map((f) => ({ id: f._id, name: f.fileName, size: f.fileSize, type: f.fileType, storageId: f.storageId })).slice(0, 10) };
  say(`DB rows after: ${after.length}`);
  out.pageErrors = diag.pageErrors.slice(0, 5);
  writeEvidence("files", out);
  writeLog("files", log);
  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  writeLog("files-crash", [String(e && e.stack ? e.stack : e)]);
  process.exit(1);
});