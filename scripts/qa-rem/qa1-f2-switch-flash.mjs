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
  writeLog,
  summarizeDiagnostics,
} from "./qa1-lib.mjs";

const DEMO_TITLE = "The Domain Tower B";
const EMPTY_PREFIX = "QA-REM-UI-";
const FORBIDDEN = [
  "Electrical & Lighting Systems",
  "Heating, Ventilating & Air Conditioning",
  "Plumbing & Domestic Water Systems",
];
const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
say(`F2 TARGET: ${BASE_URL}`);

const page = await browser.newPage();
const diag = attachDiagnostics(page);
const cdp = await page.createCDPSession();
await cdp.send("Network.enable");

const samples = [];
async function sample(label, shotName, t0) {
  const textAt = Date.now();
  const text = await bodyText(page);
  const readDone = Date.now();
  const p = await shot(page, shotName);
  const s = {
    label,
    msAtTextRead: textAt - t0,
    msAtScreenshotDone: Date.now() - t0,
    readMs: readDone - textAt,
    screenshot: p,
    forbiddenHits: FORBIDDEN.filter((f) => text.includes(f)),
    emptyStateVisible: text.includes("No Trade Packages Configured"),
    packagesBadge: (text.match(/(\d+)\s*Pkgs/) || [])[1] ?? null,
    bootLoaderVisible: text.includes("Connecting to Convex reactive backend"),
  };
  samples.push(s);
  say(`  SAMPLE ${label}: t+${s.msAtTextRead}ms text / t+${s.msAtScreenshotDone}ms shot | forbiddenHits=${JSON.stringify(s.forbiddenHits)} emptyState=${s.emptyStateVisible} pkgsBadge=${s.packagesBadge} bootLoader=${s.bootLoaderVisible} | ${p}`);
  return s;
}

const setThrottle = async (latency) => {
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency,
    downloadThroughput: latency > 0 ? 2_000_000 : -1,
    uploadThroughput: latency > 0 ? 1_000_000 : -1,
  });
};

const switchBurst = async (tag) => {
  const t0 = Date.now();
  const sel = await selectProjectByTitle(page, EMPTY_PREFIX);
  say(`  SELECT ${tag}: dispatched at t+${Date.now() - t0}ms -> ${JSON.stringify(sel)}`);
  await sample(`${tag} @0ms`, `remediation-qa1-f2-${tag}-00-immediate.png`, t0);
  await delay(300);
  await sample(`${tag} @300ms`, `remediation-qa1-f2-${tag}-01-300ms.png`, t0);
  await delay(400);
  await sample(`${tag} @700ms`, `remediation-qa1-f2-${tag}-02-700ms.png`, t0);
  await delay(500);
  await sample(`${tag} @1200ms`, `remediation-qa1-f2-${tag}-03-1200ms.png`, t0);
  await delay(1800);
  await sample(`${tag} @3000ms`, `remediation-qa1-f2-${tag}-04-3000ms.png`, t0);
  return sel;
};

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);

  // 1. Select the demo project (has 3 trade packages) and wait for its package names to render.
  const pickDemo = await selectProjectByTitle(page, DEMO_TITLE);
  await page.waitForFunction(
    (names) => names.some((n) => document.body.innerText.includes(n)),
    { timeout: 30000 },
    FORBIDDEN
  );
  await delay(800);
  const demoShot = await shot(page, "remediation-qa1-f2-01-demo-packages-loaded.png");
  const demoText = await bodyText(page);
  const demoSelector = await getSelectorState(page);
  say(
    `DEMO PROJECT READY: ${JSON.stringify(pickDemo)} | selected=${demoSelector.selectedText} | packagesVisible=${JSON.stringify(FORBIDDEN.filter((f) => demoText.includes(f)))} | ${demoShot}`
  );

  // 2. Find the empty QA-REM target from the selector.
  const opt = demoSelector.options.find((o) => o.text.includes(EMPTY_PREFIX));
  if (!opt) throw new Error("No QA-REM-* project option found in selector");
  say(`EMPTY TARGET: ${opt.text} | id=${opt.value}`);

  // 3. Normal-network switch burst (demo -> empty).
  say("BURST A (normal network): demo -> empty QA-REM project");
  await switchBurst("switch-normal");

  // confirm settling
  await page.waitForFunction(
    () => document.body.innerText.includes("No Trade Packages Configured"),
    { timeout: 20000 }
  );
  const settleNormal = await getSelectorState(page);
  say(`SETTLED A: selected=${settleNormal.selectedText}`);

  // 4. Throttled switch burst (hardened: 600ms added latency), demo -> empty.
  say("BURST B (CDP throttled latency=600ms): demo -> empty QA-REM project");
  await setThrottle(600);
  await selectProjectByTitle(page, DEMO_TITLE);
  await page.waitForFunction(
    (names) => names.some((n) => document.body.innerText.includes(n)),
    { timeout: 30000 },
    FORBIDDEN
  );
  await delay(500);
  await switchBurst("switch-throttled");
  await page.waitForFunction(
    () => document.body.innerText.includes("No Trade Packages Configured"),
    { timeout: 30000 }
  );
  await setThrottle(0);
  say("THROTTLE REMOVED (latency=0)");

  // 5. Reload on the empty project (unthrottled) with burst.
  say("BURST C (reload): empty QA-REM project");
  const t1 = Date.now();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await sample("reload @0ms", "remediation-qa1-f2-reload-00-immediate.png", t1);
  await delay(300);
  await sample("reload @300ms", "remediation-qa1-f2-reload-01-300ms.png", t1);
  await delay(500);
  await sample("reload @800ms", "remediation-qa1-f2-reload-02-800ms.png", t1);
  await delay(700);
  await sample("reload @1500ms", "remediation-qa1-f2-reload-03-1500ms.png", t1);
  await delay(1500);
  await sample("reload @3000ms", "remediation-qa1-f2-reload-04-3000ms.png", t1);
  await waitForAppReady(page);
  const reloadSelector = await getSelectorState(page);
  const reloadText = await bodyText(page);
  const reloadShot = await shot(page, "remediation-qa1-f2-reload-05-settled.png");
  say(
    `SETTLED C: selected=${reloadSelector.selectedText} | emptyState=${reloadText.includes("No Trade Packages Configured")} | ${reloadShot}`
  );

  const summary = summarizeDiagnostics(diag);
  const anyForbidden = samples.some((s) => s.forbiddenHits.length > 0);
  const settledOk =
    samples.filter((s) => s.label.includes("@3000ms")).every((s) => s.emptyStateVisible) &&
    reloadText.includes("No Trade Packages Configured");
  const selectedEmptyAfterReload = reloadSelector.selectedText.includes(EMPTY_PREFIX);
  const consoleClean = summary.consoleErrors.length === 0 && summary.pageErrors.length === 0;

  say(`FORBIDDEN DATA FLASH: ${anyForbidden ? "YES (FAIL)" : "NONE (PASS)"}`);
  say(`CONSOLE DIAGNOSTICS: ${JSON.stringify(summary)}`);
  say(
    `CRITERIA: anyForbidden=${anyForbidden} settledEmpty=${settledOk} reloadOnEmpty=${selectedEmptyAfterReload} consoleClean=${consoleClean}`
  );

  const pass = !anyForbidden && settledOk && selectedEmptyAfterReload && consoleClean;
  say(`F2 RESULT: ${pass ? "PASS" : "FAIL"}`);

  const logPath = writeLog("remediation-qa1-f2-log.txt", log);
  say(`LOG: ${logPath}`);
  console.log(
    "JSON_RESULT " +
      JSON.stringify({
        f2: pass ? "PASS" : "FAIL",
        emptyTarget: opt.text,
        samples: samples.map((s) => ({
          label: s.label,
          ms: s.msAtTextRead,
          forbiddenHits: s.forbiddenHits,
          emptyStateVisible: s.emptyStateVisible,
          packagesBadge: s.packagesBadge,
          bootLoaderVisible: s.bootLoaderVisible,
          screenshot: s.screenshot,
        })),
        settledSelection: reloadSelector.selectedText,
        diagnostics: summary,
      })
  );
} catch (err) {
  say(`F2 ERROR: ${err && err.stack ? err.stack : err}`);
  const summary = summarizeDiagnostics(diag);
  say(`DIAGNOSTICS AT FAILURE: ${JSON.stringify(summary)}`);
  const logPath = writeLog("remediation-qa1-f2-log.txt", log);
  say(`LOG: ${logPath}`);
  console.log(
    "JSON_RESULT " + JSON.stringify({ f2: "FAIL", samples, diagnostics: summary, error: String(err) })
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}