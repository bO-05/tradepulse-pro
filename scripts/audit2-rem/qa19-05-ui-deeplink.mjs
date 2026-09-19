/**
 * QA19-05: A18-02 — deep-link + reload restores the persisted package selection
 * (badge and ribbon unchanged), including a fresh navigation carrying the same URL.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot } from "./lib.mjs";
import { readEvidence, writeEvidence, writeLog } from "./qa19-lib.mjs";

const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${JSON.stringify(detail)}`);
};

const STATE = () => ({
  url: location.href,
  lsPackage: localStorage.getItem("tradepulse.selectedPackageId"),
  lsProject: localStorage.getItem("tradepulse.selectedProjectId"),
  pressedRibbon: [...document.querySelectorAll("button[aria-pressed]")]
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60)),
  packageBadges: [...document.querySelectorAll("button")]
    .map((b) => (b.textContent || "").replace(/\s+/g, " ").trim())
    .filter((t) => /AUDIT-QA19-LIVE/.test(t) && /Subs|Bids/.test(t)),
  betaRows: [...document.querySelectorAll("div,button")]
    .filter((el) => (el.textContent || "").includes("AUDIT-QA19-LIVE Beta Plumbing"))
    .length,
  alphaRows: [...document.querySelectorAll("div,button")]
    .filter((el) => (el.textContent || "").includes("AUDIT-QA19-LIVE Alpha Electrical"))
    .length,
});

async function main() {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  // Deep link with a project id (fresh profile: no stored selection).
  await page.goto(`${BASE}/?project=${F.live.id}&tab=discovery&qa19=deeplink`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await delay(1200);
  const firstLoad = await page.evaluate(STATE);
  say(`first load: ${JSON.stringify(firstLoad)}`);

  // Select Package 02 (Beta Plumbing) via the package switcher.
  const click = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent || "").includes("AUDIT-QA19-LIVE Beta Plumbing")
    );
    if (!b) return { ok: false, avail: [...document.querySelectorAll("button")].map((x) => (x.textContent || "").trim()).slice(0, 40) };
    b.click();
    return { ok: true, text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) };
  });
  say(`select Beta: ${JSON.stringify(click)}`);
  await delay(1800);
  const afterSelect = await page.evaluate(STATE);
  say(`after select: ${JSON.stringify(afterSelect)}`);
  await shot(page, "fix4-qa19-selection-before-reload.png");

  // Reload: selection must survive.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await delay(2500);
  const afterReload = await page.evaluate(STATE);
  say(`after reload: ${JSON.stringify(afterReload)}`);
  await shot(page, "fix4-qa19-selection-after-reload.png");

  // Fresh navigation (deep link again in a new page sharing the profile storage).
  const page2 = await browser.newPage();
  const diag2 = attachDiagnostics(page2);
  await page2.goto(`${BASE}/?project=${F.live.id}&tab=discovery&qa19=deeplink2`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page2, 60000);
  await delay(2000);
  const freshNav = await page2.evaluate(STATE);
  say(`fresh nav: ${JSON.stringify(freshNav)}`);
  await page2.close();

  const betaSelected = (s) =>
    s.pressedRibbon.some((t) => t.includes("Beta Plumbing")) ||
    s.packageBadges.some((t) => t.includes("Beta Plumbing") && /Bids|Subs/.test(t));
  const alphaSelected = (s) =>
    s.pressedRibbon.some((t) => t.includes("Alpha Electrical")) ||
    s.packageBadges.some((t) => t.includes("Alpha Electrical") && /Bids|Subs/.test(t));

  record("A18-02.selection-made", click.ok && betaSelected(afterSelect), {
    click,
    pressedRibbon: afterSelect.pressedRibbon,
    storedPackage: afterSelect.lsPackage,
  });
  record("A18-02.reload-keeps-selection", betaSelected(afterReload) && !alphaSelected(afterReload), {
    pressedRibbon: afterReload.pressedRibbon,
    packageBadges: afterReload.packageBadges,
    storedPackage: afterReload.lsPackage,
  });
  record("A18-02.fresh-nav-keeps-selection", betaSelected(freshNav) && !alphaSelected(freshNav), {
    pressedRibbon: freshNav.pressedRibbon,
    storedPackage: freshNav.lsPackage,
  });
  record("A18-02.stored-id-matches-beta", afterReload.lsPackage === F.live.p2, {
    stored: afterReload.lsPackage,
    expected: F.live.p2,
  });

  out.firstLoad = firstLoad;
  out.afterSelect = afterSelect;
  out.afterReload = afterReload;
  out.freshNav = freshNav;
  out.results = results;
  out.pageErrors = [...diag.pageErrors.slice(0, 3), ...diag2.pageErrors.slice(0, 3)];
  writeEvidence("deeplink", out);
  writeLog("deeplink", log);
  await browser.close();
  console.log(`results: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("deeplink-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});