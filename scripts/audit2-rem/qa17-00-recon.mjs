/**
 * QA17 recon: live clock, fixture inventory, legacy deadline formats, cron status.
 * Read-only except for deleting nothing. Guards: only AUDIT-QA17-* is ours.
 */
import { client, listProjects, writeEvidence, writeLog, utcDate, zonedDate, zonedDateTime, longDateUtc } from "./qa17-lib.mjs";

const c = client();
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const now = new Date();
  const clock = {
    iso: now.toISOString(),
    utcDate: utcDate(now),
    utcLong: longDateUtc(utcDate(now)),
    nyDate: zonedDate(now, "America/New_York"),
    nyDateTime: zonedDateTime(now, "America/New_York"),
    laDate: zonedDate(now, "America/Los_Angeles"),
    laDateTime: zonedDateTime(now, "America/Los_Angeles"),
    tokyoDate: zonedDate(now, "Asia/Tokyo"),
    jakartaDate: zonedDate(now, "Asia/Jakarta"),
    machineTz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  say(`clock: ${JSON.stringify(clock)}`);

  const projects = await listProjects(c);
  say(`projects: ${projects.length}`);
  const byTitle = projects.map((p) => ({ id: p._id, title: p.title, isDemo: p.isDemoProject }));

  const qa17 = projects.filter((p) => (p.title || "").startsWith("AUDIT-QA17-"));
  const qa17Packages = [];
  const offendingFormats = [];
  for (const p of projects) {
    let pkgs = [];
    try {
      pkgs = (await c.query("tradePackages:listByProject", { projectId: p._id })) || [];
    } catch (err) {
      say(`listByProject failed for ${p.title}: ${err?.message}`);
      continue;
    }
    for (const pkg of pkgs) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pkg.bidDeadline)) {
        offendingFormats.push({ project: p.title, packageId: pkg._id, csi: pkg.csiDivision, deadline: pkg.bidDeadline });
      }
      if ((p.title || "").startsWith("AUDIT-QA17-")) {
        qa17Packages.push({ project: p.title, id: pkg._id, csi: pkg.csiDivision, name: String(pkg.tradeName).slice(0, 40), deadline: pkg.bidDeadline, status: pkg.status });
      }
    }
  }
  say(`legacy/non-date-only deadlines: ${offendingFormats.length}`);
  if (offendingFormats.length) say(JSON.stringify(offendingFormats.slice(0, 10)));

  const cronStatus = await c.query("crons:getCronStatus", {});
  say(`cronStatus: ${JSON.stringify(cronStatus)}`);

  writeEvidence("recon", { clock, projectCount: projects.length, projects: byTitle, qa17Packages, offendingFormats, cronStatus, note: "QA17 owns only AUDIT-QA17-* fixtures; demo/GC-AUDIT/AUDIT-5-*/AUDIT-QA* untouched." });
  writeLog("recon", log);
  console.log(JSON.stringify(clock, null, 2));
}

main().catch((e) => {
  console.error(e);
  writeLog("recon-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});