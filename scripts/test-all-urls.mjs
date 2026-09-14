import https from "https";
import http from "http";
import { URL } from "url";

const urlsToTest = [
  // State registries
  "https://pels.texas.gov/",
  "https://www.cslb.ca.gov/",
  "https://www.dos.ny.gov/licensing/",
  "https://www.myfloridalicense.com/",
  "https://idfpr.illinois.gov/",
  "https://dpo.colorado.gov/",
  "https://secure.lni.wa.gov/verify/",
  "https://sos.ga.gov/licensing-division-georgia-secretary-states-office",
  "https://www.nclbgc.org/",
  "https://com.ohio.gov/divisions-and-programs/industrial-compliance/boards/ohio-construction-industry-licensing-board",
  "https://www.dos.pa.gov/ProfessionalLicensing/",
  "https://www.mass.gov/orgs/office-of-consumer-affairs-and-business-regulation",
  "https://www.dpor.virginia.gov/",
  "https://roc.az.gov/",
  "https://www.michigan.gov/lara",
  "https://www.nj.gov/dca/",
  "https://www.tn.gov/commerce/regboards/contractors.html",
  "https://www.dli.mn.gov/",
  "https://www.dllr.state.md.us/",
  "https://pr.mo.gov/",
  "https://www.in.gov/pla/",
  "https://www.agc.org/",

  // Commercial contractors
  "https://www.rosendin.com",
  "https://goalterman.com",
  "https://prismelectric.com",
  "https://www.bergelectric.com",
  "https://www.dynamicsystemsusa.com",
  "https://www.brandt.us",
  "https://www.tdindustries.com",
  "https://www.clarkekentplumbing.com",
  "https://www.danielshvacplumbing.com",
  "https://www.centuryfp.com",
  "https://www.wsfp.com",
  "https://bakerconcrete.com",
  "https://www.lithko.com",
  "https://www.schuff.com",
  "https://www.patrioterectors.com",
  "https://www.centimark.com",
  "https://www.chamberlinltd.com",
  "https://www.marekbros.com",
  "https://www.performancecontracting.com",
  "https://www.traviscountytx.gov",
];

async function checkUrl(targetUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(targetUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    return { url: targetUrl, status: resp.status, ok: resp.ok };
  } catch (err) {
    return { url: targetUrl, status: "ERROR", error: err.message };
  }
}

async function run() {
  console.log(`Checking ${urlsToTest.length} URLs...`);
  const results = [];
  for (const u of urlsToTest) {
    const res = await checkUrl(u);
    results.push(res);
    const statusStr = res.ok ? "OK (200)" : `FAIL (${res.status || res.error})`;
    console.log(`[${statusStr}] ${res.url}`);
  }

  const failures = results.filter((r) => !r.ok);
  console.log(`\nResults: ${results.length - failures.length} passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.log("FAILURES:");
    failures.forEach((f) => console.log(`  ${f.url}: ${f.status || f.error}`));
  }
}

run();
