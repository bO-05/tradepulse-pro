import { ConvexHttpClient } from "convex/browser";
import { launchBrowser, attachDiagnostics, waitForAppReady, selectProjectByTitle, shot, writeJson, delay } from "./lib.mjs";
import fs from "node:fs";

const c = new ConvexHttpClient(process.env.REM_CONVEX_URL || "https://brainy-skunk-440.convex.cloud");
const DOWNLOAD_DIR = "C:/Users/user/AppData/Local/Temp/opencode/qa3-downloads2";
const FIX_A = "AUDIT-QA3-fixture-2026-09-18";

const run = async () => {
  fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const out = { events: [] };
  const { browser } = await launchBrowser(1600, 1000);
  const page = await browser.newPage();
  attachDiagnostics(page);
  const bcdp = await browser.target().createCDPSession();
  const pcdp = await page.createCDPSession();
  await bcdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOAD_DIR, eventsEnabled: true });
  await pcdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOAD_DIR });
  bcdp.on("Browser.downloadWillBegin", (e) => out.events.push({ ev: "willBegin", file: e.suggestedFilename }));
  bcdp.on("Browser.downloadProgress", (e) => out.events.push({ ev: "progress", state: e.state }));
  await page.goto(process.env.REM_BASE_URL || "https://brainy-skunk-440.convex.site", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, FIX_A);
  await delay(1500);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:"))?.click());
  await delay(1200);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("24 00 00"))?.click());
  await delay(1000);
  // patch to observe createObjectURL/revokeObjectURL ordering
  out.patch = await page.evaluate(() => {
    window.__qa3 = { created: [], revoked: [], clicked: 0 };
    const origCreate = URL.createObjectURL.bind(URL);
    const origRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      const u = origCreate(b);
      window.__qa3.created.push({ url: u, type: b.type, size: b.size });
      return u;
    };
    URL.revokeObjectURL = (u) => {
      window.__qa3.revoked.push({ url: u, t: Date.now() });
      return origRevoke(u);
    };
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        window.__qa3.clicked += 1;
        window.__qa3.lastDownload = this.download;
        window.__qa3.hrefPrefix = (this.href || "").slice(0, 20);
        window.__qa3.revokeBeforeDownloadSettled = window.__qa3.revoked.length; // snapshots
        // capture blob text now
        if (this.href && this.href.startsWith("blob:")) {
          window.__qa3.capturedText = null;
          fetch(this.href).then((r) => r.text()).then((t) => { window.__qa3.capturedText = t; }).catch(() => {});
        }
      }
      return origClick.call(this);
    };
    return true;
  });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Export Leveling CSV"))?.click());
  await delay(2000);
  out.qa3 = await page.evaluate(() => window.__qa3);
  out.beforeRevoke = out.qa3?.capturedText ? "captured" : "not-captured";
  const files = fs.readdirSync(DOWNLOAD_DIR);
  out.files = files;
  if (files.length) out.bytes = fs.readFileSync(`${DOWNLOAD_DIR}/${files[0]}`).toString("utf8");
  await shot(page, "fix4-qa3-04b-export-probe.png");
  writeJson("fix4-qa3-04b-export-probe.json", out);
  console.log(JSON.stringify({ events: out.events, files: out.files, qa3: out.qa3 ? { created: out.qa3.created, revoked: out.qa3.revoked, clicked: out.qa3.clicked, lastDownload: out.qa3.lastDownload, capturedLen: (out.qa3.capturedText || "").length, capturedHead: (out.qa3.capturedText || "").slice(0, 120) } : null }, null, 2));
  await browser.close();
};
run().catch((e) => { console.error("ERR", e && e.stack ? e.stack : e); process.exit(1); });