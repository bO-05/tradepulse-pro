import { ConvexHttpClient } from "convex/browser";
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
  summarizeDiagnostics,
  writeLog,
  writeJson,
} from "./qa4-lib.mjs";

const log = [];
const say = (s) => { console.log(s); log.push(s); };
const CLOUD = "https://brainy-skunk-440.convex.cloud";
const TARGET_TITLE = "QA Test Tower - Temporary Audit";

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
say(`F5 TARGET: ${BASE_URL}`);
const page = await browser.newPage();
const diag = attachDiagnostics(page);

let result = { f5: "FAIL", project: TARGET_TITLE };
try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);

  const sel = await selectProjectByTitle(page, TARGET_TITLE);
  say(`SELECT PROJECT: ${JSON.stringify(sel)}`);
  await waitForBodyText(page, [TARGET_TITLE], 15000);
  await delay(800);

  const tab = await clickTab(page, "Bid Leveling");
  say(`LEVELING TAB: ${JSON.stringify(tab)}`);
  const waited = await waitForBodyText(page, ["Leveling Locked", "Adjust Leveling", "No bids"], 25000);
  await delay(1200);
  say(`LEVELING READY: hit="${waited.hit}"`);

  const controls = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const locked = btns
      .filter((b) => (b.textContent || "").trim() === "Leveling Locked")
      .map((b) => ({ text: b.textContent.trim(), disabled: b.disabled, title: b.getAttribute("title") }));
    const adjust = btns
      .filter((b) => (b.textContent || "").trim() === "Adjust Leveling")
      .map((b) => ({ text: b.textContent.trim(), disabled: b.disabled, title: b.getAttribute("title") }));
    return { locked, adjust, totalButtons: btns.length };
  });
  say(`CONTROLS: locked=${JSON.stringify(controls.locked)} adjust=${JSON.stringify(controls.adjust)}`);

  const beforeShot = await shot(page, "remediation-qa4-f5-01-leveling-locked-control.png");
  say(`SHOT BEFORE CLICK: ${beforeShot}`);

  // Attempt to activate the locked control (native click + synthetic) and verify no modal opens.
  const clickAttempt = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Leveling Locked");
    if (!btn) return { found: false };
    const before = document.body.innerText.length;
    btn.click();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return { found: true, disabled: btn.disabled, textBefore: before };
  });
  await delay(1200);
  const modalCheck = await page.evaluate(() => {
    const m = [...document.querySelectorAll("div.fixed")].find((d) => (d.textContent || "").includes("Forensic Leveling Adjustments"));
    return { adjustModalOpen: Boolean(m) };
  });
  const afterText = await bodyText(page);
  const afterShot = await shot(page, "remediation-qa4-f5-02-after-locked-click.png");
  say(`CLICK ATTEMPT: ${JSON.stringify(clickAttempt)} modalAfterClick=${JSON.stringify(modalCheck)} shot=${afterShot}`);

  // Backend confirmation: an executed agreement exists for this project and the locked bid is the awarded one.
  const client = new ConvexHttpClient(CLOUD);
  const projects = await client.query("projects:listProjects", {});
  const proj = projects.find((p) => p.title === TARGET_TITLE);
  let backend = null;
  if (proj) {
    const pkgs = await client.query("tradePackages:listByProject", { projectId: proj._id });
    const ags = await client.query("agreements:listAgreements", { projectId: proj._id });
    const executed = ags.filter((a) => a.status === "executed");
    let awardedBid = null;
    for (const pkg of pkgs) {
      const bids = await client.query("bids:listByPackage", { tradePackageId: pkg._id });
      awardedBid = bids.find((b) => b.isAwarded) || awardedBid;
    }
    backend = {
      projectId: proj._id,
      packages: pkgs.length,
      agreements: ags.map((a) => `${a.agreementNumber}:${a.status}`),
      executedCount: executed.length,
      executedBidId: executed[0]?.bidId ?? null,
      executedSub: executed[0]?.subcontractorName ?? null,
      awardedBidId: awardedBid?._id ?? null,
      awardedSub: awardedBid?.subcontractorName ?? null,
    };
  }
  say(`BACKEND: ${JSON.stringify(backend)}`);

  const lockedOk = controls.locked.length >= 1 && controls.locked.every((b) => b.disabled === true) && controls.locked.every((b) => (b.title || "").toLowerCase().includes("locked"));
  const adjustOthersOk = controls.adjust.length >= 1 && controls.adjust.some((b) => b.disabled === false);
  const noModal = modalCheck.adjustModalOpen === false;
  const diagSummary = summarizeDiagnostics(diag);
  const pass = lockedOk && adjustOthersOk && noModal && Boolean(backend?.executedCount) && backend.executedBidId === backend.awardedBidId && diagSummary.pageErrors.length === 0;
  say(`DIAGNOSTICS: ${JSON.stringify(diagSummary)}`);
  say(`CRITERIA: lockedDisabledAndTitled=${lockedOk} otherAdjustEnabled=${adjustOthersOk} noModal=${noModal} backendExecuted=${backend?.executedCount}`);
  result = { f5: pass ? "PASS" : "FAIL", project: TARGET_TITLE, controls, modalAfterClick: modalCheck, backend, diagSummary };
  say(`F5 RESULT: ${result.f5}`);
} catch (err) {
  say(`F5 ERROR: ${err.stack || err}`);
  result = { f5: "FAIL", error: String(err), diagSummary: summarizeDiagnostics(diag) };
} finally {
  const logPath = writeLog("remediation-qa4-f5-log.txt", log);
  writeJson("remediation-qa4-f5-result.json", result);
  say(`LOG: ${logPath}`);
  console.log("JSON_RESULT " + JSON.stringify(result));
  await browser.close();
  process.exitCode = result.f5 === "PASS" ? 0 : 1;
}