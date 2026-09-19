import { client, fixtureTitle, writeEvidence, writeLog, sleep, utcDate, PREFIX } from "./qa18-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const VOL = fixtureTitle("VOL");
const UNI = fixtureTitle("UNI");
const FILE = fixtureTitle("FILE");
const LIVE = fixtureTitle("LIVE");

async function findProject(title) {
  const projects = (await c.query("projects:listProjects", {})) || [];
  return projects.find((p) => p.title === title) || null;
}

async function hardDelete(title) {
  const existing = await findProject(title);
  if (!existing) return;
  if (!String(existing.title).startsWith(PREFIX)) throw new Error("refusing to delete " + existing.title);
  try {
    await c.mutation("projects:deleteProject", { projectId: existing._id });
    say(`removed pre-existing ${title} (${existing._id})`);
    await sleep(500);
  } catch (e) {
    say(`WARN could not delete ${title}: ${e.message}`);
  }
}

async function createProject(title, type, location) {
  const id = await c.mutation("projects:createProject", {
    title,
    location,
    projectType: type,
    estBudget: 12_000_000,
    targetCompletionWeeks: 52,
    specDocumentText: `${title} fixture spec. Divisions 03-33.`,
    isDemoProject: false,
    generalContractorName: "AUDIT-QA18 General Contractor LLC",
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
    scopeSummary: opts.scopeSummary ?? `${tradeName} fixture scope.`,
    mandatoryInclusions: opts.mandatoryInclusions ?? ["QA18 inclusion A", "QA18 inclusion B"],
    bidDeadline,
  });
  return id;
}

async function setStatus(pkgId, status) {
  await c.mutation("tradePackages:updateStatus", { tradePackageId: pkgId, status });
}

async function createContractor(pkgId, companyName, email, rfqStatus = "invited") {
  const id = await c.mutation("contractors:createContractor", {
    tradePackageId: pkgId,
    companyName,
    contactEmail: email,
    phone: "+1 (212) 555-0144",
    licenseNumber: "NY-QA18-0001",
    licenseStatus: "Active / Verified (QA18)",
    sourceUrl: "https://qa18.example.invalid",
    rfqStatus,
  });
  return id;
}

async function createBid(pkgId, contractorId, name, amount, opts = {}) {
  const res = await c.mutation("bids:submitDirectBid", {
    tradePackageId: pkgId,
    contractorId,
    subcontractorName: name,
    baseBidAmount: amount,
    lineItems: opts.lineItems ?? [
      { item: "QA18 base scope", unit: "LS", quantity: 1, unitCost: amount, totalCost: amount },
    ],
    identifiedExclusions: opts.identifiedExclusions ?? [],
    valueEngineeringAlternates: opts.valueEngineeringAlternates ?? [],
    longLeadEquipmentWeeks: opts.longLeadEquipmentWeeks ?? 6,
    leadTimePenalty: opts.leadTimePenalty ?? 0,
    coiComplianceStatus: opts.coiComplianceStatus ?? "compliant",
    coiPenalty: opts.coiPenalty ?? 0,
  });
  return res.bidId;
}

async function main() {
  for (const t of [VOL, UNI, FILE, LIVE]) await hardDelete(t);

  const deadline = "2026-12-15";

  // ---------------- VOL: 15 packages / 40 contractors / 20 bids ----------------
  const volId = await createProject(VOL, "QA18 Volume Fixture", "New York, NY");
  const csiList = [
    "03 30 00", "04 20 00", "05 12 00", "07 21 00", "08 11 00",
    "09 29 00", "21 13 00", "22 00 00", "23 00 00", "26 00 00",
    "27 10 00", "28 31 00", "31 10 00", "32 31 00", "33 11 00",
  ];
  const volPackages = [];
  for (let i = 0; i < csiList.length; i++) {
    const pkgId = await createPackage(
      volId,
      csiList[i],
      `AUDIT-QA18-VOL Package ${String(i + 1).padStart(2, "0")}`,
      deadline,
      { budgetEstimate: i === 9 ? 1_000_000 : 500_000 + i * 25_000 }
    );
    await setStatus(pkgId, "rfqs_dispatched");
    volPackages.push(pkgId);
  }
  say(`VOL packages: ${volPackages.length}`);

  const volContractors = [];
  const pkgMain = volPackages[9]; // Division 26
  for (let i = 1; i <= 20; i++) {
    const cid = await createContractor(
      pkgMain,
      `AUDIT-QA18 VOL Sub ${String(i).padStart(2, "0")}`,
      `qa18.vol.${i}@qa18.invalid`
    );
    volContractors.push(cid);
  }
  let spreadIndex = 20;
  for (let p = 0; p < 5; p++) {
    for (let k = 0; k < 4; k++) {
      spreadIndex++;
      const cid = await createContractor(
        volPackages[p],
        `AUDIT-QA18 VOL Sub ${String(spreadIndex).padStart(2, "0")}`,
        `qa18.vol.${spreadIndex}@qa18.invalid`
      );
      volContractors.push(cid);
    }
  }
  say(`VOL contractors: ${volContractors.length}`);

  const volBids = [];
  for (let i = 0; i < 20; i++) {
    const base = i === 19 ? 430_000 : 700_000 + i * 22_500;
    const bidId = await createBid(pkgMain, volContractors[i], `AUDIT-QA18 VOL Sub ${String(i + 1).padStart(2, "0")}`, base, {
      identifiedExclusions: i % 3 === 0 ? [{ description: `QA18 exclusion ${i}`, costImpact: 12_000 + i, severity: "medium" }] : [],
      valueEngineeringAlternates: i % 4 === 0 ? [{ description: `QA18 VE ${i}`, costDeduct: 9_000, isAccepted: true }] : [],
      longLeadEquipmentWeeks: 4 + (i % 10),
      leadTimePenalty: (i % 3) * 6000,
    });
    volBids.push(bidId);
  }
  say(`VOL bids: ${volBids.length}`);

  // ---------------- UNI: unicode / RTL ----------------
  const uniId = await createProject(UNI, "QA18 Unicode Fixture", "Dubai, UAE");
  const arabic = "مشروع الأعمال الكهربائية";
  const hebrew = "פרויקט מיזוג אוויר";
  const cjk = "配管工事プラント";
  const emoji = "🚧 Fire Protection 🔥 🧯";
  const longWord = "W".repeat(200);
  const uniPkgs = [];
  uniPkgs.push(await createPackage(uniId, "26 00 00", arabic, deadline, { budgetEstimate: 300_000 }));
  uniPkgs.push(await createPackage(uniId, "23 00 00", hebrew, deadline, { budgetEstimate: 300_000 }));
  uniPkgs.push(await createPackage(uniId, "22 00 00", cjk, deadline, { budgetEstimate: 300_000 }));
  uniPkgs.push(await createPackage(uniId, "21 00 00", emoji, deadline, { budgetEstimate: 300_000 }));
  uniPkgs.push(await createPackage(uniId, "03 30 00", longWord, deadline, { budgetEstimate: 300_000 }));
  for (const p of uniPkgs) await setStatus(p, "rfqs_dispatched");
  const uniCtr = [];
  uniCtr.push(await createContractor(uniPkgs[0], "شركة الكهرباء المتحدة", "qa18.uni.ar@qa18.invalid"));
  uniCtr.push(await createContractor(uniPkgs[1], "חברת מיזוג אוויר בע״מ", "qa18.uni.he@qa18.invalid"));
  uniCtr.push(await createContractor(uniPkgs[2], "東京配管株式会社", "qa18.uni.cjk@qa18.invalid"));
  uniCtr.push(await createContractor(uniPkgs[3], "🔥 Emoji Fire Co 🚧", "qa18.uni.emo@qa18.invalid"));
  uniCtr.push(await createContractor(uniPkgs[4], longWord, "qa18.uni.long@qa18.invalid"));
  const uniBids = [];
  for (let i = 0; i < 5; i++) {
    uniBids.push(
      await createBid(uniPkgs[i], uniCtr[i], ["شركة الكهرباء المتحدة", "חברת מיזוג אוויר בע״מ", "東京配管株式会社", "🔥 Emoji Fire Co 🚧", longWord][i], 200_000 + i * 10_000)
    );
  }
  say(`UNI packages=${uniPkgs.length} contractors=${uniCtr.length} bids=${uniBids.length}`);

  // ---------------- FILE: upload/test project ----------------
  const fileId = await createProject(FILE, "QA18 Files Fixture", "Seattle, WA");
  const filePkg = await createPackage(fileId, "26 00 00", "AUDIT-QA18-FILE Electrical", deadline, { budgetEstimate: 250_000 });
  await setStatus(filePkg, "rfqs_dispatched");

  // ---------------- LIVE: shared fixture for stale-modal + deeplink ----------------
  const liveId = await createProject(LIVE, "QA18 Live Fixture", "Austin, TX");
  const liveP1 = await createPackage(liveId, "26 00 00", "AUDIT-QA18-LIVE Alpha Electrical", deadline, { budgetEstimate: 400_000 });
  const liveP2 = await createPackage(liveId, "22 00 00", "AUDIT-QA18-LIVE Beta Plumbing", deadline, { budgetEstimate: 300_000 });
  await setStatus(liveP1, "rfqs_dispatched");
  await setStatus(liveP2, "rfqs_dispatched");
  const liveC1 = await createContractor(liveP1, "AUDIT-QA18-LIVE Alpha Sub", "qa18.live.a@qa18.invalid");
  const liveC2 = await createContractor(liveP2, "AUDIT-QA18-LIVE Beta Sub", "qa18.live.b@qa18.invalid");
  const liveB1 = await createBid(liveP1, liveC1, "AUDIT-QA18-LIVE Alpha Sub", 380_000);
  const liveB2 = await createBid(liveP2, liveC2, "AUDIT-QA18-LIVE Beta Sub", 290_000);

  const map = {
    generatedAt: new Date().toISOString(),
    todayUtc: utcDate(new Date()),
    vol: { title: VOL, id: volId, packages: volPackages, mainPackage: pkgMain, contractors: volContractors, bids: volBids },
    uni: { title: UNI, id: uniId, packages: uniPkgs, contractors: uniCtr, bids: uniBids, strings: { arabic, hebrew, cjk, emoji, longWord } },
    file: { title: FILE, id: fileId, package: filePkg },
    live: { title: LIVE, id: liveId, p1: liveP1, p2: liveP2, c1: liveC1, c2: liveC2, b1: liveB1, b2: liveB2 },
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