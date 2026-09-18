import {
  BASE_URL,
  launchBrowser,
  attachDiagnostics,
  shot,
  waitForAppReady,
  selectProjectByTitle,
  writeJson,
  writeLog,
  delay,
} from "./lib.mjs";

const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

function clean(text) {
  return (text || "").replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).join("\n");
}

const out = { steps: [], dialogs: {}, disabledStates: {}, timestamp: new Date().toISOString() };

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
const page = await browser.newPage();
const diag = attachDiagnostics(page);

async function body() {
  return clean(await page.evaluate(() => document.body.innerText));
}

async function clickText(text, exact = false) {
  return page.evaluate(
    (needle, ex) => {
      const els = [...document.querySelectorAll("button, [role=tab], label")];
      const m = els.find((b) => {
        const t = (b.textContent || "").trim();
        return ex ? t === needle : t.includes(needle);
      });
      if (!m) return { ok: false, available: els.map((e) => (e.textContent || "").trim()).filter(Boolean).slice(0, 60) };
      m.scrollIntoView({ block: "center" });
      m.click();
      return { ok: true, text: (m.textContent || "").trim().slice(0, 80) };
    },
    text,
    exact
  );
}

async function captureDialogs(label) {
  const dialogs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"]')].map((d) => ({
      label: d.getAttribute("aria-label") || d.getAttribute("aria-labelledby") || "",
      text: (d.innerText || "").replace(/\r/g, ""),
      inputs: [...d.querySelectorAll("input, textarea, select")].map((i) => ({
        tag: i.tagName,
        type: i.getAttribute("type") || "",
        placeholder: i.getAttribute("placeholder") || "",
        aria: i.getAttribute("aria-label") || "",
        value: i.value ? i.value.slice(0, 200) : "",
      })),
      buttons: [...d.querySelectorAll("button")].map((b) => ({
        text: (b.textContent || "").trim().slice(0, 80),
        disabled: b.disabled,
        title: b.getAttribute("title") || "",
      })),
    }))
  );
  out.dialogs[label] = dialogs;
  say(`DIALOG[${label}]: ${dialogs.length} dialog(s), chars=${dialogs.map((d) => d.text.length).join(",")}`);
  if (dialogs.length) await shot(page, `fix4-qa4-dialog-${label}.png`, { full: false });
  return dialogs;
}

async function closeDialogs() {
  await page.keyboard.press("Escape");
  await delay(400);
  const remaining = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
  if (remaining > 0) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) => {
        const t = (b.textContent || "").trim();
        return /^(cancel|close|close viewer|close dock|dismiss|✕|×)$/i.test(t);
      });
      if (btn) btn.click();
    });
    await delay(400);
  }
  return page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
}

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, "Domain Tower B");
  await delay(1200);

  // 0. Capture action-button disabled states (write-gate audit, no clicks)
  out.disabledStates.actionButtons = await page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b) => ({
      text: (b.textContent || "").trim().slice(0, 90),
      title: b.getAttribute("title") || "",
      disabled: b.disabled,
    })).filter((b) => b.text || b.title)
  );

  // 1. KPI 6-card expansion
  const kpiBtn = await clickText("Expand 6-Card KPI View");
  await delay(600);
  out.steps.push({ step: "kpi-expand", kpiBtn });
  const kpiText = await body();
  out.dialogs.kpiExpanded = [{ text: kpiText }];
  await shot(page, "fix4-qa4-kpi-expanded.png", { full: true });
  if (kpiBtn.ok) await clickText("6-Card KPI View");

  // 2. Per-tab: toggle Why GCs Care + tab-specific read-only interactions
  const navTo = async (label) => {
    await clickText(label);
    await delay(900);
  };

  // Packages: why-GC toggle
  await navTo("CSI Scoping");
  await clickText("Why GCs Care");
  await delay(400);
  await clickText("Why GCs Care");
  out.steps.push({ step: "packages-why", text: (await body()).slice(0, 6000) });

  // Discovery: why-GC + filter empty states
  await navTo("Discovery");
  await clickText("Why GCs Care");
  await delay(300);
  await clickText("Discovered (0)");
  await delay(500);
  out.steps.push({ step: "discovery-filter-discovered-empty", text: (await body()).split("Contractor Discovery")[1]?.slice(0, 2500) || "" });
  await shot(page, "fix4-qa4-empty-discovery-filter.png", { full: true });
  await clickText("RFI Active (0)");
  await delay(500);
  out.steps.push({ step: "discovery-filter-rfi-empty", text: (await body()).split("Contractor Discovery")[1]?.slice(0, 2500) || "" });
  await clickText("All (4)");

  // QnA: why-GC + approved filter empty + edit-response modal
  await navTo("Pre-Bid Q&A");
  await clickText("Why GCs Care");
  await delay(300);
  await clickText("Approved for Addendum (0)");
  await delay(500);
  out.steps.push({ step: "qna-filter-approved-empty", text: (await body()).split("Queue Filter")[1]?.slice(0, 2500) || "" });
  await shot(page, "fix4-qa4-empty-qna-approved-filter.png", { full: true });
  await clickText("All RFIs (3)");
  await delay(300);
  const editBtn = await clickText("Edit Response");
  await delay(500);
  await captureDialogs("qna-edit-response");
  await closeDialogs();
  // Addendum gate: capture disabled state
  out.steps.push({
    step: "qna-addendum-gate",
    addendumButton: await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Issue Legal Addendum"));
      return b ? { disabled: b.disabled, title: b.getAttribute("title") || "", text: b.textContent.trim() } : null;
    }),
  });

  // Leveling: why-GC + spread table + adjust modal + line items + sim dock open
  await navTo("Bid Leveling");
  await clickText("Why GCs Care");
  await delay(300);
  await clickText("Spread Table View");
  await delay(600);
  out.steps.push({ step: "leveling-spread-table", text: (await body()).split("Real-Time Forensic Bid Leveling Matrix")[1]?.slice(0, 6000) || "" });
  await shot(page, "fix4-qa4-leveling-spread-table.png", { full: true });
  await clickText("Card View");
  await delay(400);
  const adjustBtns = await page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b, i) => ({ i, text: (b.textContent || "").trim().slice(0, 60) })).filter((b) => b.text.includes("Adjust"))
  );
  out.steps.push({ step: "leveling-adjust-buttons", adjustBtns });
  if (adjustBtns.length) {
    await page.evaluate((i) => [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").includes("Adjust"))[i].click(), 1);
    await delay(600);
    await captureDialogs("leveling-adjust-alterman");
    await closeDialogs();
  }
  await clickText("Line Item Breakdown");
  await delay(500);
  out.steps.push({ step: "leveling-line-items", text: (await body()).split("Real-Time Forensic Bid Leveling Matrix")[1]?.slice(0, 7000) || "" });
  await shot(page, "fix4-qa4-leveling-lineitems.png", { full: true });
  await clickText("Open Demo Simulation");
  await delay(900);
  await captureDialogs("judge-dock-from-leveling");
  const judgeText = out.dialogs["judge-dock-from-leveling"].map((d) => d.text).join("\n---\n");
  out.dialogs.judgeDockText = [{ text: judgeText }];
  await closeDialogs();

  // Coordination: why-GC
  await navTo("Scope Clash");
  await clickText("Why GCs Care");
  await delay(300);
  out.steps.push({ step: "coordination-why", text: (await body()).split("CSI Cross-Trade Coordination Engine")[1]?.slice(0, 7000) || "" });

  // Contracts: why-GC + inspect A401 modal
  await navTo("Subcontracts");
  await clickText("Why GCs Care");
  await delay(300);
  const inspectBtn = await clickText("Inspect AIA A401");
  await delay(900);
  await captureDialogs("contract-inspect-a401");
  out.dialogs.contractA401Text = out.dialogs["contract-inspect-a401"].map((d) => d.text);
  await shot(page, "fix4-qa4-dialog-contract-a401.png", { full: false });
  await closeDialogs();
  out.steps.push({
    step: "contract-execute-gate",
    recordExecutionButton: await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Record Execution"));
      return b ? { disabled: b.disabled, title: b.getAttribute("title") || "" } : null;
    }),
  });

  // Files preview (stays on packages tab)
  await navTo("CSI Scoping");
  const previewBtn = await clickText("Preview");
  await delay(800);
  await captureDialogs("file-preview");
  await closeDialogs();

  // Document preview modal for a QUOTE PDF (Extract & Level disabled gate capture)
  out.steps.push({
    step: "packages-action-gates",
    gates: await page.evaluate(() =>
      [...document.querySelectorAll("button")].map((b) => ({
        text: (b.textContent || "").trim().slice(0, 60),
        title: b.getAttribute("title") || "",
        disabled: b.disabled,
      })).filter((b) => /Dispatch RFQs|Auto-Scope|Extract & Level|Leveling Matrix|Create Trade Package|Delete/.test(b.text))
    ),
  });

  // Judge dock direct from header
  await clickText("60s Judge Dock");
  await delay(900);
  await captureDialogs("judge-dock-header");
  out.dialogs.judgeDockHeaderText = out.dialogs["judge-dock-header"].map((d) => d.text);
  await shot(page, "fix4-qa4-judge-dock.png", { full: false });
  await closeDialogs();

  // Full tour script capture (read-only panel)
  await clickText("Demo Tour");
  await delay(800);
  const tourText = await body();
  out.steps.push({ step: "tour-panel", text: tourText.split("Scene")[0].slice(0, 3000) });
  await clickText("Click to view full presenter script");
  await delay(500);
  out.steps.push({ step: "tour-script", text: (await body()).slice(0, 12000) });
  await shot(page, "fix4-qa4-tour-script.png", { full: true });
  await closeDialogs();
  await page.keyboard.press("Escape");

  out.diag = {
    consoleErrors: diag.consoleLogs.filter((m) => m.type === "error").map((m) => m.text.slice(0, 200)),
    pageErrors: diag.pageErrors.slice(0, 8),
    failedRequests: diag.failedRequests.slice(0, 8),
  };
} catch (e) {
  say(`INSPECT ERROR: ${e.stack || e}`);
  out.error = String(e.stack || e);
} finally {
  writeJson("fix4-qa4-inspect.json", out);
  writeLog("fix4-qa4-inspect-log.txt", log);
  await browser.close();
}