/**
 * QA19-03: A17-02 — runFullProcurementCycle agreement date must carry "(UTC)",
 * and the demo seed source must label its legal date "(UTC)".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { client, readEvidence, writeEvidence, writeLog } from "./qa19-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${JSON.stringify(detail)}`);
};

function utcLongDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

async function main() {
  const run = await c.mutation("simulation:runFullProcurementCycle", {
    projectId: F.sim.id,
    tradePackageId: F.sim.p1,
  });
  say(`simulation result: ${JSON.stringify(run)}`);

  const agreements = (await c.query("agreements:listAgreements", { projectId: F.sim.id })) || [];
  const agreement = agreements.find((a) => a._id === run.agreementId || a.tradePackageId === F.sim.p1) || null;
  const expectedDate = utcLongDate();
  const expectedLabel = `${expectedDate} (UTC)`;
  const text = agreement?.contractText || "";
  const dateLine = text
    .split("\n")
    .find((l) => /Effective Date|dated|Date:/i.test(l)) || null;

  record("A17-02.simulation-agreement-generated", Boolean(agreement), {
    agreementId: run.agreementId,
    agreementNumber: run.agreementNumber,
    status: agreement?.status || null,
  });
  record("A17-02.contractText-contains-UTC-label", text.includes(expectedLabel), {
    expectedLabel,
    foundLabel: text.includes(expectedLabel),
    dateLikeLine: dateLine ? dateLine.trim().slice(0, 160) : null,
  });
  record("A17-02.no-bare-local-date-claim", !text.includes(`${expectedDate} (local)`), {
    note: "server renders UTC explicitly; no other tz is claimed",
  });

  // Source check: demo seed path in convex/projects.ts.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const projectsSrc = fs.readFileSync(path.join(root, "convex", "projects.ts"), "utf8");
  const seedBlock = projectsSrc.slice(projectsSrc.indexOf("formattedDate: `${new Date()"), projectsSrc.indexOf("formattedDate: `${new Date()") + 260);
  const seedHasUtcTz = /timeZone:\s*"UTC"/.test(seedBlock) && /\(UTC\)/.test(seedBlock);
  const simSrc = fs.readFileSync(path.join(root, "convex", "simulation.ts"), "utf8");
  const simLine = simSrc.split("\n").find((l) => l.includes("const formattedDate")) || "";
  record("A17-02.demo-seed-source-UTC", seedHasUtcTz, {
    block: seedBlock.replace(/\s+/g, " ").slice(0, 200),
  });
  record("A17-02.simulation-source-UTC", /timeZone:\s*"UTC"/.test(simLine) && /\(UTC\)/.test(simLine), {
    line: simLine.trim().slice(0, 200),
  });

  const out = {
    capturedAt: new Date().toISOString(),
    run,
    agreement: agreement
      ? {
          _id: agreement._id,
          agreementNumber: agreement.agreementNumber,
          status: agreement.status,
          contractTextLength: text.length,
          dateLine: dateLine ? dateLine.trim() : null,
          containsExpectedUtcLabel: text.includes(expectedLabel),
        }
      : null,
    expectedLabel,
    seedSource: { seedBlock: seedBlock.replace(/\s+/g, " ").slice(0, 240) },
    simulationSource: { line: simLine.trim().slice(0, 220) },
    results,
  };
  writeEvidence("sim-utc", out);
  writeLog("sim-utc", log);
  console.log(`results: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("sim-utc-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});