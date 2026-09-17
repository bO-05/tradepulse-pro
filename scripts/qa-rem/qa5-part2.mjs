import fs from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  EVIDENCE_DIR,
  launchBrowser,
  shot,
  waitForAppReady,
  getSelectorState,
  selectProjectByTitle,
  delay,
} from "./qa1-lib.mjs";
import {
  makeLog,
  loadState,
  saveState,
  dismissDemoTour,
  clickStage,
  clickVisibleButton,
  setFieldByLabel,
  selectOptionContains,
  getToast,
  waitFor,
} from "./qa5-lib.mjs";

const state = loadState();
const PROJECT_TITLE = state.projectTitle;
if (!PROJECT_TITLE) {
  console.error("No project title in state; run qa5-part1.mjs first.");
  process.exit(1);
}
const TARGET_CSI = "03 30 00";
const MANUAL_NAME = "QA5 Manual Concrete Co";

const { say, write } = makeLog("remediation-qa5-part2-log.txt");
say(`=== QA-5 PART 2 (Rows 4-6: discovery, RFQ dispatch, RFI/addendum) ===`);
say(`SITE: ${BASE_URL}`);
say(`UTC START: ${new Date().toISOString()}`);
say(`PROJECT: ${PROJECT_TITLE}`);

const consoleEvents = [];
const pageErrors = [];
const failedRequests = [];
const httpErrors = [];
let currentRow = "row4";
const results = {};
const step = (row, msg, observed) => {
  say(`[${row}] ${msg}`);
  if (observed !== undefined) say(`[${row}]   observed: ${typeof observed === "string" ? observed : JSON.stringify(observed)}`);
};

const { browser, executablePath } = await launchBrowser();
say(`EXECUTABLE: ${executablePath}`);
const page = await browser.newPage();
page.on("console", (m) => consoleEvents.push({ type: m.type(), text: m.text(), at: Date.now() }));
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure() ? r.failure().errorText : "?"}`));
page.on("response", (res) => {
  if (res.status() >= 400) httpErrors.push(`${res.request().method()} ${res.url()} -> ${res.status()}`);
});

async function selectPackageCard(csi) {
  return page.evaluate((needle) => {
    const cards = [...document.querySelectorAll("div")].filter(
      (d) =>
        d.className &&
        typeof d.className === "string" &&
        d.className.includes("rounded-xl") &&
        d.className.includes("cursor-pointer") &&
        (d.innerText || "").includes(`Div ${needle}`)
    );
    const card = cards.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!card) return { ok: false, reason: "package card not found" };
    const btns = [...card.querySelectorAll("button")];
    const sel = btns.find((b) => /Inspect Package|Active Package/.test(b.textContent || ""));
    const dispatch = btns.find((b) => /Dispatch RFQs/.test(b.textContent || ""));
    if (sel) sel.click();
    return { ok: true, alreadyActive: sel ? sel.textContent.includes("Active Package") : null, hasDispatch: Boolean(dispatch) };
  }, csi);
}

async function clickDispatchOnCard(csi) {
  return page.evaluate((needle) => {
    const cards = [...document.querySelectorAll("div")].filter(
      (d) =>
        d.className &&
        typeof d.className === "string" &&
        d.className.includes("rounded-xl") &&
        d.className.includes("cursor-pointer") &&
        (d.innerText || "").includes(`Div ${needle}`)
    );
    const card = cards.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!card) return { ok: false, reason: "package card not found" };
    const btn = [...card.querySelectorAll("button")].find((b) => /Dispatch RFQs/.test(b.textContent || ""));
    if (!btn) return { ok: false, reason: "dispatch button not found" };
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return { ok: true, disabled: btn.disabled, text: (btn.textContent || "").trim() };
  }, csi);
}

function countStatuses(body) {
  const count = (rx) => (body.match(rx) || []).length;
  return {
    "RFQ Invited": count(/RFQ Invited/g),
    Discovered: count(/Discovered/g),
    "RFI Active": count(/RFI Active/g),
    "Bid Received": count(/Bid Received/g),
  };
}

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await dismissDemoTour(page);
  const sel = await getSelectorState(page);
  if (!(sel && sel.selectedText && sel.selectedText.includes(PROJECT_TITLE))) {
    await selectProjectByTitle(page, PROJECT_TITLE);
    await delay(1500);
  }
  await clickStage(page, "CSI Scoping");
  await delay(1500);
  const picked = await selectPackageCard(TARGET_CSI);
  step("row4", `select package card ${TARGET_CSI}`, picked);
  await delay(1500);

  // ================= ROW 4: discovery + manual contractor add/edit =================
  currentRow = "row4";
  await clickStage(page, "Discovery");
  await waitFor(page, () => document.body.innerText.includes("Discovery & Directory"), 15000, 500);
  const ribbon = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter(
      (b) => b.offsetParent !== null && /^03 30 00/.test((b.textContent || "").trim())
    );
    if (btns.length === 0) return { ok: false, count: 0 };
    btns[0].click();
    return { ok: true, count: btns.length, text: btns[0].textContent.trim() };
  });
  step("row4", "ensure discovery package ribbon = 03 30 00", ribbon);
  await delay(1200);
  await shot(page, "remediation-qa5-p2-01-row4-discovery-before.png");

  const t0 = Date.now();
  await clickVisibleButton(page, "Discover Trade Contractors");
  const discovered = await waitFor(
    page,
    () => {
      const t = document.body.innerText;
      if (t.includes("Contractor action failed")) {
        const m = t.match(/Contractor action failed:[^\n]*/);
        return { kind: "error", text: m ? m[0] : null };
      }
      const m = t.match(/Trade Directory \((\d+) of (\d+)\)/);
      if (m && Number(m[2]) > 0) return { kind: "ok", shown: Number(m[1]), total: Number(m[2]) };
      return null;
    },
    160000,
    3000
  );
  step("row4", "discovery run result", { ...discovered, elapsedMs: Date.now() - t0 });
  await shot(page, "remediation-qa5-p2-02-row4-discovery-result.png");
  const dirAfterDiscover = await page.evaluate(() => {
    const i = document.body.innerText.indexOf("Trade Directory (");
    return i >= 0 ? document.body.innerText.slice(i, i + 1400) : null;
  });
  step("row4", "directory after discovery (truncated)", dirAfterDiscover ? dirAfterDiscover.slice(0, 1000) : null);
  const statusesAfterDiscover = countStatuses(await page.evaluate(() => document.body.innerText));
  step("row4", "status chip counts after discovery", statusesAfterDiscover);

  // manual add
  const openAdd = await clickVisibleButton(page, "Add Contractor Manually");
  step("row4", "open Add Contractor Manually", openAdd);
  await waitFor(page, () => document.body.innerText.includes("Add Contractor Manually") && Boolean([...document.querySelectorAll("label")].find((l) => (l.textContent || "").includes("Company Name"))), 8000, 300);
  const addFill = {
    name: await setFieldByLabel(page, "Company Name", MANUAL_NAME),
    email: await setFieldByLabel(page, "Contact Email", "qa5.manual@example.com"),
    phone: await setFieldByLabel(page, "Phone Number", "(512) 555-0505"),
    license: await setFieldByLabel(page, "State License", "QA5-TECL-0001"),
    url: await setFieldByLabel(page, "Website", "https://example.com/qa5-manual"),
  };
  step("row4", "manual contractor form filled", addFill);
  await clickVisibleButton(page, "Add to Directory");
  let added = { ok: false };
  try {
    await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 15000, polling: 500 }, MANUAL_NAME);
    added = { ok: true };
  } catch (e) {
    added = { ok: false, error: String(e && e.message ? e.message : e) };
  }
  const addedName = await page.evaluate((n) => document.body.innerText.includes(n), MANUAL_NAME);
  step("row4", "manual contractor visible", { added: added.ok, addedName });
  await shot(page, "remediation-qa5-p2-03-row4-manual-added.png");

  // edit
  const editClick = await page.evaluate((name) => {
    const rows = [...document.querySelectorAll("div")].filter(
      (d) => (d.innerText || "").includes(name) && (d.innerText || "").length < 2500
    );
    const row = rows.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!row) return { ok: false, reason: "row not found" };
    const btn = [...row.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "").includes("Edit contractor"));
    if (!btn) return { ok: false, reason: "edit button not found" };
    btn.click();
    return { ok: true };
  }, MANUAL_NAME);
  step("row4", "click edit on manual contractor", editClick);
  await waitFor(page, () => document.body.innerText.includes("Edit Contractor Details"), 8000, 300);
  const editFill = await setFieldByLabel(page, "State License", "QA5-TECL-EDITED-0002");
  step("row4", "edited license field", editFill);
  await clickVisibleButton(page, "Save Changes");
  const editedVisible = await waitFor(
    page,
    () => (document.body.innerText.includes("QA5-TECL-EDITED-0002") ? true : null),
    15000,
    500
  );
  step("row4", "edited license visible in directory", editedVisible);
  await shot(page, "remediation-qa5-p2-04-row4-manual-edited.png");
  results.row4 = {
    status: discovered.ok && discovered.value && discovered.value.kind === "ok" && added.ok && editedVisible.ok ? "PASS" : "CHECK",
    discovery: { ...discovered, elapsedMs: Date.now() - t0 },
    manualAdded: added.ok,
    manualEditedLicenseVisible: editedVisible.ok,
    statusesAfterDiscover,
  };
  step("row4", "ROW 4 VERDICT", results.row4);

  // ================= ROW 5: RFQ dispatch from package =================
  currentRow = "row5";
  await clickStage(page, "CSI Scoping");
  await delay(1500);
  const statusesBeforeDispatch = countStatuses(await page.evaluate(() => document.body.innerText));
  const dispatchClick = await clickDispatchOnCard(TARGET_CSI);
  step("row5", "click Dispatch RFQs on 03 30 00 card", dispatchClick);
  const dispatchDone = await waitFor(
    page,
    () => {
      const toast = [...document.querySelectorAll("div")].find((d) => typeof d.className === "string" && d.className.includes("fixed bottom-5 right-5"));
      const t = toast ? toast.textContent.trim() : "";
      if (/dispatch|RFQ/i.test(t)) return t;
      if (document.body.innerText.includes("Contractor action failed")) return { error: true };
      return null;
    },
    60000,
    1000
  );
  step("row5", "dispatch completion signal", dispatchDone);
  await shot(page, "remediation-qa5-p2-05-row5-dispatch-clicked.png");
  await delay(2000);
  await clickStage(page, "Discovery");
  await waitFor(page, () => document.body.innerText.includes("Discovery & Directory"), 15000, 500);
  await delay(2000);
  const bodyAfterDispatch = await page.evaluate(() => document.body.innerText);
  const statusesAfterDispatch = countStatuses(bodyAfterDispatch);
  step("row5", "status chip counts after dispatch", { before: statusesBeforeDispatch, after: statusesAfterDispatch });
  await shot(page, "remediation-qa5-p2-06-row5-discovery-invited.png");

  await clickStage(page, "Live Activity Audit");
  await waitFor(page, () => document.body.innerText.includes("Activity Events ("), 15000, 500);
  await delay(1500);
  const auditNow = await page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/Activity Events \((\d+)\)/);
    return { count: m ? Number(m[1]) : null, snapshot: t.slice(Math.max(0, t.indexOf("Activity Events (")), t.indexOf("Activity Events (") + 2500) };
  });
  const rfqEvents = (auditNow.snapshot.match(/RFQ[^\n]*/g) || []).slice(0, 10);
  step("row5", "audit events now", { count: auditNow.count, rfqEvents });
  await shot(page, "remediation-qa5-p2-07-row5-audit-rfq.png");
  results.row5 = {
    status: statusesAfterDispatch["RFQ Invited"] > statusesBeforeDispatch["RFQ Invited"] && rfqEvents.length > 0 ? "PASS" : "CHECK",
    dispatchClick,
    dispatchDone,
    statusesBeforeDispatch,
    statusesAfterDispatch,
    auditCount: auditNow.count,
    rfqAuditEvents: rfqEvents,
  };
  step("row5", "ROW 5 VERDICT", results.row5);

  // ================= ROW 6: RFI submit -> approve -> addendum =================
  currentRow = "row6";
  await clickStage(page, "Pre-Bid Q&A");
  await waitFor(page, () => document.body.innerText.includes("Pre-Bid RFI"), 15000, 500);
  await delay(1500);
  const qaBefore = await page.evaluate(() => {
    const m = document.body.innerText.match(/All RFIs \((\d+)\)/);
    return { allRfis: m ? Number(m[1]) : null };
  });
  step("row6", "Q&A queue before submit", qaBefore);

  const subject = `QA5 RFI - concrete pump hoisting responsibility ${Date.now().toString().slice(-6)}`;
  const question = "Please clarify whether the General Contractor furnishes the concrete pump truck and crane hoisting for the elevated slab placements, or whether this is included in Division 03 scope.";
  const contractorPick = await selectOptionContains(page, 0, MANUAL_NAME);
  step("row6", "RFI contractor select", contractorPick);
  const subjFill = await setFieldByLabel(page, "Subject / Scope Topic", subject);
  const qFill = await setFieldByLabel(page, "Subcontractor Question", question);
  step("row6", "RFI form filled", { subjFill, qFill });
  await shot(page, "remediation-qa5-p2-08-row6-rfi-form.png");
  await clickVisibleButton(page, "Submit RFI for Clarification");
  const submitToast = await waitFor(page, () => {
    const el = [...document.querySelectorAll("div")].find((d) => typeof d.className === "string" && d.className.includes("fixed bottom-5 right-5"));
    const t = el ? el.textContent.trim() : "";
    return /RFI/i.test(t) ? t : null;
  }, 20000, 500);
  step("row6", "submit toast", submitToast);

  let appeared = { ok: false };
  const tAppear = Date.now();
  try {
    await page.waitForFunction((s) => document.body.innerText.includes(s), { timeout: 190000, polling: 3000 }, subject);
    appeared = { ok: true, elapsedMs: Date.now() - tAppear };
  } catch (e) {
    appeared = { ok: false, elapsedMs: Date.now() - tAppear, error: String(e && e.message ? e.message : e) };
  }
  const appearedSubject = await page.evaluate((s) => document.body.innerText.includes(s), subject);
  step("row6", "RFI appears in queue (AI clarification completed)", { appeared: appeared.ok, elapsedMs: appeared.elapsedMs, appearedSubject });
  await shot(page, "remediation-qa5-p2-09-row6-rfi-in-queue.png");

  const approveClick = await page.evaluate((s) => {
    const nodes = [...document.querySelectorAll("div")].filter(
      (d) => (d.innerText || "").includes(s) && (d.innerText || "").length < 3500
    );
    const candidates = nodes.filter((d) =>
      [...d.querySelectorAll("button")].some((b) => /Approve for Addendum/.test(b.textContent || ""))
    );
    const card = candidates.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!card) return { ok: false, reason: "card with approve button not found", nodeCount: nodes.length };
    const btn = [...card.querySelectorAll("button")].find((b) => /Approve for Addendum/.test(b.textContent || ""));
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return { ok: true, label: (btn.textContent || "").trim(), cardText: card.innerText.slice(0, 400) };
  }, subject);
  step("row6", "click Approve for Addendum", approveClick);
  const approvedWait = await waitFor(
    page,
    () => {
      const el = [...document.querySelectorAll("div")].find((d) => typeof d.className === "string" && d.className.includes("fixed bottom-5 right-5"));
      const t = el ? el.textContent.trim() : "";
      return /approved & certified|certified for inclusion/i.test(t) ? t : null;
    },
    25000,
    500
  );
  step("row6", "approval toast", approvedWait);
  await delay(2000);
  const pendingState = await page.evaluate(() => {
    const t = document.body.innerText;
    const esc = t.match(/(\d+) Subcontractor RFI[s]? Require PM Certification/);
    return { escalatedBanner: esc ? esc[0] : null };
  });
  step("row6", "pending certification state after approve", pendingState);
  await shot(page, "remediation-qa5-p2-10-row6-approved.png");

  const addendumClick = await clickVisibleButton(page, "Issue Legal Addendum");
  step("row6", "click Issue Legal Addendum NO. 01", addendumClick);
  const addendumWait = await waitFor(
    page,
    () => {
      const t = document.body.innerText;
      if (t.includes("Addendum generation failed")) {
        const m = t.match(/Addendum generation failed:[^\n]*/);
        return { kind: "error", text: m ? m[0] : null };
      }
      if (/Successfully Issued & Filed|Official Pre-Bid Legal Addendum NO. 01/.test(t)) {
        const m = t.match(/Official Pre-Bid Legal Addendum NO. 01[^\n]*/);
        return { kind: "success", text: m ? m[0] : "success banner visible" };
      }
      return null;
    },
    60000,
    1000
  );
  step("row6", "addendum outcome", addendumWait);
  await shot(page, "remediation-qa5-p2-11-row6-addendum.png");
  results.row6 = {
    status:
      appearedSubject && approvedWait.ok && addendumWait.ok && addendumWait.value && addendumWait.value.kind === "success"
        ? "PASS"
        : appearedSubject && approvedWait.ok && addendumWait.ok
        ? "PARTIAL"
        : "FAIL",
    subject,
    question,
    rfisBefore: qaBefore.allRfis,
    appearedInQueue: appearedSubject,
    approvalToast: approvedWait.value,
    pendingAfterApprove: pendingState,
    addendum: addendumWait.value,
  };
  step("row6", "ROW 6 VERDICT", results.row6);

  results.diagnostics = {
    consoleErrors: consoleEvents.filter((e) => e.type === "error").map((e) => e.text),
    pageErrors,
    failedRequests,
    httpErrors,
  };
  say(`DIAGNOSTICS: ${JSON.stringify({ consoleErrors: results.diagnostics.consoleErrors.length, pageErrors: pageErrors.length, failedRequests: failedRequests.length, httpErrors: httpErrors.length })}`);
  saveState({ part2: results, part2At: new Date().toISOString() });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa5-part2-events.json"), JSON.stringify({ results, consoleEvents, pageErrors, failedRequests, httpErrors }, null, 2), "utf8");
  say(`QA5_RESULT ${JSON.stringify(results)}`);
  write();
} catch (err) {
  say(`FATAL in ${currentRow}: ${err && err.stack ? err.stack : err}`);
  say(`EVENTS: ${JSON.stringify({ consoleErrors: consoleEvents.filter((e) => e.type === "error").map((e) => e.text), pageErrors, failedRequests, httpErrors })}`);
  write();
  process.exitCode = 1;
} finally {
  await browser.close();
}