import { ConvexHttpClient } from "convex/browser";
import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  selectProjectByTitle,
  bodyText,
  delay,
  waitForBodyText,
  clickTab,
  clickButtonByText,
  summarizeDiagnostics,
  writeLog,
  writeJson,
} from "./qa4-lib.mjs";

const log = [];
const say = (s) => { console.log(s); log.push(s); };
const CLOUD = "https://brainy-skunk-440.convex.cloud";
const UI_PROJECT = "QA-REM-QA4-F1-";

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
say(`ERR TARGET: ${BASE_URL}`);
const page = await browser.newPage();
const diag = attachDiagnostics(page);

function describeError(err) {
  return {
    name: err?.name ?? null,
    constructorName: err?.constructor?.name ?? null,
    message: err?.message ?? null,
    data: err?.data === undefined ? undefined : typeof err.data === "string" ? err.data : JSON.stringify(err.data).slice(0, 500),
  };
}

let result = { err: "FAIL" };
try {
  // ---------- A. Backend direct invalid calls ----------
  const client = new ConvexHttpClient(CLOUD);
  const projects = await client.query("projects:listProjects", {});
  const target = projects.find((p) => p.title.startsWith(UI_PROJECT));
  if (!target) throw new Error("UI target project not found");
  result.projectId = target._id;
  const pkgsBefore = await client.query("tradePackages:listByProject", { projectId: target._id });
  say(`BACKEND TARGET: ${target.title} (${target._id}) packages=${pkgsBefore.length}`);

  let badCsi = null;
  try {
    await client.mutation("tradePackages:createTradePackage", {
      projectId: target._id,
      csiDivision: "99xx",
      tradeName: "QA ERR Bad CSI",
      budgetEstimate: 100000,
      scopeSummary: "QA error readability probe.",
      mandatoryInclusions: ["QA inclusion"],
      bidDeadline: "2026-10-31",
    });
    badCsi = { unexpected: "mutation succeeded" };
  } catch (err) {
    badCsi = describeError(err);
  }
  say(`BACKEND BAD CSI: ${JSON.stringify(badCsi)}`);

  let pastDeadline = null;
  try {
    await client.mutation("tradePackages:createTradePackage", {
      projectId: target._id,
      csiDivision: "27 00 00",
      tradeName: "QA ERR Past Deadline",
      budgetEstimate: 100000,
      scopeSummary: "QA error readability probe.",
      mandatoryInclusions: ["QA inclusion"],
      bidDeadline: "2020-01-01",
    });
    pastDeadline = { unexpected: "mutation succeeded" };
  } catch (err) {
    pastDeadline = describeError(err);
  }
  say(`BACKEND PAST DEADLINE: ${JSON.stringify(pastDeadline)}`);

  const csiReadable = /CSI division must use the format/i.test(badCsi?.message || "") || /CSI division must use the format/i.test(badCsi?.data || "");
  const deadlineReadable = /Bid deadline cannot be in the past/i.test(pastDeadline?.message || "") || /Bid deadline cannot be in the past/i.test(pastDeadline?.data || "");
  const notGenericCsi = !/Server Error/.test(badCsi?.message || "") || csiReadable;
  const notGenericDeadline = !/Server Error/.test(pastDeadline?.message || "") || deadlineReadable;
  say(`BACKEND READABILITY: csiReadable=${csiReadable} deadlineReadable=${deadlineReadable}`);

  // ---------- B. UI invalid package create ----------
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, UI_PROJECT);
  await waitForBodyText(page, [UI_PROJECT], 20000);
  await delay(800);
  const tab = await clickTab(page, "CSI Scoping");
  say(`PACKAGES TAB: ${JSON.stringify(tab)}`);
  await waitForBodyText(page, ["Create Trade Package"], 20000);
  await delay(400);

  const open = await clickButtonByText(page, "Create Trade Package", { exact: true });
  say(`PACKAGE MODAL OPEN: ${JSON.stringify(open)}`);
  await delay(500);

  async function uiCreatePackageAttempt({ csi, name, scope, deadline, stripAttrs }) {
    return page.evaluate(
      (vals) => {
        const dialogs = [...document.querySelectorAll("div.fixed")];
        const dlg = dialogs.find((d) => (d.textContent || "").includes("Create CSI Trade Package"));
        if (!dlg) return { ok: false, reason: "modal missing" };
        const inputs = [...dlg.querySelectorAll("input")];
        const tas = [...dlg.querySelectorAll("textarea")];
        const proto = HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        const taSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        if (vals.stripAttrs) {
          inputs[0].removeAttribute("pattern");
          const dateInput = inputs.find((i) => i.type === "date");
          if (dateInput) dateInput.removeAttribute("min");
        }
        const set = (el, v) => {
          const s = el instanceof HTMLTextAreaElement ? taSetter : setter;
          s.call(el, v);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        set(inputs[0], vals.csi);
        set(inputs[1], vals.name);
        set(inputs[2], "100000");
        set(tas[0], vals.scope);
        set(tas[1], "QA inclusion one");
        const dateInput = inputs.find((i) => i.type === "date");
        if (dateInput) set(dateInput, vals.deadline);
        return { ok: true, csi: inputs[0].value, deadline: dateInput ? dateInput.value : null, validityCsi: inputs[0].checkValidity() };
      },
      { csi, name, scope, deadline, stripAttrs }
    );
  }

  // B1: bad CSI
  const fill1 = await uiCreatePackageAttempt({ csi: "99xx", name: "QA ERR UI Bad CSI", scope: "QA UI error probe.", deadline: "2026-10-31", stripAttrs: true });
  say(`UI FILL B1: ${JSON.stringify(fill1)}`);
  await delay(200);
  const submit1 = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll("div.fixed")].find((d) => (d.textContent || "").includes("Create CSI Trade Package"));
    const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Create Package");
    btn.click();
    return { ok: true };
  });
  const errWait1 = await waitForBodyText(page, ["CSI division must use the format", "already exists", "Error creating package", "Server Error"], 25000);
  await delay(600);
  const uiErr1 = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll("div.fixed")].find((d) => (d.textContent || "").includes("Create CSI Trade Package"));
    const p = dlg?.querySelector("p.text-rose-400");
    return p ? p.textContent.trim() : null;
  });
  const text1 = await bodyText(page);
  const shot1 = await shot(page, "remediation-qa4-err-01-ui-bad-csi.png");
  const toast1 = (text1.match(/Error creating package:[^\n]*/) || [])[0] ?? null;
  say(`UI B1: waitHit="${errWait1.hit}" inlineError=${JSON.stringify(uiErr1)} toast=${JSON.stringify(toast1)} shot=${shot1}`);

  // B2: past deadline (unique valid CSI)
  const fill2 = await uiCreatePackageAttempt({ csi: "27 00 00", name: "QA ERR UI Past Deadline", scope: "QA UI error probe.", deadline: "2020-01-01", stripAttrs: false });
  say(`UI FILL B2: ${JSON.stringify(fill2)}`);
  await delay(200);
  const submit2 = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll("div.fixed")].find((d) => (d.textContent || "").includes("Create CSI Trade Package"));
    const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Create Package");
    btn.click();
    return { ok: true };
  });
  const errWait2 = await waitForBodyText(page, ["Bid deadline cannot be in the past", "Server Error", "Error creating package"], 25000);
  await delay(600);
  const uiErr2 = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll("div.fixed")].find((d) => (d.textContent || "").includes("Create CSI Trade Package"));
    const p = dlg?.querySelector("p.text-rose-400");
    return p ? p.textContent.trim() : null;
  });
  const text2 = await bodyText(page);
  const shot2 = await shot(page, "remediation-qa4-err-02-ui-past-deadline.png");
  const toast2 = (text2.match(/Error creating package:[^\n]*/) || [])[0] ?? null;
  say(`UI B2: waitHit="${errWait2.hit}" inlineError=${JSON.stringify(uiErr2)} toast=${JSON.stringify(toast2)} shot=${shot2}`);

  // No package created for this project by these attempts?
  const pkgsAfter = await client.query("tradePackages:listByProject", { projectId: target._id });
  say(`BACKEND AFTER UI ATTEMPTS: packages=${pkgsAfter.length} (before=${pkgsBefore.length})`);

  const diagSummary = summarizeDiagnostics(diag);
  const uiReadable1 = /CSI division must use the format/i.test(uiErr1 || "") || /CSI division must use the format/i.test(toast1 || "");
  const uiReadable2 = /Bid deadline cannot be in the past/i.test(uiErr2 || "") || /Bid deadline cannot be in the past/i.test(toast2 || "");
  const pass = csiReadable && deadlineReadable && notGenericCsi && notGenericDeadline && uiReadable1 && uiReadable2 && pkgsAfter.length === pkgsBefore.length;
  say(`DIAGNOSTICS: ${JSON.stringify(diagSummary)}`);
  result = {
    err: pass ? "PASS" : "FAIL",
    backend: { badCsi, pastDeadline, csiReadable, deadlineReadable },
    ui: { inlineErrorBadCsi: uiErr1, inlineErrorPastDeadline: uiErr2, toastBadCsi: toast1, toastPastDeadline: toast2, uiReadable1, uiReadable2 },
    packagesBefore: pkgsBefore.length,
    packagesAfter: pkgsAfter.length,
    diagSummary,
  };
  say(`ERR RESULT: ${result.err}`);
} catch (err) {
  say(`ERR ERROR: ${err.stack || err}`);
  result = { err: "FAIL", error: String(err), diagSummary: summarizeDiagnostics(diag) };
} finally {
  const logPath = writeLog("remediation-qa4-err-log.txt", log);
  writeJson("remediation-qa4-err-result.json", result);
  say(`LOG: ${logPath}`);
  console.log("JSON_RESULT " + JSON.stringify(result));
  await browser.close();
  process.exitCode = result.err === "PASS" ? 0 : 1;
}