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
  createProjectViaUI,
  summarizeDiagnostics,
  writeLog,
  writeJson,
} from "./qa4-lib.mjs";

const log = [];
const say = (s) => { console.log(s); log.push(s); };

const DEMO_TITLE = "The Domain Tower B - Commercial MEP";
const FORBIDDEN = [
  "Electrical & Lighting Systems",
  "Heating, Ventilating & Air Conditioning",
  "Plumbing & Domestic Water Systems",
];

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
  const sel = await selectProjectByTitle(page, "QA-REM-QA4-F2-");
  say(`  SELECT ${tag}: dispatched at t+${Date.now() - t0}ms -> ${JSON.stringify(sel)}`);
  const shots = ["00-immediate", "01-300ms", "02-700ms", "03-1200ms", "04-3000ms"];
  await sample(`${tag} @0ms`, `remediation-qa4-f2-${tag}-${shots[0]}.png`, t0);
  await delay(300);
  await sample(`${tag} @300ms`, `remediation-qa4-f2-${tag}-${shots[1]}.png`, t0);
  await delay(400);
  await sample(`${tag} @700ms`, `remediation-qa4-f2-${tag}-${shots[2]}.png`, t0);
  await delay(500);
  await sample(`${tag} @1200ms`, `remediation-qa4-f2-${tag}-${shots[3]}.png`, t0);
  await delay(1800);
  await sample(`${tag} @3000ms`, `remediation-qa4-f2-${tag}-${shots[4]}.png`, t0);
  return sel;
};

let result = { f2: "FAIL" };
try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);

  // Create a guaranteed-empty QA-REM fixture for the switch target.
  const emptyTitle = `QA-REM-QA4-F2-${Date.now()}`;
  const created = await createProjectViaUI(page, { title: emptyTitle, budget: 2000000, weeks: 52 });
  say(`EMPTY FIXTURE CREATED: ${JSON.stringify(created.waited)} | ${emptyTitle}`);
  await delay(800);

  // Select demo project and wait for its package names to render.
  const pickDemo = await selectProjectByTitle(page, DEMO_TITLE);
  await page.waitForFunction(
    (names) => names.some((n) => document.body.innerText.includes(n)),
    { timeout: 30000 },
    FORBIDDEN
  );
  await delay(800);
  const demoShot = await shot(page, "remediation-qa4-f2-01-demo-packages-loaded.png");
  const demoText = await bodyText(page);
  const demoSelector = await getSelectorState(page);
  say(`DEMO READY: ${JSON.stringify(pickDemo)} | selected=${demoSelector.selectedText} | packagesVisible=${JSON.stringify(FORBIDDEN.filter((f) => demoText.includes(f)))} | ${demoShot}`);

  // Normal-network switch: demo -> empty
  say("BURST A (normal network): demo -> empty QA-REM project");
  await switchBurst("switch-normal");
  await page.waitForFunction(
    () => document.body.innerText.includes("No Trade Packages Configured"),
    { timeout: 20000 }
  );
  const settleNormal = await getSelectorState(page);
  say(`SETTLED A: selected=${settleNormal.selectedText}`);

  // Throttled switch: demo -> empty
  say("BURST B (CDP throttled latency=600ms): demo -> empty QA-REM project");
  await setThrottle(600);
  await selectProjectByTitle(page, DEMO_TITLE);
  await page.waitForFunction(
    (names) => names.some((n) => document.body.innerText.includes(n)),
    { timeout: 30000 },
    FORBIDDEN
  );
  await delay(600);
  await switchBurst("switch-throttled");
  await page.waitForFunction(
    () => document.body.innerText.includes("No Trade Packages Configured"),
    { timeout: 30000 }
  );
  await setThrottle(0);
  say("THROTTLE REMOVED (latency=0)");

  // Reload while empty project selected
  say("BURST C (reload): empty QA-REM project");
  const t1 = Date.now();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await sample("reload @0ms", "remediation-qa4-f2-reload-00-immediate.png", t1);
  await delay(300);
  await sample("reload @300ms", "remediation-qa4-f2-reload-01-300ms.png", t1);
  await delay(500);
  await sample("reload @800ms", "remediation-qa4-f2-reload-02-800ms.png", t1);
  await delay(700);
  await sample("reload @1500ms", "remediation-qa4-f2-reload-03-1500ms.png", t1);
  await delay(1500);
  await sample("reload @3000ms", "remediation-qa4-f2-reload-04-3000ms.png", t1);
  await waitForAppReady(page);
  const reloadSelector = await getSelectorState(page);
  const reloadText = await bodyText(page);
  const reloadShot = await shot(page, "remediation-qa4-f2-reload-05-settled.png");
  say(`SETTLED C: selected=${reloadSelector.selectedText} | emptyState=${reloadText.includes("No Trade Packages Configured")} | ${reloadShot}`);

  const summary = summarizeDiagnostics(diag);
  const anyForbidden = samples.some((s) => s.forbiddenHits.length > 0);
  const settledOk = samples.filter((s) => s.label.includes("@3000ms")).every((s) => s.emptyStateVisible) && reloadText.includes("No Trade Packages Configured");
  const selectedEmptyAfterReload = (reloadSelector.selectedText || "").includes("QA-REM-QA4-F2-");
  const demoStillRich = true;
  const pass = !anyForbidden && settledOk && selectedEmptyAfterReload && demoStillRich && summary.pageErrors.length === 0;

  say(`FORBIDDEN DATA FLASH: ${anyForbidden ? "YES (FAIL)" : "NONE"}`);
  say(`DIAGNOSTICS: ${JSON.stringify(summary)}`);
  say(`F2 RESULT: ${pass ? "PASS" : "FAIL"}`);
  result = {
    f2: pass ? "PASS" : "FAIL",
    emptyTitle,
    samples: samples.map((s) => ({ label: s.label, ms: s.msAtTextRead, forbiddenHits: s.forbiddenHits, emptyStateVisible: s.emptyStateVisible, packagesBadge: s.packagesBadge, bootLoaderVisible: s.bootLoaderVisible, screenshot: s.screenshot })),
    settledSelection: reloadSelector.selectedText,
    diagSummary: summary,
  };
} catch (err) {
  say(`F2 ERROR: ${err.stack || err}`);
  result = { f2: "FAIL", error: String(err), diagSummary: summarizeDiagnostics(diag), samples };
} finally {
  const logPath = writeLog("remediation-qa4-f2-log.txt", log);
  writeJson("remediation-qa4-f2-result.json", result);
  say(`LOG: ${logPath}`);
  console.log("JSON_RESULT " + JSON.stringify(result));
  await browser.close();
  process.exitCode = result.f2 === "PASS" ? 0 : 1;
}