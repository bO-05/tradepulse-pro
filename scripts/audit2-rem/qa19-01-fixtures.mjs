/**
 * QA19 fixtures (AUDIT-QA19-* only):
 *  - AUDIT-QA19-LIVE:    2 packages (Div 26 electrical + Div 22 plumbing, no Div 23)
 *                        => clash-free project for A18-03 + deep-link/stale/print.
 *  - AUDIT-QA19-DEADLINE: local-today (America/New_York) no-bids + with-bids and
 *                        UTC-today no-bids packages for A17-01 cron verification.
 *  - AUDIT-QA19-SIM:     contract-free package for A17-02 runFullProcurementCycle.
 */
import { client, fixtureTitle, writeEvidence, writeLog, sleep, utcDate, zonedDate, addDays } from "./qa19-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const LIVE = fixtureTitle("LIVE");
const DEADLINE = fixtureTitle("DEADLINE");
const SIM = fixtureTitle("SIM");
const ALL = [LIVE, DEADLINE, SIM];

async function findProject(title) {
  const projects = (await c.query("projects:listProjects", {})) || [];
  return projects.find((p) => p.title === title) || null;
}

async function hardDelete(title) {
  const existing = await findProject(title);
  if (!existing) return;
  if (!String(existing.title).startsWith("AUDIT-QA19-")) throw new Error("refusing to delete " + existing.title);
  const agreements = (await c.query("agreements:listAgreements", { projectId: existing._id })) || [];
  for (const a of agreements) {
    if (a.status === "executed") {
      try {
        await c.mutation("agreements:voidExecutedAgreement", {
          agreementId: a._id,
          reason: "QA19 fixture reset: void execution before re-creating the fixture.",
        });
      } catch (e) {
        say(`void during reset failed: ${e?.data ?? e?.message}`);
      }
    }
  }
  try {
    await c.mutation("projects:deleteProject", { projectId: existing._id });
    say(`removed pre-existing ${title} (${existing._id})`);
    await sleep(600);
  } catch (e) {
    say(`WARN could not delete ${title}: ${e?.data ?? e?.message}`);
  }
}

async function createProject(title, type, location) {
  const id = await c.mutation("projects:createProject", {
    title,
    location,
    projectType: type,
    estBudget: 4_000_000,
    targetCompletionWeeks: 48,
    specDocumentText: `${title} fixture spec. Divisions 22-26 coverage.`,
    isDemoProject: false,
    generalContractorName: "AUDIT-QA19 General Contractor LLC",
  });
  say(`created project ${title} ${id}`);
  return id;
}

async function createPackage(projectId, csiDivision, tradeName, bidDeadline, opts = {}) {
  const id = await c.mutation("tradePackages:createTradePackage", {
    projectId,
    csiDivision,
    tradeName,
    budgetEstimate: opts.budgetEstimate ?? 1_000_000,
    scopeSummary: opts.scopeSummary ?? `${tradeName} fixture scope for QA19 verification.`,
    mandatoryInclusions: opts.mandatoryInclusions ?? ["QA19 inclusion A", "QA19 inclusion B"],
    bidDeadline,
  });
  say(`created package ${csiDivision} "${String(tradeName).slice(0, 40)}" ${id} deadline=${bidDeadline}`);
  return id;
}

async function setStatus(pkgId, status) {
  await c.mutation("tradePackages:updateStatus", { tradePackageId: pkgId, status });
}

async function createContractor(pkgId, companyName, email) {
  const id = await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName,
    contactEmail: email,
    phone: "+1 (212) 555-0199",
    licenseNumber: "NY-QA19-0001",
    licenseStatus: "Active / Verified (QA19)",
    sourceUrl: "https://qa19.example.invalid",
    rfqStatus: "invited",
  });
  say(`created contractor "${companyName}" ${id}`);
  return id;
}

async function createBid(pkgId, contractorId, name, amount, opts = {}) {
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId,
    contractorId,
    subcontractorName: name,
    baseBidAmount: amount,
    lineItems: opts.lineItems ?? [
      { item: "QA19 base scope", unit: "LS", quantity: 1, unitCost: amount, totalCost: amount },
    ],
    identifiedExclusions: opts.identifiedExclusions ?? [],
    valueEngineeringAlternates: opts.valueEngineeringAlternates ?? [],
    longLeadEquipmentWeeks: opts.longLeadEquipmentWeeks ?? 6,
    leadTimePenalty: opts.leadTimePenalty ?? 0,
    coiComplianceStatus: opts.coiComplianceStatus ?? "compliant",
    coiPenalty: opts.coiPenalty ?? 0,
  });
  say(`created bid ${res.bidId} on ${pkgId} $${amount}`);
  return res.bidId;
}

async function main() {
  const now = new Date();
  const utcToday = utcDate(now);
  const nyToday = zonedDate(now, "America/New_York");
  const nyYesterday = addDays(nyToday, -1);
  say(`clock now=${now.toISOString()} utcToday=${utcToday} nyToday=${nyToday} nyYesterday=${nyYesterday}`);

  for (const t of ALL) await hardDelete(t);

  // ---------------- LIVE: clash-free (no Div 23), 2 packages ----------------
  const liveId = await createProject(LIVE, "QA19 Live Fixture", "Austin, TX");
  const liveP1 = await createPackage(liveId, "26 00 00", "AUDIT-QA19-LIVE Alpha Electrical", "2026-12-01", {
    budgetEstimate: 1_000_000,
    scopeSummary: "QA19 electrical scope: switchgear, feeders, branch power. No mechanical trade on this project.",
  });
  const liveP2 = await createPackage(liveId, "22 00 00", "AUDIT-QA19-LIVE Beta Plumbing", "2026-12-01", {
    budgetEstimate: 600_000,
    scopeSummary: "QA19 plumbing scope: domestic water and sanitary drainage.",
  });
  await setStatus(liveP1, "rfqs_dispatched");
  await setStatus(liveP2, "rfqs_dispatched");
  const liveC1 = await createContractor(liveP1, "AUDIT-QA19-LIVE Alpha Sub A", "qa19.live.a@qa19.invalid");
  const liveC2 = await createContractor(liveP1, "AUDIT-QA19-LIVE Alpha Sub B", "qa19.live.b@qa19.invalid");
  const liveC3 = await createContractor(liveP2, "AUDIT-QA19-LIVE Beta Sub", "qa19.live.c@qa19.invalid");
  const liveB1 = await createBid(liveP1, liveC1, "AUDIT-QA19-LIVE Alpha Sub A", 820_000);
  const liveB2 = await createBid(liveP1, liveC2, "AUDIT-QA19-LIVE Alpha Sub B", 905_000);
  const liveB3 = await createBid(liveP2, liveC3, "AUDIT-QA19-LIVE Beta Sub", 540_000);
  await setStatus(liveP1, "rfqs_dispatched");
  await setStatus(liveP2, "rfqs_dispatched");

  // ---------------- DEADLINE: A17-01 ----------------
  const dId = await createProject(DEADLINE, "QA19 Deadline Monitor Fixture", "New York, NY");
  const dLocalTodayNoBids = await createPackage(dId, "26 00 00", "AUDIT-QA19-DEADLINE Local Today NoBids", nyToday, {
    budgetEstimate: 150_000,
  });
  const dLocalTodayWithBids = await createPackage(dId, "23 00 00", "AUDIT-QA19-DEADLINE Local Today WithBids", nyToday, {
    budgetEstimate: 150_000,
  });
  const dUtcTodayNoBids = await createPackage(dId, "22 00 00", "AUDIT-QA19-DEADLINE UTC Today NoBids", utcToday, {
    budgetEstimate: 150_000,
  });
  await setStatus(dLocalTodayNoBids, "rfqs_dispatched");
  await setStatus(dLocalTodayWithBids, "rfqs_dispatched");
  await setStatus(dUtcTodayNoBids, "rfqs_dispatched");
  const dCtr = await createContractor(dLocalTodayWithBids, "AUDIT-QA19-DEADLINE Local Bidder", "qa19.dl.local@qa19.invalid");
  const dBid = await createBid(dLocalTodayWithBids, dCtr, "AUDIT-QA19-DEADLINE Local Bidder", 120_000);
  // submitDirectBid forces "leveling"; restore the dispatch state the monitor inspects.
  await setStatus(dLocalTodayWithBids, "rfqs_dispatched");

  // The >12h-past live case would need a deadline <= utcToday-2, which the public
  // validator (correctly) rejects. Record the rejection + rely on the fake-clock test.
  let tooOldCreation = null;
  try {
    const id = await createPackage(dId, "21 00 00", "AUDIT-QA19-DEADLINE Too Old", nyYesterday, { budgetEstimate: 100_000 });
    tooOldCreation = { ok: true, id };
    say(`UNEXPECTED: two-day-old deadline ${nyYesterday} accepted (${id})`);
  } catch (err) {
    tooOldCreation = { ok: false, data: String(err?.data ?? err?.message ?? err).slice(0, 160) };
    say(`two-day-old deadline ${nyYesterday} rejected as expected: ${tooOldCreation.data}`);
  }

  // ---------------- SIM: contract-free package for A17-02 ----------------
  const simId = await createProject(SIM, "QA19 Simulation Fixture", "Dallas, TX");
  const simP1 = await createPackage(simId, "26 00 00", "AUDIT-QA19-SIM Electrical", "2026-12-01", {
    budgetEstimate: 1_250_000,
    scopeSummary: "QA19 simulation scope: 1600A switchboard, emergency lighting, branch power.",
  });

  const map = {
    generatedAt: new Date().toISOString(),
    clock: { nowIso: now.toISOString(), utcToday, nyToday, nyYesterday },
    live: {
      title: LIVE,
      id: liveId,
      p1: liveP1,
      p2: liveP2,
      c1: liveC1,
      c2: liveC2,
      c3: liveC3,
      b1: liveB1,
      b2: liveB2,
      b3: liveB3,
    },
    deadline: {
      title: DEADLINE,
      id: dId,
      packages: {
        localTodayNoBids: dLocalTodayNoBids,
        localTodayWithBids: dLocalTodayWithBids,
        utcTodayNoBids: dUtcTodayNoBids,
      },
      bid: dBid,
      tooOldCreation,
      expected: {
        closingTimeLocalTodayIso: new Date(`${nyToday}T23:59:59.999Z`).getTime() + 12 * 3600 * 1000,
        closingTimeUtcTodayIso: new Date(`${utcToday}T23:59:59.999Z`).getTime() + 12 * 3600 * 1000,
      },
    },
    sim: { title: SIM, id: simId, p1: simP1 },
  };
  writeEvidence("fixtures", map);
  writeLog("fixtures", log);
  console.log("fixtures written");
}

main().catch((e) => {
  console.error(e);
  writeLog("fixtures-crash", [String(e && e.stack ? e.stack : e)]);
  process.exit(1);
});