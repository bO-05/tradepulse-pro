/**
 * QA9 Journey 6: recovery — reload mid-flow, deep-link each tab, Back/Forward,
 * two-tab realtime propagation for RFI and bid.
 * Evidence: evidence/fix4-qa9-j6-*.json
 */
import { client, launchBrowser, attachDiagnostics, diagnosticsSummary, waitForAppReady, delay, selectProjectByTitle, clickByText, typeInto, shot, writeEvidence, FIXTURE_TAG } from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J6-RECOVERY`;
const log = []; const problems = [];
const step = (s) => { log.push(s); console.log("STEP:", s); };

for (const p of (await c.query("projects:listProjects", {})).filter((x) => x.title === PROJECT)) {
  try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
}
const projId = await c.mutation("projects:createProject", {
  title: PROJECT, location: "Nashville, TN", projectType: "Commercial Office",
  estBudget: 1800000, targetCompletionWeeks: 50, specDocumentText: "QA9 J6 fixture.", isDemoProject: false,
});
const pkgId = await c.mutation("tradePackages:createTradePackage", {
  projectId: projId, csiDivision: "26 00 00", tradeName: "QA9 Recovery Electric",
  budgetEstimate: 900000, scopeSummary: "Recovery probe package.",
  mandatoryInclusions: ["Seismic bracing"], bidDeadline: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
});
const ctrId = await c.mutation("contractors:createContractor", {
  tradePackageId: pkgId, companyName: "QA9 Recovery Electric Co", contactEmail: "bids@qa9-recovery.test",
  phone: "(615) 555-0101", licenseNumber: "TN-QA9-1", licenseStatus: "Active & Verified",
  sourceUrl: "https://qa9-recovery.test", rfqStatus: "invited",
});
const result = { journey: "J6", ids: { projectId: projId, pkgId }, steps: log, data: {} };
const { browser } = await launchBrowser(1440, 950);
const pageA = await browser.newPage();
const diagA = attachDiagnostics(pageA);

const MARKERS = {
  packages: "Document type for upload",
  discovery: "Discover Trade Contractors",
  qna: "Target trade package for this RFI",
  leveling: "Ingest Quote / PDF",
  coordination: "Run Forensic Clash Scan",
  contracts: "Search by agreement #",
  audit: "Run Deadline Cron",
  diagnostics: "Evals",
};
async function markerPresent(p, text) {
  return p.evaluate((t) => document.body.innerText.includes(t), text);
}
async function loadDeep(p, tab) {
  const url = `https://brainy-skunk-440.convex.site/?project=${projId}&tab=${tab}`;
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  try {
    await waitForAppReady(p, 30000);
  } catch {
    await p.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(p, 45000);
  }
  await delay(900);
}

try {
  // ---- deep-link each tab ----
  result.data.deepLinks = {};
  for (const [tab, marker] of Object.entries(MARKERS)) {
    await loadDeep(pageA, tab);
    const ok = await markerPresent(pageA, marker);
    const label = await pageA.evaluate(() => {
      const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      return sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].textContent.trim() : null;
    });
    const url = pageA.url();
    result.data.deepLinks[tab] = { ok, label, url: url.slice(url.indexOf("?")) };
    step(`deep-link ${tab}: ok=${ok} url=${url.slice(url.indexOf("?"))}`);
    if (!ok) problems.push({ id: "A9-80", sev: "Medium", title: `Deep-link tab=${tab} did not render expected view`, detail: `marker=${marker}` });
    if (!label || !label.includes(PROJECT)) problems.push({ id: "A9-81", sev: "Medium", title: `Deep-link tab=${tab} did not select the URL project`, detail: String(label) });
  }
  // invalid tab fallback
  await loadDeep(pageA, "bogus");
  result.data.invalidTab = { packagesRendered: await markerPresent(pageA, MARKERS.packages), url: pageA.url() };
  step(`invalid tab fallback: ${JSON.stringify(result.data.invalidTab)}`);

  // ---- Back/Forward ----
  await loadDeep(pageA, "qna");
  await delay(800);
  await pageA.keyboard.press("Digit4");
  await delay(1500);
  const beforeBack = { leveling: await markerPresent(pageA, MARKERS.leveling), url: pageA.url().slice(pageA.url().indexOf("?")) };
  await pageA.goBack({ waitUntil: "domcontentloaded" });
  await delay(1200);
  const afterBack = { qna: await markerPresent(pageA, MARKERS.qna), url: pageA.url().slice(pageA.url().indexOf("?")) };
  await pageA.goForward({ waitUntil: "domcontentloaded" });
  await delay(1200);
  const afterForward = { leveling: await markerPresent(pageA, MARKERS.leveling), url: pageA.url().slice(pageA.url().indexOf("?")) };
  result.data.history = { beforeBack, afterBack, afterForward };
  step(`history back->qna=${afterBack.qna} forward->leveling=${afterForward.leveling}`);
  if (!afterBack.qna) problems.push({ id: "A9-82", sev: "Medium", title: "Back button did not restore previous tab view", detail: JSON.stringify(afterBack) });
  if (!afterForward.leveling) problems.push({ id: "A9-83", sev: "Medium", title: "Forward button did not restore next tab view", detail: JSON.stringify(afterForward) });

  // ---- reload mid-flow (RFI) ----
  await loadDeep(pageA, "qna");
  const subj = "QA9 J6 reload mid-flow probe";
  await typeInto(pageA, 'input[aria-label="RFI subject or scope topic"]', subj);
  await typeInto(pageA, 'textarea[aria-label="Subcontractor question"]', "Confirm seismic bracing coordination for the recovery probe.");
  await clickByText(pageA, "Submit RFI for Clarification", { exact: true });
  await delay(900);
  const preReloadPending = await pageA.evaluate(() => /Analysis in progress|Analyzing|pending/i.test(document.body.innerText));
  await pageA.reload({ waitUntil: "domcontentloaded" });
  await waitForAppReady(pageA);
  await delay(2500);
  result.data.reload = { preReloadPending, stillShowsQuestion: await markerPresent(pageA, subj) };
  const start = Date.now();
  let convo = null;
  while (Date.now() - start < 150000) {
    const list = await c.query("rfq:listConversations", { tradePackageId: pkgId }).catch(() => []);
    convo = list.find((x) => x.inboundSubject === subj);
    if (convo && convo.status !== "pending_analysis") break;
    await delay(3000);
  }
  result.data.reload.finalStatus = convo?.status ?? null;
  result.data.reload.questionPreserved = convo?.inboundQuestion?.includes("seismic bracing") ?? false;
  step(`reload mid-flow: pendingSeen=${preReloadPending} status=${convo?.status} preserved=${result.data.reload.questionPreserved}`);
  if (!convo) problems.push({ id: "A9-84", sev: "High", title: "RFI submitted then reloaded was lost (no record after reload)" });
  else if (!result.data.reload.questionPreserved) problems.push({ id: "A9-85", sev: "Medium", title: "Reloaded RFI lost the submitted question text" });
  await shot(pageA, "fix4-qa9-j6-reload.png");

  // ---- two-tab realtime: RFI + bid ----
  const pageB = await browser.newPage();
  const diagB = attachDiagnostics(pageB);
  await pageB.goto(`https://brainy-skunk-440.convex.site/?project=${projId}&tab=qna`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(pageB);
  await delay(1500);
  const countRfis = () => pageB.evaluate(() => {
    const m = document.body.innerText.match(/active package has (\d+) RFI/);
    return m ? Number(m[1]) : null;
  });
  const beforeCount = await countRfis();
  const subj2 = "QA9 J6 realtime RFI probe";
  await c.mutation("simulation:submitCustomRfi", { tradePackageId: pkgId, subject: subj2, question: "Realtime propagation check for the recovery probe." });
  const rtStart = Date.now();
  let afterCount = null;
  while (Date.now() - rtStart < 40000) {
    await delay(1200);
    afterCount = await countRfis();
    if (afterCount !== null && beforeCount !== null && afterCount > beforeCount) break;
  }
  result.data.realtimeRfi = { beforeCount, afterCount, ms: Date.now() - rtStart, appeared: afterCount > beforeCount };
  step(`realtime RFI: ${beforeCount} -> ${afterCount} in ${result.data.realtimeRfi.ms}ms`);
  if (!(afterCount > beforeCount)) problems.push({ id: "A9-86", sev: "High", title: "Second tab did not receive RFI in realtime", detail: JSON.stringify(result.data.realtimeRfi) });

  const pageC = await browser.newPage();
  await pageC.goto(`https://brainy-skunk-440.convex.site/?project=${projId}&tab=leveling`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(pageC);
  await delay(1500);
  const bidVisible = () => pageC.evaluate(() => /QA9 Realtime Bid Co/.test(document.body.innerText));
  const bidName = "QA9 Realtime Bid Co";
  await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId, contractorId: ctrId, subcontractorName: bidName,
    baseBidAmount: 655000, coiComplianceStatus: "compliant", longLeadEquipmentWeeks: 9, leadTimePenalty: 0,
  });
  const rtBidStart = Date.now();
  let seen = false;
  while (Date.now() - rtBidStart < 40000) {
    await delay(1200);
    seen = await bidVisible();
    if (seen) break;
  }
  result.data.realtimeBid = { seen, ms: Date.now() - rtBidStart };
  step(`realtime bid: seen=${seen} in ${result.data.realtimeBid.ms}ms`);
  if (!seen) problems.push({ id: "A9-87", sev: "High", title: "Second tab did not receive bid in realtime" });
  await shot(pageB, "fix4-qa9-j6-tabB.png");
  await shot(pageC, "fix4-qa9-j6-tabC.png");
  result.consoleA = diagnosticsSummary(diagA);
  result.consoleB = diagnosticsSummary(diagB);
} catch (err) {
  problems.push({ id: "A9-90", sev: "High", title: "J6 crashed: " + (err?.message ?? String(err)).split("\n")[0] });
  await shot(pageA, "fix4-qa9-j6-crash.png").catch(() => {});
} finally {
  result.findings = problems;
  result.verdict = problems.some((p) => p.sev === "High") ? "blocked" : problems.length ? "complete-with-issues" : "complete";
  writeEvidence("j6-recovery", result);
  await browser.close();
}
console.log(`J6 verdict=${result.verdict} findings=${problems.length}`);