/**
 * QA9 Journey 3: Bid lifecycle — ingest clean/deceptive/absurd low, leveling ranks,
 * suspicious-low banner, adjustments, award, agreement, unaward/re-award, execute,
 * guarded mutations, deletes where allowed.
 * Evidence: evidence/fix4-qa9-j3-*.json
 */
import {
  client, launchBrowser, attachDiagnostics, diagnosticsSummary, waitForAppReady, delay,
  selectProjectByTitle, clickByText, setReactValue, typeInto, shot, writeEvidence, FIXTURE_TAG,
} from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J3-BIDS`;
const log = []; const problems = [];
const step = (s) => { log.push(s); console.log("STEP:", s); };
const guard = async (label, fn) => {
  try { const v = await fn(); console.log(`  UNGUARDED ${label}:`, JSON.stringify(v).slice(0, 160)); return { label, rejected: false, value: JSON.stringify(v).slice(0, 200) }; }
  catch (e) { const d = e?.data; console.log(`  GUARDED ${label}: ${typeof d === "string" ? d : e.message.split("\n")[0]}`); return { label, rejected: true, message: (typeof d === "string" ? d : e.message).slice(0, 240) }; }
};

for (const p of (await c.query("projects:listProjects", {})).filter((x) => x.title === PROJECT)) {
  try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
}
const projId = await c.mutation("projects:createProject", {
  title: PROJECT, location: "Denver, CO", projectType: "Commercial Mixed-Use",
  estBudget: 4200000, targetCompletionWeeks: 60, specDocumentText: "QA9 J3 fixture.", isDemoProject: false,
});
const pkgId = await c.mutation("tradePackages:createTradePackage", {
  projectId: projId, csiDivision: "26 00 00", tradeName: "QA9 Electrical Buyout",
  budgetEstimate: 1250000, scopeSummary: "Switchgear, feeders, emergency lighting.",
  mandatoryInclusions: ["Seismic bracing", "UL 1479 firestopping", "Crane hoisting"],
  bidDeadline: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
});
const mkCtr = async (name, email) => c.mutation("contractors:createContractor", {
  tradePackageId: pkgId, companyName: name, contactEmail: email, phone: "(303) 555-0100",
  licenseNumber: `CO-QA9-${name.length}`, licenseStatus: "Active & Verified", sourceUrl: "https://qa9.test", rfqStatus: "invited",
});
const ctrClean = await mkCtr("QA9 Clean Electric", "clean@qa9.test");
const ctrDecept = await mkCtr("QA9 Deceptive Electric", "deceptive@qa9.test");
const ctrLow = await mkCtr("QA9 Absurd Low Electric", "low@qa9.test");
const result = { journey: "J3", ids: { projectId: projId, pkgId, ctrClean, ctrDecept, ctrLow }, steps: log, data: {} };

const QUOTES = {
  clean: `SUBCONTRACTOR PROPOSAL\nSubcontractor: QA9 Clean Electric\nProject: ${PROJECT}\nBase Bid: $1,150,000\nLead Time: 10 weeks\nCOI Compliance: compliant\nExclusions: none\nIncludes complete Division 26 scope, switchgear, feeders, emergency lighting, seismic bracing, firestopping and crane hoisting.`,
  deceptive: `SUBCONTRACTOR PROPOSAL\nSubcontractor: QA9 Deceptive Electric\nBase Bid: $980,000\nEXCLUSIONS:\n- Crane hoisting & rigging of switchgear: $95,000\n- UL 1479 firestopping at rated penetrations: $42,000\n- Seismic bracing for conduits and cable trays: $38,000\nVE ALTERNATE: LED luminaire retrofit credit -$25,000\nLead Time: 18 weeks\nInsurance COI deficiency: $15,000 penalty`,
  low: `SUBCONTRACTOR PROPOSAL\nSubcontractor: QA9 Absurd Low Electric\nBase Bid: $300,000\nIncludes all Division 26 scope.\nLead Time: 12 weeks\nCOI Compliance: compliant`,
};

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);

const bids = async () => c.query("bids:listByPackage", { tradePackageId: pkgId });
const agreements = async () => c.query("agreements:listAgreements", { projectId: projId });
async function clickInCard(cardText, buttonText) {
  const hit = await page.evaluate((ct, bt) => {
    const cards = [...document.querySelectorAll("div")]
      .filter((d) => [...d.querySelectorAll("button")].some((b) => (b.textContent || "").trim().includes(bt) || (b.getAttribute("title") || "").includes(bt)))
      .filter((d) => (d.textContent || "").includes(ct))
      .sort((a, b) => a.textContent.length - b.textContent.length);
    const card = cards[0];
    if (!card) return { ok: false };
    const b = [...card.querySelectorAll("button")].find((x) => (x.textContent || "").trim().includes(bt) || (x.getAttribute("title") || "").includes(bt));
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, cardHead: card.textContent.slice(0, 70) };
  }, cardText, buttonText);
  if (hit.ok) await page.mouse.click(hit.x, hit.y);
  return hit;
}
async function ingest(ctrId, fileName, quoteText, expectedName) {
  const before = (await bids()).length;
  await clickByText(page, "Ingest Quote / PDF", { exact: false });
  await page.waitForSelector('select[aria-label="Subcontractor or bidder for this proposal"]', { timeout: 10000 });
  await page.evaluate((v) => {
    const sel = document.querySelector('select[aria-label="Subcontractor or bidder for this proposal"]');
    sel.value = v; sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, ctrId);
  await setReactValue(page, 'input[aria-label="Document or proposal filename"]', fileName);
  await setReactValue(page, 'textarea[aria-label="Proposal OCR text or pasted quote"]', quoteText);
  await delay(400);
  await clickByText(page, "Extract & Level Bid", { exact: true });
  const start = Date.now();
  let bid = null;
  while (Date.now() - start < 200000) {
    const list = await bids().catch(() => []);
    if (list.length > before) { bid = list.find((b) => b.contractorId === ctrId) || list[list.length - 1]; break; }
    await delay(4000);
  }
  if (!bid) problems.push({ id: "A9-40", sev: "High", title: `Quote ingest failed/timed out: ${expectedName}` });
  return { bid, ms: Date.now() - start };
}

try {
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, PROJECT);
  await delay(1500);
  await page.keyboard.press("Digit4");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("Ingest Quote")), { timeout: 15000 });
  await delay(800);

  result.data.ingest = {};
  for (const [key, ctr, file] of [["clean", ctrClean, "QA9_Clean_Bid.txt"], ["deceptive", ctrDecept, "QA9_Deceptive_Bid.txt"], ["low", ctrLow, "QA9_AbsurdLow_Bid.txt"]]) {
    const r = await ingest(ctr, file, QUOTES[key], key);
    result.data.ingest[key] = r.bid ? { id: r.bid._id, base: r.bid.baseBidAmount, leveled: r.bid.leveledTotalCost, exclusions: (r.bid.identifiedExclusions || []).length, ve: (r.bid.valueEngineeringAlternates || []).length, weeks: r.bid.longLeadEquipmentWeeks, leadPenalty: r.bid.leadTimePenalty, coiPenalty: r.bid.coiPenalty, coi: r.bid.coiComplianceStatus, ms: r.ms } : null;
    step(`ingest ${key}: ${JSON.stringify(result.data.ingest[key])}`);
    await delay(1500);
  }

  // ---- ranks + flags ----
  const list = (await bids()).slice().sort((a, b) => a.leveledTotalCost - b.leveledTotalCost);
  result.data.ranks = list.map((b, i) => ({ rank: i + 1, name: b.subcontractorName, base: b.baseBidAmount, leveled: b.leveledTotalCost }));
  const threshold = 1250000 * 0.5;
  result.data.suspiciousIds = list.filter((b) => b.leveledTotalCost > 0 && b.leveledTotalCost < threshold).map((b) => b.subcontractorName);
  const uiFlags = await page.evaluate(() => document.body.innerText.split("\n").filter((l) => /Verify — unusually low/i.test(l)).length);
  result.data.uiSuspiciousBadges = uiFlags;
  result.data.uiBannerText = await page.evaluate(() => document.body.innerText.split("\n").filter((l) => /far below the/i.test(l)).slice(0, 3).join(" | "));
  step(`ranks=${JSON.stringify(result.data.ranks)} suspicious=${JSON.stringify(result.data.suspiciousIds)} badges=${uiFlags}`);
  if (!result.data.suspiciousIds.includes("QA9 Absurd Low Electric")) problems.push({ id: "A9-41", sev: "High", title: "Absurdly low bid not flagged suspicious" });
  if (uiFlags === 0) problems.push({ id: "A9-42", sev: "Medium", title: "Suspicious-low badge not rendered in UI", detail: `threshold=${threshold}` });
  await shot(page, "fix4-qa9-j3-ranks.png");

  // ---- adjustments: waive exclusion + accept VE on deceptive ----
  const adjOpen = await clickInCard("QA9 Deceptive Electric", "Adjust Leveling");
  await delay(1000);
  const adj = await page.evaluate(() => {
    const waive = [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").includes("Waive Exclusion"));
    const accept = [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").includes("Accept Alternate"));
    const preview = document.body.innerText.match(/Updated Total: \$[\d,]+/)?.[0] || null;
    if (waive[0]) waive[0].click();
    if (accept[0]) accept[0].click();
    return { waiveButtons: waive.length, acceptButtons: accept.length, previewBefore: preview };
  });
  result.data.adjustments = adj;
  await delay(600);
  const previewAfter = await page.evaluate(() => document.body.innerText.match(/Updated Total: \$[\d,]+/)?.[0] || null);
  result.data.adjustments.previewAfter = previewAfter;
  await clickByText(page, "Save Leveling Adjustments", { exact: true });
  await delay(3000);
  const deceptAfter = (await bids()).find((b) => b._id === result.data.ingest.deceptive?.id);
  result.data.deceptiveAfterAdj = deceptAfter ? { leveled: deceptAfter.leveledTotalCost, waived: (deceptAfter.identifiedExclusions || []).filter((e) => e.isWaived).length, acceptedVe: (deceptAfter.valueEngineeringAlternates || []).filter((v) => v.isAccepted).length } : null;
  step(`adjustments: ${JSON.stringify(adj)} -> ${JSON.stringify(result.data.deceptiveAfterAdj)}`);
  if (!deceptAfter || !(deceptAfter.identifiedExclusions || []).some((e) => e.isWaived)) problems.push({ id: "A9-43", sev: "Medium", title: "Waive exclusion did not persist", detail: JSON.stringify(result.data.deceptiveAfterAdj) });
  await shot(page, "fix4-qa9-j3-adjusted.png");

  // ---- award clean ----
  const awardClick = await clickInCard("QA9 Clean Electric", "Award Subcontract & Draft Agreement");
  const awardClick2 = awardClick.ok ? awardClick : await clickInCard("QA9 Clean Electric", "Award Compliant Winner");
  await delay(6000);
  let cleanBid = (await bids()).find((b) => b._id === result.data.ingest.clean?.id);
  let agrs = await agreements();
  result.data.award = { click: awardClick2, isAwarded: cleanBid?.isAwarded, agreement: agrs[0] ? { number: agrs[0].agreementNumber, status: agrs[0].status, sum: agrs[0].contractSum } : null };
  step(`award: awarded=${cleanBid?.isAwarded} agreement=${JSON.stringify(result.data.award.agreement)}`);
  if (!cleanBid?.isAwarded) problems.push({ id: "A9-44", sev: "High", title: "Award did not set bid awarded", detail: JSON.stringify(awardClick2) });
  if (agrs.length === 0) problems.push({ id: "A9-45", sev: "High", title: "Award did not generate agreement" });

  // ---- inspect agreement ----
  const inspect = await clickInCard("QA9 Clean Electric", "Inspect Agreement");
  await delay(1500);
  result.data.agreementModal = await page.evaluate(() => {
    const t = document.body.innerText;
    return { hasA401: t.includes("A401-style Subcontract Draft"), hasNotLicensed: t.includes("not an AIA-licensed form"), snippet: t.split("\n").filter((l) => /SUBCONTRACT|Agreement|contract sum|A401/i.test(l)).slice(0, 6).join(" | ") };
  });
  await shot(page, "fix4-qa9-j3-agreement.png");
  await clickByText(page, "Close Viewer", { exact: true });
  await delay(600);
  step(`agreement modal: ${JSON.stringify(result.data.agreementModal)}`);

  // ---- unaward ----
  const unaward = await clickInCard("QA9 Clean Electric", "Unaward");
  await delay(700);
  if (unaward.ok) { await clickByText(page, "Unaward proposal", { exact: true }); await delay(3000); }
  cleanBid = (await bids()).find((b) => b._id === result.data.ingest.clean?.id);
  agrs = await agreements();
  result.data.unaward = { click: unaward, isAwarded: cleanBid?.isAwarded, agreementStatus: agrs[0]?.status };
  step(`unaward: awarded=${cleanBid?.isAwarded} agr=${agrs[0]?.status}`);

  // ---- re-award ----
  await clickInCard("QA9 Clean Electric", "Award");
  await delay(5000);
  cleanBid = (await bids()).find((b) => b._id === result.data.ingest.clean?.id);
  agrs = await agreements();
  result.data.reAward = { isAwarded: cleanBid?.isAwarded, agreements: agrs.map((a) => `${a.agreementNumber}:${a.status}`) };
  step(`re-award: awarded=${cleanBid?.isAwarded} agrs=${JSON.stringify(result.data.reAward.agreements)}`);

  // ---- execute via Contracts tab ----
  await page.keyboard.press("Digit6");
  await waitForAppReady(page).catch(() => {});
  await delay(1800);
  const execClick = await clickByText(page, "Record Execution Status", { exact: false });
  result.data.execClick = execClick;
  await delay(700);
  const confirmExec = await clickByText(page, "Record execution", { exact: true });
  result.data.confirmExec = confirmExec;
  await delay(3500);
  agrs = await agreements();
  const executedAgr = agrs.find((a) => a.status === "executed");
  result.data.execute = { executed: Boolean(executedAgr), agreement: executedAgr?.agreementNumber };
  step(`execute: execClick=${JSON.stringify(execClick)} confirmed=${confirmExec.ok} executed=${Boolean(executedAgr)}`);
  if (!executedAgr) {
    const inline = await clickInCard("QA9 Electrical Buyout", "Record External Execution").catch(() => ({ ok: false }));
    result.data.execute.inlineFallback = inline;
    await delay(700);
    await clickByText(page, "Record execution", { exact: true }).catch(() => {});
    await delay(3000);
    agrs = await agreements();
    result.data.execute.executed2 = Boolean(agrs.find((a) => a.status === "executed"));
    if (!result.data.execute.executed2) problems.push({ id: "A9-46", sev: "High", title: "Execute agreement did not record execution", detail: JSON.stringify(result.data.execute) });
  }
  await shot(page, "fix4-qa9-j3-executed.png");

  // ---- guarded mutations ----
  const bidCleanId = result.data.ingest.clean?.id;
  const bidLowId = result.data.ingest.low?.id;
  const agrId = agrs[0]?._id;
  const guessed = [];
  guessed.push(await guard("deleteBid(executed)", () => c.mutation("bids:deleteBid", { bidId: bidCleanId })));
  guessed.push(await guard("unaward(executed)", () => c.mutation("bids:unawardContract", { bidId: bidCleanId, tradePackageId: pkgId })));
  if (agrId) guessed.push(await guard("executeAgain", () => c.mutation("agreements:executeAgreement", { agreementId: agrId })));
  guessed.push(await guard("deletePackage(executed)", () => c.mutation("tradePackages:deleteTradePackage", { tradePackageId: pkgId })));
  guessed.push(await guard("deleteContractor(with bids)", () => c.mutation("contractors:deleteContractor", { contractorId: ctrDecept })));
  result.data.guards = guessed;
  step(`guards: ${guessed.map((g) => `${g.label}=${g.rejected ? "rejected" : "ALLOWED"}`).join(", ")}`);

  // ---- delete where allowed: absurd low bid + its contractor ----
  const delBid = await clickInCard("QA9 Absurd Low Electric", "Delete");
  await delay(700);
  const delConfirm = await clickByText(page, "Delete proposal", { exact: true });
  await delay(3000);
  const lowGone = !(await bids()).some((b) => b._id === bidLowId);
  result.data.deleteBid = { click: delBid, confirmed: delConfirm, gone: lowGone };
  step(`delete absurd bid: gone=${lowGone}`);
  if (!lowGone) problems.push({ id: "A9-47", sev: "Medium", title: "Delete bid (unawarded, no executed agreement) did not remove record" });

  await page.keyboard.press("Digit2");
  await delay(1500);
  const delCtr = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[title="Delete contractor"]')][0];
    if (!b) return false;
    b.scrollIntoView({ block: "center" }); b.click(); return true;
  });
  if (delCtr) { await delay(600); await clickByText(page, "Remove contractor", { exact: true }); await delay(2500); }
  const ctrs = (await c.query("contractors:listByProject", { projectId: projId })).filter((x) => x.tradePackageId === pkgId);
  result.data.deleteContractor = { opened: delCtr, remaining: ctrs.map((x) => x.companyName) };
  step(`delete contractor: remaining=${JSON.stringify(result.data.deleteContractor.remaining)}`);
  await shot(page, "fix4-qa9-j3-final.png");
  result.console = diagnosticsSummary(diag);
} catch (err) {
  problems.push({ id: "A9-90", sev: "High", title: "J3 crashed: " + (err?.message ?? String(err)).split("\n")[0] });
  await shot(page, "fix4-qa9-j3-crash.png").catch(() => {});
} finally {
  result.findings = problems;
  result.verdict = problems.some((p) => p.sev === "High") ? "blocked" : problems.length ? "complete-with-issues" : "complete";
  writeEvidence("j3-bids", result);
  await browser.close();
}
console.log(`J3 verdict=${result.verdict} findings=${problems.length}`);