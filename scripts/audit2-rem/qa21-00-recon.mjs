/** QA21-00: live deployment recon (read-only). */
import { client, listProjects, writeEvidence, writeLog, PREFIX, URL, WEBSITE } from "./qa21-lib.mjs";

const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function httpStatus(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    return { url, status: res.status };
  } catch (err) {
    return { url, error: String(err?.message ?? err) };
  }
}

async function main() {
  const c = client();
  const projects = await listProjects(c);
  const qa21 = projects.filter((p) => String(p.title).startsWith(PREFIX));
  const otherQa = projects.filter((p) => /^AUDIT-QA\d+/i.test(p.title) && !String(p.title).startsWith(PREFIX));
  const demo = projects.filter((p) => p.isDemoProject);
  const out = {
    generatedAt: new Date().toISOString(),
    backend: URL,
    website: WEBSITE,
    projectCount: projects.length,
    qa21Leftovers: qa21.map((p) => ({ id: p._id, title: p.title })),
    otherAuditProjects: otherQa.map((p) => p.title).slice(0, 40),
    demoProjects: demo.map((p) => p.title),
    site: await httpStatus(WEBSITE),
    backendHttp: await httpStatus(`${URL}/version`),
  };
  say(`projects=${projects.length} qa21Leftovers=${qa21.length} demo=${demo.length}`);
  say(`site=${JSON.stringify(out.site)} backend=${JSON.stringify(out.backendHttp)}`);
  writeEvidence("00-recon", out);
  writeLog("00-recon", log);
}

main().catch((e) => {
  console.error(e);
  writeLog("00-recon-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});