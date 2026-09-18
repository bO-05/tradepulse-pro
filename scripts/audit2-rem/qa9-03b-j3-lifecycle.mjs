/**
 * QA9 J3b: bid lifecycle on a fresh package (award -> inspect -> unaward -> re-award
 * -> execute -> guarded mutations -> allowed deletes). Evidence: evidence/fix4-qa9-j3b-*.json
 */
import {
  client, launchBrowser, attachDiagnostics, diagnosticsSummary, waitForAppReady, delay,
  selectProjectByTitle, clickByText, shot, writeEvidence, FIXTURE_TAG,
} from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J3-BIDS`;
const proj = (await c.query("projects:listProjects", {})).find((p) => p.title === PROJECT);
if (!proj) throw new Error("J3 project missing");
const log = []; const problems = [];
const step = (s) => { log.push(s); console.log("STEP:", s); };
const guard = async (label, fn) => {
  try { const v = await fn(); return { label, rejected: false, value: JSON.stringify(v).slice(0, 160) }; }
  catch (e) { const d = e?.data; return { label, rejected: true, message: String(typeof d === "string" ? d : e.message).slice(0, 240) }; }
};

const pkgId = await c.mutation("tradePackages:createTradePackage", {
  projectId: proj._id, csiDivision: "27 00 00", tradeName: "QA9 Buyout Lifecycle",
  budgetEstimate: 1250000, scopeSummary: "Lifecycle probe.", mandatoryInclusions: ["Turnkey"],
  bidDeadline: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
});
const mkCtr = (name, email) => c.mutation("contractors:createContractor", {
  tradePackageId: pkgId, companyName: name, contactEmail: email, phone: "(303) 555-0100",
  licenseNumber: "CO-QA9-L", licenseStatus: "Active & Verified", sourceUrl: "https://qa9.test", rfqStatus: "invited",
});
const ctrClean = await mkCtr("QA9 Lifecycle Clean", "lc-clean@qa9.test");
const ctrDecept = await mkCtr("QA9 Lifecycle Deceptive", "lc-decept@qa9.test");
const ctrLow = await mkCtr("QA9 Lifecycle Low", "lc-low@qa9.test");
const bidClean = await c.mutation("bids:submitDirectBid", {
  tradePackageId: pkgId, contractorId: ctrClean, subcontractorName: "QA9 Lifecycle Clean",
  baseBidAmount: 1150000, coiComplianceStatus: "compliant", longLeadEquipmentWeeks: 10, leadTimePenalty: 0, coiPenalty: 0,
});
const bidDecept = await c.mutation("bids:submitDirectBid", {
  tradePackageId: pkgId, contractorId: ctrDecept, subcontractorName: "QA9 Lifecycle Deceptive",
  baseBidAmount: 980000,
  identifiedExclusions: [
    { description: "Crane hoisting & rigging of switchgear", costImpact: 95000, severity: "high" },
    { description: "UL 1479 firestopping", costImpact: 42000, severity: "medium" },
    { description: "Seismic bracing", costImpact: 38000, severity: "medium" },
  ],
  valueEngineeringAlternates: [{ description: "LED luminaire retrofit credit", costDeduct: 25000, isAccepted: true }],
  coiComplianceStatus: "deficiency_detected", longLeadEquipmentWeeks: 18, leadTimePenalty: 36000, coiPenalty: 15000,
});
const bidLow = await c.mutation("bids:submitDirectBid", {
  tradePackageId: pkgId, contractorId: ctrLow, subcontractorName: "QA9 Lifecycle Low",
  baseBidAmount: 300000, coiComplianceStatus: "compliant", longLeadEquipmentWeeks: 12, leadTimePenalty: 0, coiPenalty: 0,
});

const result = { journey: "J3b", ids: { projectId: proj._id, pkgId, bidClean: bidClean.bidId, bidDecept: bidDecept.bidId, bidLow: bidLow.bidId }, steps: log, data: {} };
const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
const bids = async () => c.query("bids:listByPackage", { tradePackageId: pkgId });
const agrs = async () => c.query("agreements:listAgreements", { projectId: proj._id });
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
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, cardHead: card.textContent.slice(0, 60) };
  }, cardText, buttonText);
  if (hit.ok) await page.mouse.click(hit.x, hit.y);
  return hit;
}
async function toastNow(timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await page.evaluate(() => { const el = document.querySelector('[role="status"]'); return el ? el.innerText.trim() : null; });
    if (t) return t;
    await delay(150);
  }
  return null;
}

try {
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, PROJECT);
  await delay(1500);
  await page.keyboard.press("Digit4");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("Ingest Quote")), { timeout: 15000 });
  await delay(800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("QA9 Buyout Lifecycle"));
    if (b) b.click();
  });
  await delay(1500);
  const list = (await bids()).slice().sort((a, b) => a.leveledTotalCost - b.leveledTotalCost);
  result.data.ranks = list.map((b, i) => ({ rank: i + 1, name: b.subcontractorName, base: b.baseBidAmount, leveled: b.leveledTotalCost }));
  result.data.banner = await page.evaluate(() => document.body.innerText.split("\n").filter((l) => /far below the/i.test(l)).slice(0, 2).join(" | "));
  result.data.lowBadge = await page.evaluate(() => document.body.innerText.split("\n").filter((l) => /Verify — unusually low/i.test(l)).length);
  step(`ranks=${JSON.stringify(result.data.ranks)} banner=${!!result.data.banner} lowBadge=${result.data.lowBadge}`);

  // adjustments with retry-on-flake
  const adjOpen = await clickInCard("QA9 Lifecycle Deceptive", "Adjust Leveling");
  await delay(1000);
  result.data.adjOpen = adjOpen;
  await page.evaluate(() => {
    const w = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Waive Exclusion"));
    if (w) w.click();
  });
  await delay(700);
  result.data.adjPreview = await page.evaluate(() => document.body.innerText.match(/Updated Total: \$[\d,]+/)?.[0] || null);
  await clickByText(page, "Save Leveling Adjustments", { exact: true });
  await delay(2500);
  let decept = (await bids()).find((b) => b._id === bidDecept.bidId);
  result.data.adjSavedFirstTry = (decept?.identifiedExclusions || []).some((e) => e.isWaived);
  if (!result.data.adjSavedFirstTry) {
    const t = await page.evaluate(() => document.body.innerText.match(/Something went wrong[^\n]*/)?.[0] || null);
    result.data.adjError = t;
    await clickByText(page, "Save Leveling Adjustments", { exact: true });
    await delay(2500);
    decept = (await bids()).find((b) => b._id === bidDecept.bidId);
    result.data.adjSavedRetry = (decept?.identifiedExclusions || []).some((e) => e.isWaived);
    result.data.adjLeveledAfter = decept?.leveledTotalCost;
    if (!result.data.adjSavedRetry) problems.push({ id: "A9-48", sev: "High", title: "Save Leveling Adjustments failed twice; waive not persisted", detail: JSON.stringify(result.data) });
    else problems.push({ id: "A9-49", sev: "Medium", title: "Save Leveling Adjustments failed on first attempt (retry succeeded)", detail: `error=${t}` });
  }
  step(`adjustment saved: first=${result.data.adjSavedFirstTry} retry=${result.data.adjSavedRetry ?? "n/a"} leveled=${decept?.leveledTotalCost}`);
  await shot(page, "fix4-qa9-j3b-adjusted.png");

  // award
  const award = await clickInCard("QA9 Lifecycle Clean", "Award");
  await delay(6000);
  let clean = (await bids()).find((b) => b._id === bidClean.bidId);
  let agreements = await agrs();
  result.data.award = { click: award, awarded: clean?.isAwarded, agreements: agreements.map((a) => `${a.agreementNumber}:${a.status}`) };
  step(`award ${JSON.stringify(result.data.award)}`);
  if (!clean?.isAwarded) problems.push({ id: "A9-50", sev: "High", title: "Award did not mark bid awarded", detail: JSON.stringify(award) });
  if (!agreements.length) problems.push({ id: "A9-51", sev: "High", title: "Award did not create agreement" });

  // inspect
  const inspect = await clickInCard("QA9 Lifecycle Clean", "Inspect Agreement");
  await delay(1800);
  result.data.agreementModal = await page.evaluate(() => {
    const t = document.body.innerText;
    return { inspectOk: true, hasA401: t.includes("A401-style Subcontract Draft"), hasExecNote: t.includes("Execution status recorded") || t.includes("external signature"), snippet: (t.match(/CONTRACT SUM[^\n]*/i) || t.match(/Contract Sum[^\n]*/) || [])[0] || null };
  });
  await shot(page, "fix4-qa9-j3b-agreement.png");
  await clickByText(page, "Close Viewer", { exact: true });
  await delay(700);
  step(`agreement modal ${JSON.stringify(result.data.agreementModal)}`);

  // unaward
  const unaward = await clickInCard("QA9 Lifecycle Clean", "Unaward");
  await delay(700);
  if (unaward.ok) { await clickByText(page, "Unaward proposal", { exact: true }); await delay(3000); }
  clean = (await bids()).find((b) => b._id === bidClean.bidId);
  agreements = await agrs();
  result.data.unaward = { click: unaward, awarded: clean?.isAwarded, status: agreements[0]?.status };
  step(`unaward ${JSON.stringify(result.data.unaward)}`);
  if (clean?.isAwarded) problems.push({ id: "A9-52", sev: "High", title: "Unaward did not clear awarded flag" });

  // re-award
  await clickInCard("QA9 Lifecycle Clean", "Award");
  await delay(5000);
  clean = (await bids()).find((b) => b._id === bidClean.bidId);
  agreements = await agrs();
  result.data.reAward = { awarded: clean?.isAwarded, agreements: agreements.map((a) => `${a.agreementNumber}:${a.status}`) };
  step(`re-award ${JSON.stringify(result.data.reAward)}`);

  // execute via contracts tab
  await page.keyboard.press("Digit6");
  await delay(2000);
  const execClick = await clickByText(page, "Record Execution Status", { exact: false });
  await delay(700);
  const confirmExec = await clickByText(page, "Record execution", { exact: true });
  await delay(3500);
  agreements = await agrs();
  let executed = agreements.find((a) => a.status === "executed");
  result.data.execute = { click: execClick, confirm: confirmExec, executed: Boolean(executed) };
  if (!executed) {
    await clickInCard("QA9 Buyout Lifecycle", "Record External Execution");
    await delay(700);
    await clickByText(page, "Record execution", { exact: true });
    await delay(3000);
    agreements = await agrs();
    executed = agreements.find((a) => a.status === "executed");
    result.data.execute.executed2 = Boolean(executed);
  }
  step(`execute ${JSON.stringify(result.data.execute)}`);
  if (!executed) problems.push({ id: "A9-53", sev: "High", title: "Record execution failed", detail: JSON.stringify(result.data.execute) });
  await shot(page, "fix4-qa9-j3b-executed.png");

  // guarded mutations
  const g = [];
  g.push(await guard("deleteBid(executed)", () => c.mutation("bids:deleteBid", { bidId: bidClean.bidId })));
  g.push(await guard("unaward(executed)", () => c.mutation("bids:unawardContract", { bidId: bidClean.bidId, tradePackageId: pkgId })));
  if (executed) g.push(await guard("executeAgain", () => c.mutation("agreements:executeAgreement", { agreementId: executed._id })));
  g.push(await guard("deletePackage(executed)", () => c.mutation("tradePackages:deleteTradePackage", { tradePackageId: pkgId })));
  g.push(await guard("deleteContractor(with bids)", () => c.mutation("contractors:deleteContractor", { contractorId: ctrDecept })));
  result.data.guards = g;
  step(`guards ${g.map((x) => `${x.label}=${x.rejected ? "rejected" : "ALLOWED"}`).join(", ")}`);
  for (const item of g) {
    if (!item.rejected && /executed|proposal/i.test(item.label)) problems.push({ id: "A9-54", sev: "High", title: `Guard missing: ${item.label}`, detail: item.value });
  }

  // delete allowed: low bid then low contractor
  await page.keyboard.press("Digit4");
  await delay(1800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("QA9 Buyout Lifecycle"));
    if (b) b.click();
  });
  await delay(1200);
  const delBid = await clickInCard("QA9 Lifecycle Low", "Delete");
  await delay(700);
  const delConfirm = await clickByText(page, "Delete proposal", { exact: true });
  await delay(3000);
  const lowGone = !(await bids()).some((b) => b._id === bidLow.bidId);
  result.data.deleteBid = { open: delBid, confirm: delConfirm, gone: lowGone };
  step(`delete low bid gone=${lowGone}`);
  if (!lowGone) problems.push({ id: "A9-55", sev: "Medium", title: "Delete unawarded bid did not remove record" });

  await page.keyboard.press("Digit2");
  await delay(1800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("QA9 Buyout Lifecycle"));
    if (b) b.click();
  });
  await delay(1000);
  const delCtr = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button[title="Delete contractor"]')];
    const b = btns[0];
    if (!b) return false;
    b.scrollIntoView({ block: "center" }); b.click(); return true;
  });
  if (delCtr) {
    await delay(600);
    await clickByText(page, "Remove contractor", { exact: true });
    await delay(3000);
    result.data.deleteCtrToast = await toastNow(4000);
  }
  const remaining = (await c.query("contractors:listByProject", { projectId: proj._id })).filter((x) => x.tradePackageId === pkgId).map((x) => x.companyName);
  result.data.remainingContractors = remaining;
  step(`remaining ctrs=${JSON.stringify(remaining)} delToast=${JSON.stringify(result.data.deleteCtrToast ?? null)}`);
  await shot(page, "fix4-qa9-j3b-final.png");
  result.console = diagnosticsSummary(diag);
} catch (err) {
  problems.push({ id: "A9-90", sev: "High", title: "J3b crashed: " + (err?.message ?? String(err)).split("\n")[0] });
  await shot(page, "fix4-qa9-j3b-crash.png").catch(() => {});
} finally {
  result.findings = problems;
  result.verdict = problems.some((p) => p.sev === "High") ? "blocked" : problems.length ? "complete-with-issues" : "complete";
  writeEvidence("j3b-bids", result);
  await browser.close();
}
console.log(`J3b verdict=${result.verdict} findings=${problems.length}`);