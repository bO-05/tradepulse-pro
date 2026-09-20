/**
 * AUDIT7-CONV-B (audit-6 remediation convergence round 1): INDEPENDENT ORACLE
 * verification of the ADR-0003 leveling engine + determinism + CSV export match.
 *
 * Oracle (computed here from the documented rule, no repo imports):
 *   baseline = 16 for CSI Div 22/23, 12 for Div 26 (and other divisions)
 *   leadPenalty = max(0, N - baseline) * 6000
 *   exclusions = amount stated in the proposal when stated; ASPE/RSMeans benchmark
 *                schedule when the exclusion is unpriced
 *   COI deficiency = 15000
 *   accepted VE deduct = 0 (ingested alternates start unaccepted)
 *   leveled = base + unwaived exclusions + leadPenalty + COI - acceptedVeDeduct
 */
import {
  delay, openApp, q, clickTab, selectProject, selectRibbonPackage, selectPackageCard, makeFixtureProject, makePackage,
  addContractor, clickText, poll, writeEvidence, deleteProject, DAILY, PREFIX, bodyText,
} from "./lib.mjs";

const TITLE = `${PREFIX}CONV-B-${DAILY}`;
const WEEKS = [12, 16, 17, 20];

const DIV_SPECS = [
  {
    div: "22", csi: "22 00 00", name: "AUDIT7-CONV-B Plumbing", budget: 800000, base: 620000, baseline: 16,
    exclusions: [
      { short: "core drilling", line: "Core drilling and floor/wall penetration sleeves are excluded (by others) with a GC allowance of $12,400.", explicit: 12400, benchmark: 16000 },
      { short: "backflow", line: "Municipal backflow preventer inspection and certification excluded (by others).", explicit: null, benchmark: 8500 },
      { short: "booster pump startup", line: "Triplex booster pump factory certified technician startup excluded (not included).", explicit: null, benchmark: 12000 },
    ],
    ve: [{ line: "Triplex booster pump VFD controller substitution alternate credit: $28,500 deduct (offered for GC consideration).", deduct: 28500 }],
  },
  {
    div: "26", csi: "26 00 00", name: "AUDIT7-CONV-B Electrical", budget: 1050000, base: 780000, baseline: 12,
    exclusions: [
      { short: "crane", line: "Penthouse crane hoisting and rigging services are excluded (GC to furnish crane) with a GC allowance of $18,600.", explicit: 18600, benchmark: 45000 },
      { short: "firestop", line: "UL 1479 floor and wall penetration firestopping excluded (by others).", explicit: null, benchmark: 22000 },
      { short: "seismic", line: "Seismic structural bracing per IBC Section 1613 excluded (by others).", explicit: null, benchmark: 55000 },
    ],
    ve: [{ line: "LED luminaire substitution and aluminum MC feeder cable alternate credit: $35,000 deduct (offered for GC consideration).", deduct: 35000 }],
  },
  {
    div: "23", csi: "23 00 00", name: "AUDIT7-CONV-B HVAC", budget: 1150000, base: 840000, baseline: 16,
    exclusions: [
      { short: "TAB", line: "NEBB certified TAB air balancing report is excluded (by others) with a GC allowance of $21,750.", explicit: 21750, benchmark: 28000 },
      { short: "BACnet", line: "BACnet MS/TP automation integration gateway card excluded (by others).", explicit: null, benchmark: 18000 },
      { short: "vibration", line: "Spring vibration isolation hangers excluded (by others).", explicit: null, benchmark: 14000 },
    ],
    ve: [{ line: "Rooftop AHU factory-mounted economizer alternate credit: $42,000 deduct (offered for GC consideration).", deduct: 42000 }],
  },
];

function quoteFor(spec, company, weeks) {
  return [
    "PROPOSAL AND QUOTATION",
    `Subcontractor: ${company}`,
    `Project: ${TITLE}`,
    `Base Bid Price: $${spec.base.toLocaleString("en-US")}.00`,
    `Scope: complete Division ${spec.div} commercial scope per plans and specifications.`,
    `Equipment procurement lead time: ${weeks} weeks from notice to proceed.`,
    "EXCLUSIONS:",
    ...spec.exclusions.map((e) => `- ${e.line}`),
    "Insurance: standard statutory worker's comp limits only; umbrella liability endorsement excluded.",
    "Value Engineering Alternates:",
    ...spec.ve.map((v) => `- ${v.line}`),
  ].join("\n");
}

/** Independent oracle for one case. */
function oracle(spec, weeks) {
  const exclusions = spec.exclusions.map((e) => ({
    short: e.short,
    amount: e.explicit !== null ? e.explicit : e.benchmark,
    basis: e.explicit !== null ? "stated" : "benchmark",
  }));
  const exclusionsTotal = exclusions.reduce((s, e) => s + e.amount, 0);
  const leadPenalty = Math.max(0, weeks - spec.baseline) * 6000;
  const coi = 15000;
  const veAccepted = 0;
  const leveled = spec.base + exclusionsTotal + leadPenalty + coi - veAccepted;
  return { exclusions, exclusionsTotal, leadPenalty, coi, veAccepted, leveled };
}

/** Force the active package to spec.pkg and land on the leveling tab for it. */
async function ensurePackage(page, spec) {
  for (let i = 0; i < 3; i++) {
    await clickTab(page, "01:");
    await delay(500);
    await selectPackageCard(page, spec.pkg.tradeName);
    await delay(800);
    await clickTab(page, "04:");
    await delay(1000);
    let head = await page.evaluate(() => (document.querySelector("main") || document.body).innerText.slice(0, 400));
    if (head.includes(`CSI ${spec.csi}`)) return true;
    await clickTab(page, "01:");
    await delay(400);
    await selectRibbonPackage(page, spec.pkg.tradeName);
    await delay(900);
    await clickTab(page, "04:");
    await delay(1000);
    head = await page.evaluate(() => (document.querySelector("main") || document.body).innerText.slice(0, 400));
    if (head.includes(`CSI ${spec.csi}`)) return true;
  }
  return false;
}

/** Open the real ingest modal on the Bid Leveling tab and submit via the real UI. */
async function ingestChecked(page, spec, ctrId, quoteText) {
  const res = { sub: [], submitted: false };
  for (let attempt = 0; attempt < 2 && !res.submitted; attempt++) {
    const step = { attempt };
    step.packageOk = await ensurePackage(page, spec);
    step.header = await page.evaluate(() => (document.querySelector("main") || document.body).innerText.slice(0, 140));
    const open = await clickText(page, "Ingest Quote / PDF");
    step.open = { ok: open.ok, text: open.text };
    if (!open.ok) { res.sub.push(step); continue; }
    await delay(900);
    step.select = await page.evaluate((cid) => {
      const sel = document.getElementById("ingest-contractor-select");
      if (!sel) return { ok: false };
      const hasOption = [...sel.options].some((o) => o.value === cid);
      if (!hasOption) return { ok: false, hasOption: false, options: [...sel.options].map((o) => o.value) };
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(sel, cid);
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: sel.value, hasOption: true };
    }, ctrId);
    if (!step.select.ok) { res.sub.push(step); await page.keyboard.press("Escape"); await delay(500); continue; }
    step.ta = await page.evaluate((text) => {
      const ta = document.querySelector('textarea[aria-label="Proposal OCR text or pasted quote"]');
      if (!ta) return { ok: false };
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, text);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, len: ta.value.length };
    }, quoteText);
    await delay(500);
    step.submitState = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].filter((x) => x.getBoundingClientRect().width > 1).pop();
      const b = dlg ? [...dlg.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Extract & Level Bid")) : null;
      return b ? { found: true, disabled: b.disabled } : { found: false };
    });
    if (!step.submitState.found || step.submitState.disabled) { res.sub.push(step); await page.keyboard.press("Escape"); await delay(500); continue; }
    step.click = await clickText(page, "Extract & Level Bid");
    res.submitted = step.click.ok;
    res.sub.push(step);
    return res;
  }
  res.sub.push({ note: "not submitted after retries" });
  return res;
}

const out = {
  mission: "audit7-conv-b",
  startedAt: new Date().toISOString(),
  title: TITLE,
  oracleRule: "leveled = base + unwaivedExclusions + max(0,N-baseline)*6000 + 15000(COI) - 0(accepted VE); baseline 16 for Div 22/23, 12 for Div 26",
  cases: [],
  determinism: [],
  csv: null,
  ui: { cardSnippets: {} },
  errors: [],
};

// ---------- pre-clean stale CONV-B fixtures ----------
for (const p of ((await q("projects:listProjects", {})) || []).filter((x) => x.title.startsWith(`${PREFIX}CONV-B-`))) {
  console.log("[pre-clean] deleting", p.title);
  await deleteProject(p._id);
}

const { browser, page } = await openApp(1440, 900);
try {
  const proj = await makeFixtureProject(page, {
    title: TITLE,
    gc: "AUDIT7 Conv-B General Contractors LLC",
    budget: 3200000,
    weeks: 52,
    spec: "Division 22, 26 and 23 MEP scope for the AUDIT7 CONV-B independent-oracle probe.",
  });
  if (!proj.proj) throw new Error("fixture project not created");
  const projectId = proj.proj._id;
  out.project = { _id: projectId, title: TITLE };
  await selectProject(page, projectId);
  await delay(1500);

  // ---------- packages ----------
  for (const spec of DIV_SPECS) {
    await clickTab(page, "01:");
    await delay(600);
    await makePackage(page, spec.csi, spec.name, spec.budget, `Division ${spec.div} complete commercial scope.`);
    const pkgs = await poll(
      () => q("tradePackages:listByProject", { projectId }),
      (xs) => (xs || []).some((p) => String(p.csiDivision).startsWith(spec.div)),
      45000, 1500
    );
    spec.pkg = (pkgs || []).find((p) => String(p.csiDivision).startsWith(spec.div));
    if (!spec.pkg) throw new Error(`package Div ${spec.div} not created`);
    console.log(`[pkg] Div ${spec.div} ${spec.pkg.tradeName} ${spec.pkg._id}`);
  }

  // ---------- contractors (4 per division: one per N) ----------
  for (const spec of DIV_SPECS) {
    for (const n of WEEKS) {
      const company = `AUDIT7-CONV-B D${spec.div} N${n} Bidder LLC`;
      await clickTab(page, "Discovery");
      await delay(900);
      await selectRibbonPackage(page, spec.pkg.tradeName);
      await delay(500);
      await addContractor(page, spec.pkg.tradeName, company, `estimating@conv-b-d${spec.div}-n${n}.invalid`, `OR-CONVB-D${spec.div}N${n}`);
      const ctrs = await q("contractors:listByPackage", { tradePackageId: spec.pkg._id });
      spec.ctr = spec.ctr || {};
      spec.ctr[n] = (ctrs || []).find((c) => c.companyName === company);
      console.log(`[ctr] Div ${spec.div} N=${n} ${spec.ctr[n]?._id ?? "MISSING"}`);
    }
  }

  // ---------- per-case ingest + oracle compare ----------
  for (const spec of DIV_SPECS) {
    for (const n of WEEKS) {
      const company = `AUDIT7-CONV-B D${spec.div} N${n} Bidder LLC`;
      const ctr = spec.ctr[n];
      const text = quoteFor(spec, company, n);
      const expected = oracle(spec, n);
      const rec = { div: spec.div, weeks: n, company, text, expected, errors: [] };
      try {
        const before = ((await q("bids:listByPackage", { tradePackageId: spec.pkg._id })) || []).find((b) => b.contractorId === ctr._id) || null;
        const ing = await ingestChecked(page, spec, ctr._id, text);
        rec.ingest = ing;
        if (!ing.submitted) rec.errors.push("ingest not submitted (submit disabled or modal missing)");
        const bid = await poll(
          () => q("bids:listByPackage", { tradePackageId: spec.pkg._id }).then((bs) => (bs || []).find((b) => b.contractorId === ctr._id)),
          (b) => Boolean(b) && (!before || (b.revisionNumber || 1) > (before.revisionNumber || 1)),
          150000, 2500
        );
        rec.modalError = await page.evaluate(() => {
          const a = document.querySelector('[role="alert"]');
          return a ? a.innerText.slice(0, 300) : null;
        });
        rec.persisted = bid
          ? {
              _id: bid._id,
              revisionNumber: bid.revisionNumber,
              baseBidAmount: bid.baseBidAmount,
              longLeadEquipmentWeeks: bid.longLeadEquipmentWeeks,
              leadTimeTargetWeeks: bid.leadTimeTargetWeeks ?? null,
              leadTimePenalty: bid.leadTimePenalty,
              coiComplianceStatus: bid.coiComplianceStatus,
              coiPenalty: bid.coiPenalty,
              exclusions: (bid.identifiedExclusions || []).map((e) => ({ description: e.description, costImpact: e.costImpact, isWaived: !!e.isWaived, canonicalCode: e.canonicalCode ?? null })),
              veAlternates: (bid.valueEngineeringAlternates || []).map((v) => ({ description: v.description, costDeduct: v.costDeduct, isAccepted: v.isAccepted })),
              leveledTotalCost: bid.leveledTotalCost,
            }
          : null;
        if (!bid) rec.errors.push("bid not persisted within timeout");
        else {
          const persistedExclusionsTotal = rec.persisted.exclusions.reduce((s, e) => s + (e.isWaived ? 0 : e.costImpact), 0);
          const acceptedVe = rec.persisted.veAlternates.reduce((s, v) => s + (v.isAccepted ? v.costDeduct : 0), 0);
          rec.persistedDerived = { exclusionsTotal: persistedExclusionsTotal, acceptedVe, coi: rec.persisted.coiPenalty };
          rec.deltas = {
            exclusions: persistedExclusionsTotal - expected.exclusionsTotal,
            leadPenalty: rec.persisted.leadTimePenalty - expected.leadPenalty,
            coi: rec.persisted.coiPenalty - expected.coi,
            acceptedVe: acceptedVe - expected.veAccepted,
            leveled: rec.persisted.leveledTotalCost - expected.leveled,
          };
          rec.exclusionsMatch = JSON.stringify(rec.persisted.exclusions.map((e) => e.costImpact)) === JSON.stringify(expected.exclusions.map((e) => e.amount));
          rec.targetOk = rec.persisted.leadTimeTargetWeeks === spec.baseline;
          rec.veUnaccepted = rec.persisted.veAlternates.every((v) => v.isAccepted === false);
          rec.ok = Object.values(rec.deltas).every((d) => d === 0);
        }
        console.log(`[case] Div ${spec.div} N=${n} submitted=${ing.submitted} ok=${rec.ok} expected=$${expected.leveled} persisted=$${rec.persisted?.leveledTotalCost} deltas=${JSON.stringify(rec.deltas)} errors=${rec.errors.length}`);
      } catch (e) {
        rec.errors.push(String(e?.stack ?? e));
        console.error("[case error]", rec.div, rec.weeks, e?.message ?? e);
      }
      out.cases.push(rec);
    }
    // UI lead arithmetic evidence for this package
    try {
      await ensurePackage(page, spec);
      await delay(800);
      const uiLines = await page.evaluate(() => {
        const t = (document.querySelector("main") || document.body).innerText;
        return t.split(/\r?\n/).map((s) => s.trim()).filter((s) => /\$\s*6,000|baseline|Lead Time|lead time|COI|ACORD/i.test(s) && s.length < 220);
      });
      out.ui.cardSnippets[spec.div] = [...new Set(uiLines)].slice(0, 60);
    } catch (e) {
      out.errors.push(`ui capture div ${spec.div}: ${e?.message ?? e}`);
    }
  }

  // ---------- determinism: same text twice, Div 22 and Div 26 ----------
  for (const spec of DIV_SPECS.filter((s) => s.div === "22" || s.div === "26")) {
    const company = `AUDIT7-CONV-B D${spec.div} Determinism Bidder`;
    try {
      await clickTab(page, "Discovery");
      await delay(900);
      await selectRibbonPackage(page, spec.pkg.tradeName);
      await delay(500);
      await addContractor(page, spec.pkg.tradeName, company, `estimating@conv-b-det-d${spec.div}.invalid`, `OR-CONVB-DET-D${spec.div}`);
      const ctrs = await q("contractors:listByPackage", { tradePackageId: spec.pkg._id });
      const ctr = (ctrs || []).find((c) => c.companyName === company);
      const text = quoteFor(spec, company, 17);
      const snap = async () => {
        const b = ((await q("bids:listByPackage", { tradePackageId: spec.pkg._id })) || []).find((x) => x.contractorId === ctr._id);
        if (!b) return null;
        return {
          revisionNumber: b.revisionNumber ?? 1,
          longLeadEquipmentWeeks: b.longLeadEquipmentWeeks,
          leadTimeTargetWeeks: b.leadTimeTargetWeeks ?? null,
          leadTimePenalty: b.leadTimePenalty,
          baseBidAmount: b.baseBidAmount,
          coiPenalty: b.coiPenalty,
          leveledTotalCost: b.leveledTotalCost,
          exclusions: (b.identifiedExclusions || []).map((e) => [e.description, e.costImpact]).sort((a, z) => String(a[0]).localeCompare(String(z[0]))),
          ve: (b.valueEngineeringAlternates || []).map((v) => [v.description, v.costDeduct, v.isAccepted]),
        };
      };
      const rec = { div: spec.div, text, runs: [] };
      for (let i = 0; i < 2; i++) {
        const before = await snap();
        const ing = await ingestChecked(page, spec, ctr._id, text);
        const after = await poll(
          async () => {
            const s = await snap();
            return s && (!before || s.revisionNumber > before.revisionNumber) ? s : null;
          },
          Boolean,
          150000, 2500
        );
        rec.runs.push({ submitted: ing.submitted, before, after });
        console.log(`[determinism] Div ${spec.div} run ${i + 1} submitted=${ing.submitted} rev=${after?.revisionNumber} weeks=${after?.longLeadEquipmentWeeks} target=${after?.leadTimeTargetWeeks} penalty=${after?.leadTimePenalty} leveled=${after?.leveledTotalCost}`);
      }
      const cmpFields = ["longLeadEquipmentWeeks", "leadTimeTargetWeeks", "leadTimePenalty", "leveledTotalCost", "baseBidAmount", "coiPenalty"];
      rec.compare = {};
      for (const f of cmpFields) rec.compare[f] = { first: rec.runs[0]?.after?.[f] ?? null, second: rec.runs[1]?.after?.[f] ?? null, equal: JSON.stringify(rec.runs[0]?.after?.[f] ?? null) === JSON.stringify(rec.runs[1]?.after?.[f] ?? null) };
      rec.exclusionsEqual = JSON.stringify(rec.runs[0]?.after?.exclusions) === JSON.stringify(rec.runs[1]?.after?.exclusions);
      rec.veEqual = JSON.stringify(rec.runs[0]?.after?.ve) === JSON.stringify(rec.runs[1]?.after?.ve);
      rec.ok = Object.values(rec.compare).every((c) => c.equal) && rec.exclusionsEqual && rec.veEqual;
      out.determinism.push(rec);
    } catch (e) {
      out.determinism.push({ div: spec.div, error: String(e?.stack ?? e) });
      out.errors.push(`determinism div ${spec.div}: ${e?.message ?? e}`);
    }
  }

  // ---------- CSV export vs backend, Div 26 ----------
  try {
    const spec = DIV_SPECS.find((s) => s.div === "26");
    await ensurePackage(page, spec);
    await delay(1200);
    const csvSetup = await page.evaluate(() => {
      window.__auditCsv = null;
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        window.__auditCsv = blob;
        return orig(blob);
      };
      return true;
    });
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Export full ADR-0003") || (x.textContent || "").includes("Export Leveling CSV"));
      b?.click();
      return Boolean(b);
    });
    await delay(1200);
    const csvText = await page.evaluate(async () => (window.__auditCsv ? await window.__auditCsv.text() : null));
    const bids = (await q("bids:listByPackage", { tradePackageId: spec.pkg._id })) || [];
    const sorted = [...bids].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost);
    const target = sorted[0];
    let rows = [];
    if (csvText) {
      rows = csvText.replace(/^\uFEFF/, "").trim().split(/\r?\n/).map((line) => {
        const cells = [];
        let cur = "";
        let q = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (q) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') q = false;
            else cur += ch;
          } else if (ch === '"') q = true;
          else if (ch === ",") { cells.push(cur); cur = ""; }
          else cur += ch;
        }
        cells.push(cur);
        return cells;
      });
    }
    const header = rows[0] || [];
    const dataRows = rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
    const csvRow = dataRows.find((r) => r["Subcontractor Name"] === target?.subcontractorName) || null;
    const expectedRow = target
      ? {
          "Rank": `#${sorted.findIndex((b) => b._id === target._id) + 1}`,
          "Subcontractor Name": target.subcontractorName,
          "CSI Division": spec.pkg.csiDivision,
          "Trade Package": spec.pkg.tradeName,
          "Submitted Base Bid ($)": String(target.baseBidAmount),
          "Scope Gaps / Exclusions Count": String((target.identifiedExclusions || []).length),
          "Total Scope Gap Cost ($)": String((target.identifiedExclusions || []).reduce((s, e) => s + (e.isWaived ? 0 : e.costImpact || 0), 0)),
          "Value Engineering Alternates Count": String((target.valueEngineeringAlternates || []).length),
          "Accepted VE Deduct ($)": String((target.valueEngineeringAlternates || []).reduce((s, v) => s + (v.isAccepted ? v.costDeduct : 0), 0)),
          "Lead Time (Weeks)": String(target.longLeadEquipmentWeeks),
          "Lead Time Penalty ($)": String(target.leadTimePenalty),
          "ACORD 25 COI Status": target.coiComplianceStatus,
          "COI Penalty ($)": String(target.coiPenalty),
          "True Leveled Total Cost ($)": String(target.leveledTotalCost),
        }
      : null;
    const fieldChecks = expectedRow
      ? Object.entries(expectedRow).map(([k, v]) => ({ field: k, csv: csvRow?.[k] ?? null, backend: v, equal: String(csvRow?.[k] ?? null) === String(v) }))
      : [];
    const crypto = await import("node:crypto");
    out.csv = {
      setup: csvSetup, clicked, csvLength: csvText?.length ?? 0, csvText: csvText ? csvText.slice(0, 4000) : null,
      header, rowCount: dataRows.length, backendBidCount: bids.length, targetBidId: target?._id, targetSub: target?.subcontractorName,
      csvRow, expectedRow, fieldChecks,
      allFieldsEqual: fieldChecks.length > 0 && fieldChecks.every((f) => f.equal),
      fullCsvHash: csvText ? crypto.createHash("sha256").update(csvText).digest("hex") : null,
    };
    console.log(`[csv] clicked=${clicked} rows=${dataRows.length} allFieldsEqual=${out.csv.allFieldsEqual}`);
  } catch (e) {
    out.errors.push(`csv: ${e?.stack ?? e}`);
    console.error("[csv error]", e);
  }

  out.finishedAt = new Date().toISOString();
} catch (err) {
  out.error = String(err?.stack ?? err);
  out.finishedAt = new Date().toISOString();
  console.error(err);
} finally {
  await browser.close();
}

out.summary = {
  cases: out.cases.map((c) => ({
    div: c.div, weeks: c.weeks, expected: c.expected?.leveled, persisted: c.persisted?.leveledTotalCost ?? null,
    deltas: c.deltas ?? null, ok: !!c.ok,
  })),
  casesPass: out.cases.filter((c) => c.ok).length,
  casesTotal: out.cases.length,
  determinism: out.determinism.map((d) => ({ div: d.div, ok: !!d.ok, compare: d.compare ?? null, exclusionsEqual: d.exclusionsEqual ?? null, veEqual: d.veEqual ?? null, error: d.error ?? null })),
  csvAllFieldsEqual: out.csv?.allFieldsEqual ?? null,
  errors: out.errors,
};
const evidencePath = writeEvidence("fix6-conv-b-matrix.json", out);
console.log(JSON.stringify(out.summary, null, 2));
console.log("evidence:", evidencePath);