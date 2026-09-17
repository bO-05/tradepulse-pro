import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  selectProjectByTitle,
  clickButtonByText,
  bodyText,
  delay,
  writeLog,
  summarizeDiagnostics,
} from "./qa1-lib.mjs";

const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
say(`F5 TARGET: ${BASE_URL}`);

const page = await browser.newPage();
const diag = attachDiagnostics(page);

const controlProbe = () =>
  page.evaluate(() => {
    const nameFor = (btn) => {
      let el = btn;
      for (let i = 0; i < 14 && el; i++) {
        const h = el.querySelector ? el.querySelector("h3") : null;
        if (h && h.textContent.trim()) return h.textContent.trim();
        el = el.parentElement;
      }
      return null;
    };
    const controls = [...document.querySelectorAll("button")]
      .filter((b) => {
        const t = (b.textContent || "").trim();
        return t === "Leveling Locked" || t === "Adjust Leveling" || t === "Adjust";
      })
      .map((b) => ({
        text: (b.textContent || "").trim(),
        disabled: b.disabled,
        title: b.getAttribute("title"),
        cursor: getComputedStyle(b).cursor,
        bidCard: nameFor(b),
      }));
    const dialogues = [...document.querySelectorAll('[role="dialog"]')].map((d) =>
      (d.textContent || "").trim().slice(0, 120)
    );
    return { controls, dialogues };
  });

const openLeveling = async (projectTitle) => {
  const sel = await selectProjectByTitle(page, projectTitle);
  say(`SELECT ${projectTitle}: ${JSON.stringify(sel)}`);
  await delay(1500);
  const tab = await clickButtonByText(page, "Bid Leveling");
  say(`CLICK Bid Leveling tab: ${JSON.stringify(tab)}`);
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("True Leveled Total Cost") ||
      document.body.innerText.includes("Adjust Leveling") ||
      document.body.innerText.includes("Leveling Locked"),
    { timeout: 30000 }
  );
  await delay(800);
};

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);

  // --- Part A: demo project, non-executed agreement ---
  say("PART A: demo project (agreement status=generated, not executed) -> expect Adjust enabled");
  await openLeveling("The Domain Tower B");
  await shot(page, "remediation-qa1-f5-01-demo-leveling.png");
  const demoProbe = await controlProbe();
  say(`DEMO CONTROLS: ${JSON.stringify(demoProbe.controls, null, 2)}`);
  const demoEnabled = demoProbe.controls.filter((c) => c.text === "Adjust Leveling" || c.text === "Adjust");
  const demoAllEnabled = demoEnabled.length > 0 && demoEnabled.every((c) => c.disabled === false);
  say(`DEMO: adjust controls=${demoEnabled.length}, allEnabled=${demoAllEnabled}`);

  // --- Part B: project with an executed agreement ---
  say("PART B: QA Test Tower - Temporary Audit (agreement status=executed) -> expect locked control");
  await openLeveling("QA Test Tower - Temporary Audit");
  await page.waitForFunction(() => document.body.innerText.includes("Pass2 Realtime Bid Sub D"), {
    timeout: 30000,
  });
  const lockedBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.textContent || "").trim() === "Leveling Locked"
    );
    if (!b) return null;
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    return { text: b.textContent.trim(), disabled: b.disabled, title: b.getAttribute("title"), rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  });
  say(`LOCKED CONTROL: ${JSON.stringify(lockedBtn)}`);
  if (lockedBtn) {
    const cx = Math.round(lockedBtn.rect.x + lockedBtn.rect.w / 2);
    const cy = Math.round(lockedBtn.rect.y + lockedBtn.rect.h / 2);
    await page.mouse.move(cx, cy);
    await delay(400);
  }
  await shot(page, "remediation-qa1-f5-02-executed-leveling-locked.png");
  const execProbe = await controlProbe();
  say(`EXECUTED-PROJECT CONTROLS: ${JSON.stringify(execProbe.controls, null, 2)}`);

  // Attempt to click the locked control
  const clickAttempt = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.textContent || "").trim() === "Leveling Locked"
    );
    if (!b) return { clicked: false, reason: "not found" };
    b.click();
    return { clicked: true, disabled: b.disabled };
  });
  await delay(1200);
  await shot(page, "remediation-qa1-f5-03-after-locked-click.png");
  const afterClick = await controlProbe();
  const modalOpened = afterClick.dialogues.some((d) => d.includes("Forensic Leveling Adjustments"));
  const errToast = await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find(
      (d) => d.className && typeof d.className === "string" && d.className.includes("fixed bottom-5 right-5")
    );
    return el ? el.textContent.trim() : null;
  });
  say(`AFTER LOCKED CLICK: modalOpened=${modalOpened} dialogues=${JSON.stringify(afterClick.dialogues)} toast=${JSON.stringify(errToast)}`);

  const summary = summarizeDiagnostics(diag);
  const lockedOk =
    !!lockedBtn &&
    lockedBtn.disabled === true &&
    typeof lockedBtn.title === "string" &&
    lockedBtn.title.toLowerCase().includes("leveling locked") &&
    lockedBtn.title.toLowerCase().includes("executed");
  const pass = demoAllEnabled && lockedOk && !modalOpened;
  say(`F5 CRITERIA: demoEnabled=${demoAllEnabled} lockedControlOk=${lockedOk} noModalOnForcedClick=${!modalOpened} consoleClean=${summary.consoleErrors.length === 0}`);
  say(`F5 RESULT: ${pass ? "PASS" : "FAIL"}`);
  say(`DIAGNOSTICS: ${JSON.stringify(summary)}`);

  const logPath = writeLog("remediation-qa1-f5-log.txt", log);
  say(`LOG: ${logPath}`);
  console.log(
    "JSON_RESULT " +
      JSON.stringify({
        f5: pass ? "PASS" : "FAIL",
        demoControls: demoEnabled,
        demoAllEnabled,
        lockedControl: lockedBtn,
        executedProjectControls: execProbe.controls,
        forcedClick: { ...clickAttempt, modalOpened, toast: errToast },
        diagnostics: summary,
      })
  );
} catch (err) {
  say(`F5 ERROR: ${err && err.stack ? err.stack : err}`);
  const summary = summarizeDiagnostics(diag);
  say(`DIAGNOSTICS AT FAILURE: ${JSON.stringify(summary)}`);
  const logPath = writeLog("remediation-qa1-f5-log.txt", log);
  say(`LOG: ${logPath}`);
  console.log("JSON_RESULT " + JSON.stringify({ f5: "FAIL", diagnostics: summary, error: String(err) }));
  process.exitCode = 1;
} finally {
  await browser.close();
}