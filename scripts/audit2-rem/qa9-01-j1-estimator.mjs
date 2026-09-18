/**
 * QA9 Journey 1: GC estimator path — create project (typed) -> AI Spec Breakdown
 * -> verify package inbox labels/status -> manual package -> dispatch with/without
 * contractors -> Firecrawl discovery (one run) -> invite -> edit/delete contractor.
 * Evidence: evidence/fix4-qa9-j1-*.json / *.png
 */
import {
  client, launchBrowser, attachDiagnostics, diagnosticsSummary, waitForAppReady, delay,
  selectProjectByTitle, currentProjectLabel, setReactValue, typeInto, clickByText,
  shot, writeEvidence, text as bodyText, buttonSnapshot, FIXTURE_TAG,
} from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J1-ESTIMATOR`;
const MANUAL_DIV = "10 00 00";
const MANUAL_TRADE = "Specialties & Signage QA9";
const log = [];
const problems = [];
const step = (s) => { log.push(s); console.log("STEP:", s); };

// Pre-clean any stale J1 fixture
const existing = (await c.query("projects:listProjects", {})).filter((p) => p.title.includes(PROJECT));
for (const p of existing) {
  try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
}

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
const result = { journey: "J1", project: PROJECT, steps: log, findings: [], data: {} };

async function clickCardButton(cardText, buttonText) {
  const target = await page.evaluate((ct, bt) => {
    const nodes = [...document.querySelectorAll("div, article, li")];
    const card = nodes
      .filter((n) => (n.textContent || "").includes(ct))
      .sort((a, b) => a.textContent.length - b.textContent.length)[0];
    if (!card) return { ok: false, reason: "card not found" };
    const btn = [...card.querySelectorAll("button")].find((b) => (b.textContent || "").trim().includes(bt) || (b.getAttribute("title") || "").includes(bt));
    if (!btn) return { ok: false, reason: "button not found in card", buttons: [...card.querySelectorAll("button")].map((b) => (b.textContent || b.getAttribute("title") || "").trim()) };
    btn.scrollIntoView({ block: "center" });
    const r = btn.getBoundingClientRect();
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, btnText: (btn.textContent || btn.getAttribute("title") || "").trim() };
  }, cardText, buttonText);
  if (!target.ok) return target;
  await page.mouse.click(target.x, target.y);
  return target;
}

async function toastText() {
  return page.evaluate(() => {
    const el = document.querySelector('[role="status"], [data-toast], .toast, [class*="toast"]');
    return el ? el.innerText.trim() : document.body.innerText.split("\n").filter((l) => /RFQ|created|Delete|error|failed|successful/i.test(l)).slice(0, 5).join(" | ");
  });
}

async function pollBackend(fn, timeoutMs, interval = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await delay(interval);
  }
  return null;
}

try {
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  step("app ready");

  // --- 1. UI project creation with real typing ---
  await clickByText(page, "New Project", { exact: false });
  await delay(600);
  await typeInto(page, 'input[aria-label="Project title"]', PROJECT);
  await typeInto(page, 'input[aria-label="Project location"]', "Boise, ID");
  await typeInto(page, 'input[aria-label="Project type"]', "Healthcare / Mixed-Use");
  await typeInto(page, 'input[aria-label="General contractor or contracting entity"]', "QA9 General Contractors, LLC");
  await typeInto(page, 'input[aria-label="Estimated budget in dollars"]', "6400000");
  await typeInto(page, 'input[aria-label="Target completion duration in weeks"]', "72");
  const specSeed = [
    "DIVISION 03 30 00 CAST-IN-PLACE CONCRETE: footings, slab-on-grade, elevated decks.",
    "DIVISION 05 12 00 STRUCTURAL STEEL: moment frames, metal deck, fireproofing.",
    "DIVISION 08 11 00 METAL DOORS AND FRAMES: hollow metal doors, hardware sets.",
    "DIVISION 09 30 00 TILING: porcelain tile, waterproofing membranes.",
    "DIVISION 23 00 00 HVAC: rooftop AHUs, VAV boxes, BACnet controls.",
    "DIVISION 26 00 00 ELECTRICAL: switchgear, emergency lighting, fire alarm.",
  ].join("\n");
  await typeInto(page, 'textarea[aria-label], textarea', specSeed).catch(async () => {
    await setReactValue(page, "textarea", specSeed);
  });
  await shot(page, "fix4-qa9-j1-new-project-modal.png");
  await clickByText(page, "Create Commercial Project", { exact: false });
  await pollBackend(async () => {
    const ps = await c.query("projects:listProjects", {});
    return ps.find((p) => p.title === PROJECT) || null;
  }, 20000);
  const projects = await c.query("projects:listProjects", {});
  const proj = projects.find((p) => p.title === PROJECT);
  result.data.projectId = proj?._id ?? null;
  if (!proj) throw new Error("Project was not created in Convex");
  await delay(1500);
  const label = await currentProjectLabel(page);
  result.data.selectedAfterCreate = label;
  step(`project created id=${proj._id}, selector=${label}`);
  await shot(page, "fix4-qa9-j1-created.png");

  // --- 2. AI Spec Breakdown with pasted text ---
  await clickByText(page, "AI Spec Breakdown", { exact: false });
  await delay(700);
  const taSel = 'textarea[aria-label="Architectural and engineering specifications text"]';
  await typeInto(page, taSel, specSeed);
  await shot(page, "fix4-qa9-j1-spec-modal.png");
  await clickByText(page, "Auto-Generate Trade Packages", { exact: false });
  const genStart = Date.now();
  const pkgs = await pollBackend(async () => {
    const list = await c.query("tradePackages:listByProject", { projectId: proj._id });
    return list.length > 0 ? list : null;
  }, 165000, 4000);
  result.data.specBreakdownMs = Date.now() - genStart;
  if (!pkgs) {
    problems.push({ id: "A9-01", sev: "High", title: "AI Spec Breakdown produced zero packages within 165s", detail: "Modal left open with no success message; deterministic fallback expected." });
  } else {
    step(`spec breakdown created ${pkgs.length} packages in ${result.data.specBreakdownMs}ms`);
    result.data.generatedPackages = pkgs.map((p) => ({ csi: p.csiDivision, trade: p.tradeName, status: p.status, mailbox: p.agentMailbox, shared: !!p.agentMailboxShared }));
    const missingMailbox = pkgs.filter((p) => !p.agentMailbox || !p.agentMailbox.includes("@"));
    if (missingMailbox.length) problems.push({ id: "A9-02", sev: "Medium", title: "Generated package missing inbox label", detail: missingMailbox.map((p) => p.csiDivision).join(",") });
  }
  await shot(page, "fix4-qa9-j1-spec-generated.png");
  // close modal if still open
  await clickByText(page, "Cancel", { exact: true }).catch(() => {});
  await delay(400);

  // --- 3. Manual package create ---
  await clickByText(page, "Create Trade Package", { exact: true });
  await delay(600);
  await typeInto(page, 'input[aria-label="CSI division number"]', MANUAL_DIV);
  await typeInto(page, 'input[aria-label="Trade package name"]', MANUAL_TRADE);
  await typeInto(page, 'input[aria-label="Budget estimate in dollars"]', "315000");
  await typeInto(page, 'textarea[aria-label="Scope summary"]', "Division 10 specialties: signage, toilet accessories, fire extinguisher cabinets.");
  await typeInto(page, 'textarea[aria-label="Mandatory inclusions, one per line"]', "ADA compliant signage\nFire extinguisher cabinets\nToilet accessories");
  const dl = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  await setReactValue(page, 'input[aria-label="Bid deadline"]', dl);
  await clickByText(page, "Create Package", { exact: true });
  const manualPkg = await pollBackend(async () => {
    const list = await c.query("tradePackages:listByProject", { projectId: proj._id });
    return list.find((p) => p.tradeName === MANUAL_TRADE) || null;
  }, 20000);
  result.data.manualPackageId = manualPkg?._id ?? null;
  step(`manual package created=${!!manualPkg}`);
  if (!manualPkg) problems.push({ id: "A9-03", sev: "Medium", title: "Manual trade package not visible in backend after create", detail: MANUAL_TRADE });
  await delay(800);
  await shot(page, "fix4-qa9-j1-manual-package.png");

  // --- 4a. Dispatch without contractors ---
  const dispatchNoCtr = await clickCardButton(MANUAL_TRADE, "Dispatch RFQs");
  result.data.dispatchNoContractorsClick = dispatchNoCtr;
  await delay(2500);
  const toast1 = await toastText();
  result.data.toastNoContractors = toast1;
  step(`dispatch w/o contractors toast: ${JSON.stringify(toast1)}`);
  const manualAfter = manualPkg ? (await c.query("tradePackages:getPackage", { tradePackageId: manualPkg._id })) : null;
  result.data.manualStatusAfterEmptyDispatch = manualAfter?.status;
  if (manualAfter && manualAfter.status !== "draft") problems.push({ id: "A9-04", sev: "Medium", title: "Dispatch with no contractors changed package status", detail: `status=${manualAfter.status}` });
  await shot(page, "fix4-qa9-j1-dispatch-empty.png");

  // --- 4b. Add contractors manually then dispatch ---
  await clickByText(page, "Advance to Contractor Discovery", { exact: false });
  await delay(1200);
  // select the manual package in discovery
  const pickedPkg = await page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes(t));
    if (!b) return false;
    b.click();
    return true;
  }, MANUAL_TRADE);
  result.data.discoveryPackagePicked = pickedPkg;
  await delay(900);
  for (const [i, co] of [
    { name: "QA9 Cascade Mechanical", email: "estimating@qa9-cascade.test", phone: "(208) 555-0141", lic: "ID-QA9-0001" },
    { name: "QA9 Whitewater Electric", email: "bids@qa9-whitewater.test", phone: "(208) 555-0177", lic: "ID-QA9-0002" },
  ].entries()) {
    await clickByText(page, "Add Contractor Manually", { exact: true });
    await delay(600);
    await typeInto(page, 'input[placeholder="e.g. Rosendin Electric, Inc."]', co.name);
    await typeInto(page, 'input[placeholder="estimating@rosendin.com"]', co.email);
    await typeInto(page, 'input[placeholder="(512) 835-2400"]', co.phone);
    await typeInto(page, 'input[placeholder="e.g. TECL-38492"]', co.lic);
    await clickByText(page, "Add to Directory", { exact: true });
    await delay(1500);
  }
  let contractors = await c.query("contractors:listByPackage", { tradePackageId: manualPkg._id }).catch(() => []);
  if (!contractors.length) {
    contractors = (await c.query("contractors:listByProject", { projectId: proj._id })).filter((x) => x.tradePackageId === manualPkg._id);
  }
  result.data.contractorsAfterManualAdd = contractors.map((x) => ({ id: x._id, name: x.companyName, status: x.rfqStatus }));
  step(`manual contractors added=${contractors.length}`);
  await shot(page, "fix4-qa9-j1-contractors-added.png");

  // Dispatch with contractors (packages tab)
  await clickByText(page, "CSI Scoping", { exact: false }).catch(() => {});
  await clickByText(page, "Trade Packages", { exact: false }).catch(() => {});
  await clickByText(page, "Packages", { exact: false }).catch(() => {});
  await delay(1200);
  const dispatchWith = await clickCardButton(MANUAL_TRADE, "Dispatch RFQs");
  result.data.dispatchWithContractorsClick = dispatchWith;
  await delay(3000);
  const toast2 = await toastText();
  result.data.toastWithContractors = toast2;
  step(`dispatch with contractors: click=${JSON.stringify(dispatchWith)} toast=${JSON.stringify(toast2)}`);
  const pkgAfterDispatch = await c.query("tradePackages:listByProject", { projectId: proj._id });
  const mp = pkgAfterDispatch.find((p) => p.tradeName === MANUAL_TRADE);
  result.data.manualStatusAfterDispatch = mp?.status;
  if (mp && mp.status === "draft") problems.push({ id: "A9-05", sev: "Medium", title: "Dispatch RFQs did not update package status", detail: `status still ${mp.status}` });
  contractors = await c.query("contractors:listByProject", { projectId: proj._id });
  result.data.contractorStatusesAfterDispatch = contractors.filter((x) => x.tradePackageId === manualPkg._id).map((x) => `${x.companyName}:${x.rfqStatus}`);
  await shot(page, "fix4-qa9-j1-dispatched.png");

  // --- 5. Discovery via Firecrawl (one run) ---
  await clickByText(page, "Advance to Contractor Discovery", { exact: false }).catch(() => {});
  await delay(1000);
  const before = (await c.query("contractors:listByProject", { projectId: proj._id })).length;
  await clickByText(page, "Discover Trade Contractors", { exact: true });
  const discoveryStart = Date.now();
  const afterDiscovery = await pollBackend(async () => {
    const list = await c.query("contractors:listByProject", { projectId: proj._id });
    return list.length > before ? list : null;
  }, 120000, 4000);
  result.data.discoveryMs = Date.now() - discoveryStart;
  result.data.discoveryInserted = afterDiscovery ? afterDiscovery.length - before : 0;
  step(`firecrawl discovery inserted=${result.data.discoveryInserted} in ${result.data.discoveryMs}ms`);
  await delay(1500);
  await shot(page, "fix4-qa9-j1-discovery.png");

  // --- 6. Invite a contractor ---
  const inviteTarget = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").trim().includes("Invite to Bid"));
    if (!btns.length) return { ok: false, count: 0 };
    btns[0].scrollIntoView({ block: "center" });
    const r = btns[0].getBoundingClientRect();
    return { ok: true, count: btns.length, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  result.data.inviteButtonsFound = inviteTarget.count;
  if (inviteTarget.ok) {
    await page.mouse.click(inviteTarget.x, inviteTarget.y);
    await delay(3500);
    const all = await c.query("contractors:listByProject", { projectId: proj._id });
    result.data.afterInvite = all.map((x) => `${x.companyName}:${x.rfqStatus}`).slice(0, 20);
    step(`invited; statuses=${result.data.afterInvite.filter((s) => s.includes("invited")).length} invited`);
  } else {
    problems.push({ id: "A9-06", sev: "Medium", title: "No 'Invite to Bid' control rendered after discovery", detail: `inserted=${result.data.discoveryInserted}` });
  }

  // --- 7. Edit a contractor ---
  const editOpened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[title="Edit contractor info"]')][0];
    if (!b) return false;
    b.scrollIntoView({ block: "center" });
    b.click();
    return true;
  });
  result.data.editOpened = editOpened;
  if (editOpened) {
    await delay(600);
    await typeInto(page, 'input[aria-label="Phone number"]', "(208) 555-0999");
    await clickByText(page, "Save Changes", { exact: true });
    await delay(2000);
    const all = await c.query("contractors:listByProject", { projectId: proj._id });
    result.data.phoneEdited = all.some((x) => x.phone === "(208) 555-0999");
    step(`contractor edit saved=${result.data.phoneEdited}`);
    if (!result.data.phoneEdited) problems.push({ id: "A9-07", sev: "Medium", title: "Edit contractor did not persist phone change" });
  }

  // --- 8. Delete a contractor ---
  const delOpened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[title="Delete contractor"]')][0];
    if (!b) return false;
    b.scrollIntoView({ block: "center" });
    b.click();
    return true;
  });
  result.data.deleteOpened = delOpened;
  if (delOpened) {
    await delay(500);
    await clickByText(page, "Remove contractor", { exact: true });
    await delay(2500);
    const all = await c.query("contractors:listByProject", { projectId: proj._id });
    result.data.afterDeleteCount = all.length;
    const stillThere = all.some((x) => x.phone === "(208) 555-0999");
    result.data.deletedContractorGone = !stillThere;
    step(`contractor delete: gone=${!stillThere} remaining=${all.length}`);
    if (stillThere) problems.push({ id: "A9-08", sev: "Medium", title: "Delete contractor did not remove record", detail: "edited phone record still present" });
  } else if (result.data.editOpened) {
    problems.push({ id: "A9-08", sev: "Medium", title: "Delete contractor control missing though edit exists" });
  }
  await shot(page, "fix4-qa9-j1-after-contractor-ops.png");

  const finalProjects = await c.query("projects:listProjects", {});
  result.data.finalPackageCount = (await c.query("tradePackages:listByProject", { projectId: proj._id })).length;
  result.data.duplicateProjects = finalProjects.filter((p) => p.title === PROJECT).length;
  if (result.data.duplicateProjects > 1) problems.push({ id: "A9-09", sev: "High", title: "Duplicate project created from one submit", detail: `count=${result.data.duplicateProjects}` });
  result.console = diagnosticsSummary(diag);
} catch (err) {
  problems.push({ id: "A9-90", sev: "High", title: "J1 crashed: " + (err?.message ?? String(err)).split("\n")[0] });
  await shot(page, "fix4-qa9-j1-crash.png").catch(() => {});
} finally {
  result.findings = problems;
  result.verdict = problems.some((p) => p.sev === "High") ? "blocked" : problems.length ? "complete-with-issues" : "complete";
  writeEvidence("j1-estimator", result);
  await browser.close();
}
console.log(`J1 verdict=${result.verdict} findings=${problems.length}`);