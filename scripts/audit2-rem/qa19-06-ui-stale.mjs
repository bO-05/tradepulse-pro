/**
 * QA19-06: A18-01 — cancelled drafts must not persist across Cancel/Escape/reopen
 * and must not carry across projects/packages, for all four modals:
 * New Project, Create Trade Package, Add Contractor, Ingest Quote.
 */
import {
  launchBrowser,
  attachDiagnostics,
  waitForAppReady,
  delay,
  shot,
  setInputValue,
  selectProjectByTitle,
} from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa19-lib.mjs";

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

async function clickAny(page, text, scope = null) {
  return page.evaluate((t, sc) => {
    const root = sc ? document.querySelector(sc) : document;
    const b = [...root.querySelectorAll("button")].find((x) => (x.textContent || "").includes(t));
    if (!b) return { ok: false };
    b.click();
    return { ok: true, text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) };
  }, text, scope);
}

async function clickIn(page, scopeSel, text) {
  return page.evaluate((scope, t) => {
    const root = document.querySelector(scope);
    if (!root) return { ok: false };
    const b = [...root.querySelectorAll("button")].find((x) => (x.textContent || "").trim().includes(t));
    if (!b) return { ok: false, avail: [...root.querySelectorAll("button")].map((x) => (x.textContent || "").trim()).slice(0, 30) };
    b.click();
    return { ok: true, text: (b.textContent || "").trim().slice(0, 60) };
  }, scopeSel, text);
}

async function dialogValues(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { dialog: false };
    const out = { dialog: true };
    dialog.querySelectorAll("input, textarea, select").forEach((el, i) => {
      const key = el.getAttribute("aria-label") || el.getAttribute("placeholder") || `${el.tagName.toLowerCase()}#${i}`;
      if (el.tagName === "SELECT") {
        out[key] = el.options[el.selectedIndex] ? el.options[el.selectedIndex].textContent.trim() : el.value;
        out[`${key}__value`] = el.value;
      } else {
        out[key] = el.value;
      }
    });
    return out;
  });
}

async function setTextareaByPlaceholder(page, placeholderSub, value) {
  return page.evaluate((ph, val) => {
    const dialog = document.querySelector('[role="dialog"]');
    const ta = dialog ? [...dialog.querySelectorAll("textarea")].find((x) => (x.getAttribute("placeholder") || "").includes(ph)) : null;
    if (!ta) return { ok: false };
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, val);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: ta.value };
  }, placeholderSub, value);
}

const hasDraft = (vals, needle = "AUDIT-QA19") =>
  Object.entries(vals)
    .filter(([k]) => !k.startsWith("Subcontractor or bidder for this proposal"))
    .some(([k, v]) => typeof v === "string" && v.includes(needle));
const selectValue = (vals) => vals['Subcontractor or bidder for this proposal__value'] ?? null;

async function main() {
  const c = client();
  const packagesBefore = ((await c.query("tradePackages:listByProject", { projectId: F.live.id })) || []).length;
  const contractorsBefore = ((await c.query("contractors:listByProject", { projectId: F.live.id })) || []).length;

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${F.live.id}&tab=packages&qa19=stale`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(800);

  // ---------------- A. New Project ----------------
  say("== A. New Project ==");
  const newProject = {};
  await clickAny(page, "New Project");
  await delay(400);
  await setInputValue(page, '[aria-label="Project title"]', "AUDIT-QA19-STALE-ProjectTitle");
  await setInputValue(page, '[aria-label="Project location"]', "AUDIT-QA19-STALE-Location");
  await setInputValue(page, '[aria-label="General contractor or contracting entity"]', "AUDIT-QA19-STALE-GC");
  await setInputValue(page, '[aria-label="Estimated budget in dollars"]', "1234567");
  await setInputValue(page, '[aria-label="Target completion duration in weeks"]', "77");
  newProject.filled = await dialogValues(page);
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(400);
  await clickAny(page, "New Project");
  await delay(400);
  newProject.afterCancelReopen = await dialogValues(page);
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(300);
  await clickAny(page, "New Project");
  await delay(400);
  await setInputValue(page, '[aria-label="Project title"]', "AUDIT-QA19-STALE-EscTitle");
  await page.keyboard.press("Escape");
  await delay(400);
  newProject.closedAfterEscape = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
  await clickAny(page, "New Project");
  await delay(400);
  newProject.afterEscapeReopen = await dialogValues(page);
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(300);

  const switchSim = await selectProjectByTitle(page, "AUDIT-QA19-SIM");
  say(`switch to SIM: ${JSON.stringify(switchSim)}`);
  await delay(2500);
  await clickAny(page, "New Project");
  await delay(400);
  newProject.afterProjectSwitch = await dialogValues(page);
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(300);
  await selectProjectByTitle(page, "AUDIT-QA19-LIVE");
  await delay(2500);

  record("A18-01.newProject.cancel-reopen-clean", !hasDraft(newProject.afterCancelReopen), newProject.afterCancelReopen);
  record("A18-01.newProject.escape-reopen-clean", newProject.closedAfterEscape && !hasDraft(newProject.afterEscapeReopen), {
    closedAfterEscape: newProject.closedAfterEscape,
    values: newProject.afterEscapeReopen,
  });
  record("A18-01.newProject.project-switch-clean", !hasDraft(newProject.afterProjectSwitch), newProject.afterProjectSwitch);
  out.newProject = newProject;

  // ---------------- B. Create Trade Package ----------------
  say("== B. Create Trade Package ==");
  const createPkg = {};
  await clickAny(page, "Create Trade Package");
  await delay(400);
  await setInputValue(page, '[aria-label="Trade package name"]', "AUDIT-QA19-STALE-PackageName");
  await setInputValue(page, '[aria-label="CSI division number"]', "44 44 44");
  await setTextareaByPlaceholder(page, "Scope", "AUDIT-QA19-STALE-Scope");
  createPkg.filled = await dialogValues(page);
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(400);
  await clickAny(page, "Create Trade Package");
  await delay(400);
  createPkg.afterCancelReopen = await dialogValues(page);
  await setInputValue(page, '[aria-label="Trade package name"]', "AUDIT-QA19-STALE-EscPkg");
  await page.keyboard.press("Escape");
  await delay(400);
  createPkg.closedAfterEscape = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
  await clickAny(page, "Create Trade Package");
  await delay(400);
  createPkg.afterEscapeReopen = await dialogValues(page);
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(300);

  record("A18-01.createPackage.cancel-reopen-clean", !hasDraft(createPkg.afterCancelReopen), {
    name: createPkg.afterCancelReopen['aria-label="Trade package name"]'],
    csi: createPkg.afterCancelReopen['aria-label="CSI division number"'],
  });
  record("A18-01.createPackage.escape-reopen-clean", createPkg.closedAfterEscape && !hasDraft(createPkg.afterEscapeReopen), {
    closedAfterEscape: createPkg.closedAfterEscape,
    name: createPkg.afterEscapeReopen['aria-label="Trade package name"'],
  });
  out.createPackage = createPkg;

  // ---------------- C. Add Contractor ----------------
  say("== C. Add Contractor ==");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Discovery/.test(x.getAttribute("title") || x.textContent || ""));
    b?.click();
  });
  await delay(1500);
  const addCtr = {};
  const openAdd = () => clickAny(page, "Add Contractor Manually");
  await openAdd();
  await delay(400);
  await setInputValue(page, 'input[placeholder="e.g. Rosendin Electric, Inc."]', "AUDIT-QA19-STALE-Contractor");
  await setInputValue(page, 'input[placeholder="estimating@rosendin.com"]', "stale@qa19.invalid");
  addCtr.filled = await dialogValues(page);
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(300);
  await openAdd();
  await delay(400);
  addCtr.afterCancelReopen = await dialogValues(page);
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(300);
  await openAdd();
  await delay(400);
  await setInputValue(page, 'input[placeholder="e.g. Rosendin Electric, Inc."]', "AUDIT-QA19-STALE-EscCtr");
  await page.keyboard.press("Escape");
  await delay(400);
  addCtr.closedAfterEscape = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
  await openAdd();
  await delay(400);
  addCtr.afterEscapeReopen = await dialogValues(page);
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(300);

  // switch package (Beta Plumbing) then reopen
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("AUDIT-QA19-LIVE Beta Plumbing"));
    b?.click();
  });
  await delay(1600);
  await openAdd();
  await delay(400);
  addCtr.afterPackageSwitch = await dialogValues(page);
  await clickIn(page, '[role="dialog"]', "Cancel");
  await delay(300);

  record("A18-01.addContractor.cancel-reopen-clean", !hasDraft(addCtr.afterCancelReopen), {
    company: addCtr.afterCancelReopen['input#0'] ?? addCtr.afterCancelReopen['placeholder=e.g. Rosendin Electric, Inc.'],
  });
  record("A18-01.addContractor.escape-reopen-clean", addCtr.closedAfterEscape && !hasDraft(addCtr.afterEscapeReopen), {
    closedAfterEscape: addCtr.closedAfterEscape,
  });
  record("A18-01.addContractor.package-switch-clean", !hasDraft(addCtr.afterPackageSwitch), {});
  out.addContractor = addCtr;

  // ---------------- D. Ingest Quote ----------------
  say("== D. Ingest Quote ==");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Bid Leveling/.test(x.getAttribute("title") || x.textContent || ""));
    b?.click();
  });
  await delay(1800);
  // back to P1 (Alpha Electrical)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("AUDIT-QA19-LIVE Alpha Electrical"));
    b?.click();
  });
  await delay(1600);
  await page.waitForFunction(
    () => document.body.innerText.includes("AUDIT-QA19-LIVE Alpha Sub A"),
    { timeout: 30000 }
  );
  await delay(800);
  const ingest = {};
  const openIngest = () =>
    page.evaluate(() => {
      const exact = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Ingest Quote / PDF");
      const b = exact || [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Ingest Quote"));
      if (!b) return { ok: false };
      b.click();
      return { ok: true, text: (b.textContent || "").trim().slice(0, 40) };
    });
  const closeIngest = () =>
    page.evaluate(() => {
      const b = document.querySelector('[aria-label="Close quote ingestion dialog"]');
      if (b) b.click();
    });
  const openIngestForBidder = async () => {
    for (let i = 0; i < 6; i++) {
      await openIngest();
      try {
        await page.waitForFunction(
          () => document.querySelector('[aria-label="Subcontractor or bidder for this proposal"]'),
          { timeout: 5000 }
        );
        return true;
      } catch {
        await closeIngest();
        await delay(1200);
      }
    }
    return false;
  };
  ingest.bidderSelectFound = await openIngestForBidder();
  await delay(400);
  ingest.selectOptions = await page.evaluate(() => {
    const sel = document.querySelector('[aria-label="Subcontractor or bidder for this proposal"]');
    return sel ? [...sel.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : null;
  });
  const pickedBidder = await page.evaluate(() => {
    const sel = document.querySelector('[aria-label="Subcontractor or bidder for this proposal"]');
    if (!sel || sel.options.length < 3) return { ok: false, count: sel ? sel.options.length : 0 };
    const opt = sel.options[2];
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: opt.value, text: opt.textContent.trim() };
  });
  ingest.pickedBidder = pickedBidder;
  await setInputValue(page, '[aria-label="Proposal OCR text or pasted quote"]', "AUDIT-QA19-STALE-QUOTE-TEXT");
  await setInputValue(page, '[aria-label="Document or proposal filename"]', "AUDIT-QA19-STALE-FILE.pdf");
  ingest.filled = await dialogValues(page);
  await page.evaluate(() => document.querySelector('[aria-label="Close quote ingestion dialog"]').click());
  await delay(400);
  await openIngest();
  await delay(500);
  ingest.afterCloseReopen = await dialogValues(page);
  ingest.selectResidualAfterReopen = selectValue(ingest.afterCloseReopen);
  await page.evaluate(() => document.querySelector('[aria-label="Close quote ingestion dialog"]').click());
  await delay(300);
  // Escape path
  await openIngest();
  await delay(500);
  await setInputValue(page, '[aria-label="Proposal OCR text or pasted quote"]', "AUDIT-QA19-STALE-ESC");
  await page.keyboard.press("Escape");
  await delay(400);
  ingest.closedAfterEscape = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
  await openIngest();
  await delay(500);
  ingest.afterEscapeReopen = await dialogValues(page);
  await page.evaluate(() => document.querySelector('[aria-label="Close quote ingestion dialog"]').click());
  await delay(300);
  // switch package then reopen
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("AUDIT-QA19-LIVE Beta Plumbing"));
    b?.click();
  });
  await delay(1600);
  await openIngest();
  await delay(500);
  ingest.afterPackageSwitch = await dialogValues(page);
  await page.evaluate(() => document.querySelector('[aria-label="Close quote ingestion dialog"]').click());
  await delay(300);

  record("A18-01.ingest.cancel-reopen-clean", !hasDraft(ingest.afterCloseReopen), {
    quote: ingest.afterCloseReopen['Proposal OCR text or pasted quote'],
    filename: ingest.afterCloseReopen['Document or proposal filename'],
  });
  record("A18-01.ingest.escape-reopen-clean", ingest.closedAfterEscape && !hasDraft(ingest.afterEscapeReopen), {
    closedAfterEscape: ingest.closedAfterEscape,
    quote: ingest.afterEscapeReopen['Proposal OCR text or pasted quote'],
  });
  record("A18-01.ingest.package-switch-clean", !hasDraft(ingest.afterPackageSwitch), {
    quote: ingest.afterPackageSwitch['Proposal OCR text or pasted quote'],
  });
  record(
    "A18-01.ingest.quote-text-reset-on-reopen",
    ingest.afterCloseReopen['Proposal OCR text or pasted quote'] === "" &&
      ingest.afterCloseReopen['Document or proposal filename'] === "",
    {
      quote: ingest.afterCloseReopen['Proposal OCR text or pasted quote'],
      filename: ingest.afterCloseReopen['Document or proposal filename'],
    }
  );
  record(
    "A18-01.ingest.bidder-selection-reset-on-reopen",
    !pickedBidder.ok || ingest.selectResidualAfterReopen !== pickedBidder.value,
    {
      picked: pickedBidder,
      residual: ingest.selectResidualAfterReopen,
      note: "bidder select is a visible draft element; expect reset to the default first bidder",
    }
  );
  out.ingest = ingest;

  const packagesAfter = ((await c.query("tradePackages:listByProject", { projectId: F.live.id })) || []).length;
  const contractorsAfter = ((await c.query("contractors:listByProject", { projectId: F.live.id })) || []).length;
  record("A18-01.no-accidental-writes", packagesAfter === packagesBefore && contractorsAfter === contractorsBefore, {
    packagesBefore,
    packagesAfter,
    contractorsBefore,
    contractorsAfter,
  });

  await shot(page, "fix4-qa19-stale-final.png");
  out.results = results;
  out.pageErrors = diag.pageErrors.slice(0, 5);
  writeEvidence("stale", out);
  writeLog("stale", log);
  await browser.close();
  console.log(`results: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("stale-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});