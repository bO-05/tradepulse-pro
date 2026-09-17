import { ConvexHttpClient } from "convex/browser";

const url = process.argv[2] || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(url);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};
const readable = (e) => {
  if (!e) return "";
  if (e.data !== undefined) {
    return typeof e.data === "string" ? e.data : JSON.stringify(e.data);
  }
  return String(e.message || e);
};

console.log("DEPLOYMENT:", url);

// Locate or create a QA-REM fixture project with one package + one contractor
const projects = await client.query("projects:listProjects", {});
let proj = projects.find((p) => p.title.startsWith("QA-REM") && !p.isDemoProject);
if (!proj) {
  const id = await client.mutation("projects:createProject", {
    title: `QA-REM-R3-${Date.now()}`,
    location: "Austin, TX",
    projectType: "QA Round 3",
    estBudget: 3000000,
    targetCompletionWeeks: 40,
    specDocumentText: "QA round 3 fixture project.",
    isDemoProject: false,
  });
  proj = { _id: id, title: "QA-REM-R3" };
}
let pkgs = await client.query("tradePackages:listByProject", { projectId: proj._id });
if (pkgs.length === 0) {
  const pkgId = await client.mutation("tradePackages:createTradePackage", {
    projectId: proj._id,
    csiDivision: "26 00 00",
    tradeName: "QA Round 3 Electrical",
    budgetEstimate: 1250000,
    scopeSummary: "QA fixture scope for round 3 verification.",
    mandatoryInclusions: ["Code compliance"],
    bidDeadline: "2026-10-31",
  });
  pkgs = [{ _id: pkgId }];
}
const pkg = pkgs[0];
console.log("fixture project:", proj.title, "| package:", pkg._id);

// 1) Guest RFI (no contractorId) must be accepted and persist
const before = await client.query("rfq:listConversations", { tradePackageId: pkg._id });
let guestOk = false;
try {
  const res = await client.mutation("simulation:submitCustomRfi", {
    tradePackageId: pkg._id,
    subject: "QA-REM guest RFI probe",
    question: "Does the base scope include crane hoisting for the main equipment to the penthouse?",
  });
  guestOk = res?.success === true;
  check("Guest RFI mutation accepted (was unhandled server error)", guestOk, JSON.stringify(res));
} catch (e) {
  check("Guest RFI mutation accepted (was unhandled server error)", false, readable(e));
}
if (guestOk) {
  let persisted = false;
  for (let i = 0; i < 24; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    const after = await client.query("rfq:listConversations", { tradePackageId: pkg._id });
    if (after.length > before.length) { persisted = true; break; }
  }
  check("Guest RFI persisted as conversation/audit trail", persisted, `before=${before.length}`);
}

// 2) CSI 99 99 99 must be rejected with a readable message
try {
  await client.mutation("tradePackages:createTradePackage", {
    projectId: proj._id,
    csiDivision: "99 99 99",
    tradeName: "QA invalid division",
    budgetEstimate: 100000,
    scopeSummary: "Invalid division probe.",
    mandatoryInclusions: ["None"],
    bidDeadline: "2026-10-31",
  });
  check("CSI 99 99 99 rejected", false, "unexpected success");
} catch (e) {
  const msg = readable(e);
  check("CSI 99 99 99 rejected", true, msg.slice(0, 140));
  check("CSI rejection message readable (ConvexError data)", Boolean(msg) && !msg.includes("[CONVEX"), msg.slice(0, 140));
}

// 3) $1 bid and $999,999,999 bid must be rejected with readable messages
let contractors = await client.query("contractors:listByPackage", { tradePackageId: pkg._id });
let contractorId = contractors[0]?._id;
if (!contractorId) {
  contractorId = await client.mutation("contractors:createContractor", {
    tradePackageId: pkg._id,
    companyName: "QA-REM Round3 Contractor",
    contactEmail: "qa.rem.round3@tradepulse-pro.test",
    phone: "+1 (512) 555-0199",
    licenseNumber: "QA-R3-001",
    licenseStatus: "Active / Verified",
    sourceUrl: "https://tradepulse-pro.test/qa",
    rfqStatus: "invited",
  });
}
for (const amount of [1, 999999999]) {
  try {
    await client.mutation("bids:submitDirectBid", {
      tradePackageId: pkg._id,
      contractorId,
      subcontractorName: "QA-REM Round3 Bidder",
      baseBidAmount: amount,
    });
    check(`Absurd bid $${amount.toLocaleString()} rejected`, false, "unexpected success");
  } catch (e) {
    const msg = readable(e);
    check(`Absurd bid $${amount.toLocaleString()} rejected`, true, msg.slice(0, 140));
    check(`Absurd bid $${amount.toLocaleString()} message readable`, Boolean(msg) && !msg.includes("[CONVEX"), msg.slice(0, 140));
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length === 0 ? 0 : 1;