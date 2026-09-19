import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, delay } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog, client } from "./qa18-lib.mjs";

const fx = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const STORAGE_BASE = "https://brainy-skunk-440.convex.cloud/api/storage/";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = { cases: [] };
const tmp = path.join("C:", "Users", "user", "AppData", "Local", "Temp", "opencode", "qa18-files");
fs.mkdirSync(tmp, { recursive: true });

const longName = "QA18-" + "L".repeat(240) + ".txt";
const longDir = "D:\\q18";
fs.mkdirSync(longDir, { recursive: true });
const longPath = path.join(longDir, longName);
if (!fs.existsSync(longPath)) fs.writeFileSync(longPath, "QA18 long name content");

const c = client();
const rows = async () => ((await c.query("files:listFilesByProject", { projectId: fx.file.id })) || []).length;

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
const cdp = await page.createCDPSession();
await cdp.send("Network.enable");
const posts = new Map();
cdp.on("Network.requestWillBeSent", (e) => {
  if (e.request.method === "POST") posts.set(e.requestId, { url: e.request.url, postLen: (e.request.postData || "").length });
});
cdp.on("Network.responseReceived", (e) => {
  const p = posts.get(e.requestId);
  if (p) p.status = e.response.status;
});
cdp.on("Network.loadingFinished", async (e) => {
  const p = posts.get(e.requestId);
  if (!p || p.body !== undefined) return;
  try {
    const body = await cdp.send("Network.getResponseBody", { requestId: e.requestId });
    p.body = body.body.slice(0, 200);
  } catch (err) {
    p.bodyError = String(err.message).slice(0, 80);
  }
});

await page.evaluateOnNewDocument(() => {
  window.__qa18Net = [];
  const of = window.fetch;
  window.fetch = async (...args) => {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    try {
      const res = await of.apply(window, args);
      window.__qa18Net.push({ kind: "fetch", url: String(url).slice(0, 140), status: res.status, ok: res.ok });
      return res;
    } catch (e) {
      window.__qa18Net.push({ kind: "fetch", url: String(url).slice(0, 140), error: String(e.message) });
      throw e;
    }
  };
  const os = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      const len = typeof data === "string" ? data.length : data.byteLength;
      window.__qa18Net.push({ kind: "ws-send", len });
    } catch {}
    return os.call(this, data);
  };
});

await page.goto(`${BASE}/?project=${fx.file.id}&tab=packages&qa18=fdbg`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitForAppReady(page, 60000);
await delay(800);
const fileInput = await page.$('input[type="file"]');

async function run(label, filePath, docType) {
  await page.evaluate((t) => {
    const sel = document.querySelector('[aria-label="Document type for upload"]');
    sel.value = t;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, docType);
  await page.evaluate(() => { window.__qa18Net = []; });
  const postsBefore = posts.size;
  const rowsBefore = await rows();
  await fileInput.uploadFile(filePath);
  const statusSeen = [];
  for (let i = 0; i < 40; i++) {
    const t = await page.evaluate(() => {
      const el = [...document.querySelectorAll("p, div, span")].find((x) => /Uploading|Upload failed|Successfully uploaded|too large|failed|must use|file size/.test(x.textContent || ""));
      return el ? (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 400) : null;
    });
    if (t) statusSeen.push(t);
    await delay(300);
  }
  await delay(1000);
  const rowsAfter = await rows();
  const net = await page.evaluate(() => window.__qa18Net);
  const newPosts = [...posts.entries()].filter(([id]) => !id.startsWith("__")).map(([, v]) => v).filter((v) => /upload|storage/i.test(v.url));
  const relevant = newPosts.slice(-4);
  let storageProbe = null;
  for (const p of relevant.reverse()) {
    if (p.body && p.body.includes("storageId")) {
      try {
        const storageId = JSON.parse(p.body).storageId;
        const r = await fetch(STORAGE_BASE + storageId);
        storageProbe = { storageId, httpStatus: r.status, bytes: (await r.arrayBuffer()).byteLength };
        break;
      } catch {}
    }
  }
  const entry = {
    label,
    status: [...new Set(statusSeen)].slice(-3),
    rowsBefore,
    rowsAfter,
    rowDelta: rowsAfter - rowsBefore,
    net: net.slice(-8),
    uploads: relevant.map((p) => ({ url: p.url.slice(0, 100), status: p.status, postLen: p.postLen, body: p.body })),
    storageProbe,
  };
  say(`[${label}] ${JSON.stringify(entry)}`);
  out.cases.push(entry);
  await delay(500);
}

// size ladder on spec .txt
for (const mb of [6, 6, 7, 7, 8, 8, 9, 9]) {
  const p = path.join(tmp, `qa18-${mb}mb-spec.txt`);
  fs.writeFileSync(p, "B".repeat(mb * 1024 * 1024));
  await run(`${mb}MB-txt-spec`, p, "spec");
}
await run("long-filename-spec", longPath, "spec");

writeEvidence("files-debug", out);
writeLog("files-debug", log);
await browser.close();
console.log("done");
