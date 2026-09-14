const urlsToTest = [
  // State registries (active live registries used in STATE_CONFIG)
  "https://pels.texas.gov/",
  "https://www.cslb.ca.gov/",
  "https://idfpr.illinois.gov/",
  "https://secure.lni.wa.gov/verify/",
  "https://www.nclbgc.org/",
  "https://com.ohio.gov/",
  "https://www.pa.gov/",
  "https://www.mass.gov/orgs/office-of-consumer-affairs-and-business-regulation",
  "https://www.michigan.gov/lara",
  "https://www.nj.gov/dca/",
  "https://www.dli.mn.gov/",
  "https://www.dllr.state.md.us/",
  "https://www.in.gov/pla/",
  "https://www.agc.org/",

  // Commercial contractors (all active and verified)
  "https://www.rosendin.com",
  "https://goalterman.com",
  "https://prismelectric.com",
  "https://www.bergelectric.com",
  "https://southlandind.com",
  "https://brandt.us",
  "https://www.tdindustries.com",
  "https://clarkekentplumbing.com",
  "https://limbachinc.com",
  "https://www.centuryfp.com/",
  "https://www.vikinggroupinc.com/",
  "https://www.bakerconcrete.com/",
  "https://www.webcor.com/",
  "https://www.cmc.com/",
  "https://www.aisc.org/",
  "https://www.centimark.com/",
  "https://www.chamberlinltd.com/",
  "https://www.marekbros.com/",
  "https://www.performancecontracting.com/",
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
  console.log(`Checking ${urlsToTest.length} URLs sequentially...`);
  const results = [];
  for (const u of urlsToTest) {
    const res = await checkUrl(u);
    results.push(res);
    const statusStr = res.ok ? "OK (200)" : `FAIL (${res.status || res.error})`;
    console.log(`[${statusStr}] ${res.url}`);
    await new Promise((r) => setTimeout(r, 120));
  }

  const failures = results.filter((r) => !r.ok);
  console.log(`\nResults: ${results.length - failures.length}/${results.length} passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.log("FAILURES:");
    failures.forEach((f) => console.log(`  ${f.url}: ${f.status || f.error}`));
    process.exit(1);
  } else {
    console.log("ALL TESTED CONTRACTOR & REGISTRY URLS RETURNED 200 OK!");
  }
}

run();
