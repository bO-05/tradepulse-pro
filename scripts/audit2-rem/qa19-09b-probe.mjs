/** QA19-09b: debug project-switch package selection. */
import { launchBrowser, waitForAppReady, delay, attachDiagnostics } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa19-lib.mjs";

const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const c = client();
  const simPackages = (await c.query("tradePackages:listByProject", { projectId: F.sim.id })) || [];
  say(`backend SIM packages: ${simPackages.map((p) => `${p._id}:${p.tradeName}:${p.status}`).join(", ")}`);

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${F.live.id}&tab=discovery&qa19=dbg`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(1500);
  const before = await page.evaluate(() => ({
    selectedProject: localStorage.getItem("tradepulse.selectedProjectId"),
    selectedPackage: localStorage.getItem("tradepulse.selectedPackageId"),
    header: document.body.innerText.slice(0, 200).replace(/\s+/g, " "),
  }));
  say(`before: ${JSON.stringify(before)}`);

  const changed = await page.evaluate((projId) => {
    const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
    if (!sel) return { ok: false };
    const opt = [...sel.options].find((o) => o.value === projId);
    if (!opt) return { ok: false, options: [...sel.options].map((o) => o.value) };
    sel.value = projId;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: sel.value };
  }, F.sim.id);
  say(`changed: ${JSON.stringify(changed)}`);
  for (const wait of [1000, 2000, 3000, 5000]) {
    await delay(wait >= 5 ? 0 : 1000);
    const s = await page.evaluate(() => ({
      selectedProject: localStorage.getItem("tradepulse.selectedProjectId"),
      selectedPackage: localStorage.getItem("tradepulse.selectedPackageId"),
      pressed: [...document.querySelectorAll("button[aria-pressed]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60)),
      hasSimText: document.body.innerText.includes("AUDIT-QA19-SIM Electrical"),
      loading: document.body.innerText.includes("Loading trade packages"),
      head: document.body.innerText.split("\n").slice(0, 14).join(" | ").slice(0, 300),
    }));
    say(`t+${wait}: ${JSON.stringify(s)}`);
    await delay(900);
  }
  const out = { before, changed, diag: diag.pageErrors.slice(0, 5) };
  writeEvidence("hunt-probe", out);
  writeLog("hunt-probe", log);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  writeLog("hunt-probe-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});