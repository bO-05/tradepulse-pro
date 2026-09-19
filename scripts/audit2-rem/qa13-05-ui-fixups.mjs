import {
  clickHeaderTab,
  delay,
  launchBrowser,
  selectProjectByTitle,
  shot,
  waitForAppReady,
} from "./qa6-lib.mjs";
import { BASE_URL } from "./lib.mjs";
import {
  client,
  readEvidence,
  writeEvidence,
  writeLog,
  deleteProjectHard,
} from "./qa13-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const B = readEvidence("backend");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${detail}`);
};

async function probeAlertDialog(page) {
  return page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const ds = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis);
    const top = ds[ds.length - 1] || null;
    const alert = top ? top.querySelector('[role="alert"]') : null;
    return {
      dialogOpen: Boolean(top),
      title: top ? ((top.querySelector("h2") || {}).innerText || "").trim() : null,
      inlineAlert: alert ? alert.innerText.trim() : null,
      alertVisible: alert ? vis(alert) : null,
      buttons: top ? [...top.querySelectorAll("button")].map((b) => (b.innerText || "").trim().replace(/\s+/g, " ")) : [],
    };
  });
}

async function clickDialogButton(page, label) {
  return page.evaluate((needle) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const ds = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis);
    const top = ds[ds.length - 1];
    if (!top) return { ok: false, reason: "no dialog" };
    const b = [...top.querySelectorAll("button")].find((x) => (x.innerText || "").trim().replace(/\s+/g, " ") === needle);
    if (!b) return { ok: false, reason: "button not found" };
    b.click();
    return { ok: true };
  }, label);
}

async function clickVisibleButton(page, pattern) {
  return page.evaluate((pattern) => {
    const rx = new RegExp(pattern);
    const b = [...document.querySelectorAll("main button")].find((x) => {
      const r = x.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false;
      return rx.test((x.innerText || "").trim().replace(/\s+/g, " "));
    });
    if (!b) return { ok: false, sample: [...document.querySelectorAll("main button")].map((x) => x.innerText.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 50) };
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.innerText || "").trim().replace(/\s+/g, " ") };
  }, pattern);
}

async function main() {
  // ---------- fresh executed fixture EXEC2 ----------
  const title = "AUDIT-QA13-EXEC2";
  const projId = await c.mutation("projects:createProject", {
    title,
    location: "Austin, TX",
    projectType: "Class-A Commercial Mixed-Use QA13",
    estBudget: 1_500_000,
    targetCompletionWeeks: 40,
    specDocumentText: "QA13 EXEC2 fixture. Division 26 electrical.",
    isDemoProject: false,
    generalContractorName: "QA13 General Contractor LLC",
  });
  const pkgId = await c.mutation("tradePackages:createTradePackage", {
    projectId: projId,
    csiDivision: "26 00 00",
    tradeName: "QA13 Electrical Exec2",
    budgetEstimate: 900_000,
    scopeSummary: "QA13 EXEC2 electrical scope.",
    mandatoryInclusions: ["QA13 inclusion 26 00 00"],
    bidDeadline: "2026-12-31",
  });
  const ctrId = await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName: "AUDIT-QA13 Exec2 Electric",
    contactEmail: "qa13.exec2@qa13.invalid",
    phone: "+1 (512) 555-0199",
    licenseNumber: "TX-QA13-EXEC2",
    licenseStatus: "Active / Verified (TDLR-QA13)",
    sourceUrl: "https://qa13.example.invalid/exec2",
    rfqStatus: "invited",
  });
  const bidRes = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId,
    contractorId: ctrId,
    subcontractorName: "AUDIT-QA13 Exec2 Electric",
    baseBidAmount: 900_000,
    lineItems: [{ item: "QA13 EXEC2 base scope", unit: "LS", quantity: 1, unitCost: 900_000, totalCost: 900_000 }],
    identifiedExclusions: [],
    valueEngineeringAlternates: [],
    longLeadEquipmentWeeks: 12,
    leadTimePenalty: 0,
    coiComplianceStatus: "compliant",
    coiPenalty: 0,
  });
  const gen = await c.mutation("agreements:generateAgreement", { bidId: bidRes.bidId, tradePackageId: pkgId });
  await c.mutation("agreements:executeAgreement", { agreementId: gen._id });
  say(`EXEC2 fixture: project=${projId} pkg=${pkgId} bid=${bidRes.bidId} agreement=${gen._id}`);

  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);

  // ---------- A5-02 unaward inline + A11-01 reset ----------
  await selectProjectByTitle(page, title);
  await delay(2000);
  await clickHeaderTab(page, "04: Bid Leveling");
  await delay(2000);

  const unawardClick = await clickVisibleButton(page, "^Unaward$");
  await delay(800);
  const dialogBefore = await probeAlertDialog(page);
  await clickDialogButton(page, "Unaward proposal");
  await delay(2600);
  const afterRefusal = await probeAlertDialog(page);
  await shot(page, "fix4-qa13-A5-02-unaward-inline.png");
  record(
    "A5-02-unaward-inline-persists",
    unawardClick.ok &&
      dialogBefore.dialogOpen &&
      afterRefusal.dialogOpen &&
      typeof afterRefusal.inlineAlert === "string" &&
      /Executed agreements are immutable/i.test(afterRefusal.inlineAlert) &&
      afterRefusal.alertVisible === true,
    `click=${JSON.stringify(unawardClick.text || unawardClick)}; title=${JSON.stringify(afterRefusal.title)}; alert=${JSON.stringify(afterRefusal.inlineAlert)}; visible=${afterRefusal.alertVisible}; open=${afterRefusal.dialogOpen}`
  );

  // error must survive re-query/re-render: wait 2s more and probe again
  await delay(2000);
  const afterSettle = await probeAlertDialog(page);
  record(
    "A5-02-inline-stays-after-rerender",
    afterSettle.dialogOpen && afterSettle.inlineAlert === afterRefusal.inlineAlert,
    `stillOpen=${afterSettle.dialogOpen}; sameAlert=${afterSettle.inlineAlert === afterRefusal.inlineAlert}; alert=${JSON.stringify(afterSettle.inlineAlert)}`
  );

  const cancel1 = await clickDialogButton(page, "Cancel");
  await delay(500);
  const afterCancel = await probeAlertDialog(page);
  record("A11-01-cancel-closes", cancel1.ok && afterCancel.dialogOpen === false, `cancel=${cancel1.ok}; openAfter=${afterCancel.dialogOpen}`);

  const reopenClick = await clickVisibleButton(page, "^Unaward$");
  await delay(900);
  const reopened = await probeAlertDialog(page);
  await shot(page, "fix4-qa13-A11-01-reopen-reset.png");
  record(
    "A11-01-reopen-resets-error",
    reopenClick.ok && reopened.dialogOpen && reopened.inlineAlert === null,
    `reopened=${reopened.dialogOpen}; staleAlert=${JSON.stringify(reopened.inlineAlert)}; title=${JSON.stringify(reopened.title)}`
  );
  await clickDialogButton(page, "Cancel");
  await delay(400);

  // ---------- A12-02 UI register total (fixed probe) ----------
  await selectProjectByTitle(page, "AUDIT-QA13-MAIN");
  await delay(2200);
  await clickHeaderTab(page, "06: Subcontracts");
  await delay(2200);
  const totalProbe = await page.evaluate(() => {
    const els = [...document.querySelectorAll("div,span")].filter((e) => (e.innerText || "").trim().startsWith("Active Contracted Sum"));
    const card = els.length ? els[els.length - 1] : null;
    const text = card ? card.innerText.replace(/\s+/g, " ").trim() : null;
    const m = text ? text.match(/\$[\d,]+/) : null;
    const meta = [...document.querySelectorAll("div")].find((e) => /Execution Status Recorded/.test(e.innerText || "") && (e.innerText || "").length < 60);
    return { cardText: text, value: m ? m[0] : null, execMeta: meta ? meta.innerText.replace(/\s+/g, " ").trim() : null };
  });
  await shot(page, "fix4-qa13-A12-02-contracts-register.png");
  record(
    "A12-02-ui-register-total-agrees",
    totalProbe.value === `$${B.expected.contractsActiveTotal.toLocaleString("en-US")}`,
    `ActiveContractedSum=${JSON.stringify(totalProbe.value)} expected=$${B.expected.contractsActiveTotal.toLocaleString("en-US")}; card=${JSON.stringify(totalProbe.cardText)}; execMeta=${JSON.stringify(totalProbe.execMeta)}`
  );

  // ---------- A11-04 card resolution line (precise probe) ----------
  await clickHeaderTab(page, "05: Scope Clash");
  await delay(2200);
  const clashProbe = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("main div.rounded-xl")].filter((d) =>
      /Rooftop Mechanical Equipment Disconnect Switches/.test(d.innerText || "")
    );
    const card = cards[cards.length - 1];
    const text = card ? card.innerText.replace(/\s+/g, " ") : null;
    const resolutionMatch = text ? text.match(/Deducted \$[\d,]+[^.]*\./) : null;
    const kpiLabel = [...document.querySelectorAll("span")].find((s) => /Recoverable Buyout Credits/.test(s.innerText || ""));
    const kpiCard = kpiLabel ? kpiLabel.closest("div.rounded-xl") : null;
    const deductedBadge = card ? /Credit Deducted & Leveled/i.test(card.innerText || "") : false;
    return {
      found: Boolean(card),
      resolutionLine: resolutionMatch ? resolutionMatch[0].trim() : null,
      deductedBadge,
      kpiValue: kpiCard ? ((kpiCard.innerText.match(/\$[\d,]+/) || [null])[0] || null) : null,
    };
  });
  await shot(page, "fix4-qa13-A11-04-clash-resolution.png");
  const applied = `$${B.expected.disconnectApplied.toLocaleString("en-US")}`;
  record(
    "A11-04-per-card-applied-credit",
    clashProbe.found && (clashProbe.resolutionLine || "").includes(applied) && !(clashProbe.resolutionLine || "").includes("12,000"),
    `resolutionLine=${JSON.stringify(clashProbe.resolutionLine)}; applied=${applied}; kpi=${clashProbe.kpiValue}; badge=${clashProbe.deductedBadge}`
  );

  // ---------- cleanup EXEC2 ----------
  const del = await deleteProjectHard(c, projId);
  const gone = !(await c.query("projects:listProjects", {})).some((p) => p._id === projId);
  say(`EXEC2 cleanup: ${JSON.stringify(del)} gone=${gone}`);

  writeEvidence("ui-fixups", {
    results,
    exec2: { projectId: projId, packageId: pkgId, bidId: bidRes.bidId, agreementId: gen._id, cleanup: del, gone },
    dialogs: { dialogBefore, afterRefusal, afterSettle, reopened, afterCancel },
    totalProbe,
    clashProbe,
  });
  writeLog("ui-fixups", log);
  console.log(`\nfixups results: ${results.filter((r) => r.pass).length}/${results.length} passed`);
  await browser.close();
}

main().catch(async (e) => {
  console.error(e);
  writeLog("ui-fixups-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});