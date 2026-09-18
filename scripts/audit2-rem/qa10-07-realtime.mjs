import { launchBrowser, waitForAppReady, delay, selectProjectByTitle, shot } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, corruptId, call } from "./qa10-lib.mjs";

const log = [];
const say = (s) => { log.push(s); console.log(s); };
const WEBSITE = "https://brainy-skunk-440.convex.site";

const IDLE_MS = Number(process.env.QA10_IDLE_MS || 185000);

async function instrument(page) {
  const stats = { sent: 0, received: 0, wsOpened: 0, wsClosed: 0, requests: [], framesByMinute: [] };
  page.on("websocket", (ws) => {
    stats.wsOpened++;
    ws.on("framesent", () => stats.sent++);
    ws.on("framereceived", () => stats.received++);
    ws.on("close", () => stats.wsClosed++);
  });
  page.on("request", (r) => {
    const url = r.url();
    if (/convex\.(cloud|site)/.test(url) && r.resourceType() !== "websocket") {
      stats.requests.push({ at: Date.now(), method: r.method(), url: url.slice(0, 120) });
    }
  });
  return stats;
}

async function main() {
  const c = client();
  const F = readEvidence("fixtures");
  const alphaPkg = F.alpha.elecPackageId;

  // start a deterministic realtime mutation: new bidder (new lowest leveled bid)
  const ctrRes = await call("create realtime bidder", () => c.mutation("contractors:createContractor", {
    tradePackageId: alphaPkg,
    companyName: "AUDIT-QA10 Realtime Bidder",
    contactEmail: "realtime.bidder@qa10.invalid",
    licenseNumber: "TX-QA10-RT1",
    licenseStatus: "Active / Verified (TDLR-QA)",
    sourceUrl: "https://qa10.example.invalid/rt",
    rfqStatus: "invited",
  }));
  const rtCtr = ctrRes.value;
  say(`realtime contractor: ${JSON.stringify(rtCtr)}`);

  const { browser } = await launchBrowser(1440, 900);
  const ctxA = await browser.createBrowserContext();
  const ctxB = await browser.createBrowserContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const statsA = await instrument(pageA);
  const statsB = await instrument(pageB);
  const out = { idleMs: IDLE_MS, pages: {} };
  try {
    for (const [name, page] of [["A", pageA], ["B", pageB]]) {
      await page.goto(WEBSITE, { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForAppReady(page);
      await delay(700);
      await selectProjectByTitle(page, "AUDIT-QA10-ALPHA");
      await delay(900);
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("header button")].find((x) => (x.innerText || "").includes("Bid Leveling"));
        if (b) b.click();
      });
      await delay(900);
      await page.evaluate(() => { window.__qa10Stamp = "alive-" + Date.now(); });
      await shot(page, `fix4-qa10-07-realtime-${name}-before.png`);
    }
    const beforeA = await pageA.evaluate(() => document.body.innerText.includes("AUDIT-QA10 Realtime Bidder"));
    const beforeB = await pageB.evaluate(() => document.body.innerText.includes("AUDIT-QA10 Realtime Bidder"));
    say(`before mutation visible: A=${beforeA} B=${beforeB}`);
    const sentBefore = { A: statsA.received, B: statsB.received };
    out.sentBefore = sentBefore;

    // mutate (submit bid) as an independent context
    const t0 = Date.now();
    const bidRes = await call("realtime submit bid", () => c.mutation("bids:submitDirectBid", {
      tradePackageId: alphaPkg,
      contractorId: rtCtr,
      subcontractorName: "AUDIT-QA10 Realtime Bidder",
      baseBidAmount: 700000,
      lineItems: [{ item: "QA10 Realtime Base Scope", unit: "LS", quantity: 1, unitCost: 700000, totalCost: 700000 }],
      identifiedExclusions: [],
      valueEngineeringAlternates: [],
      longLeadEquipmentWeeks: 10,
      leadTimePenalty: 0,
      coiComplianceStatus: "compliant",
      coiPenalty: 0,
    }));
    say(`realtime bid mutation: ${JSON.stringify(bidRes.value ?? bidRes.data)}`);

    let updateA = null, updateB = null;
    for (let i = 0; i < 120 && (!updateA || !updateB); i++) {
      await delay(250);
      if (!updateA) {
        const seen = await pageA.evaluate(() => document.body.innerText.includes("AUDIT-QA10 Realtime Bidder"));
        if (seen) updateA = Date.now() - t0;
      }
      if (!updateB) {
        const seen = await pageB.evaluate(() => document.body.innerText.includes("AUDIT-QA10 Realtime Bidder"));
        if (seen) updateB = Date.now() - t0;
      }
    }
    const stampA = await pageA.evaluate(() => window.__qa10Stamp);
    const stampB = await pageB.evaluate(() => window.__qa10Stamp);
    const noReloadA = typeof stampA === "string" && stampA.startsWith("alive-");
    const noReloadB = typeof stampB === "string" && stampB.startsWith("alive-");
    out.realtime = { updateAms: updateA, updateBms: updateB, noReloadA, noReloadB };
    say(`realtime update: A=${updateA}ms B=${updateB}ms noReload A=${noReloadA} B=${noReloadB}`);
    await shot(pageA, "fix4-qa10-07-realtime-A-after.png");
    await shot(pageB, "fix4-qa10-07-realtime-B-after.png");

    const burstA = statsA.received - sentBefore.A;
    const burstB = statsB.received - sentBefore.B;
    const sentAfterMutation = { A: statsA.sent, B: statsB.sent };
    say(`frames after mutation: A recv+=${burstA} B recv+=${burstB}`);

    // ---------- idle churn watch ----------
    const samples = [];
    const mark = () => ({ at: Date.now(), A: { sent: statsA.sent, received: statsA.received, reqs: statsA.requests.length }, B: { sent: statsB.sent, received: statsB.received, reqs: statsB.requests.length } });
    samples.push(mark());
    const idleStart = Date.now();
    while (Date.now() - idleStart < IDLE_MS) {
      await delay(15000);
      samples.push(mark());
    }
    out.idleSamples = samples.map((s, i) => ({
      minute: ((s.at - samples[0].at) / 60000).toFixed(2),
      A: { sent: s.A.sent - samples[0].A.sent, recv: s.A.received - samples[0].A.received, reqs: s.A.reqs - samples[0].A.reqs },
      B: { sent: s.B.sent - samples[0].B.sent, recv: s.B.received - samples[0].B.received, reqs: s.B.reqs - samples[0].B.reqs },
    }));
    say("idle samples (cumulative from idle start):");
    out.idleSamples.forEach((s) => say(`  t=${s.minute}min A(sent=${s.A.sent},recv=${s.A.recv},httpReqs=${s.A.reqs}) B(sent=${s.B.sent},recv=${s.B.recv},httpReqs=${s.B.reqs})`));
    const last = out.idleSamples[out.idleSamples.length - 1];
    const wsReconnects = { A: statsA.wsOpened - 1, B: statsB.wsOpened - 1 };
    const idleVerdict = {
      idleMinutes: last ? Number(last.minute) : 0,
      wsFramesA: last ? last.A.recv + last.A.sent : null,
      wsFramesB: last ? last.B.recv + last.B.sent : null,
      httpRequestsDuringIdle: last ? { A: last.A.reqs, B: last.B.reqs } : null,
      wsReconnects,
      framesPerMinute: last && Number(last.minute) > 0 ? { A: (last.A.recv + last.A.sent) / Number(last.minute), B: (last.B.recv + last.B.sent) / Number(last.minute) } : null,
      pass: last ? last.A.reqs === 0 && last.B.reqs === 0 && wsReconnects.A === 0 && wsReconnects.B === 0 && (last.A.recv + last.A.sent) / Number(last.minute) < 30 && (last.B.recv + last.B.sent) / Number(last.minute) < 30 : false,
      httpRequestSamples: { A: statsA.requests.slice(-5), B: statsB.requests.slice(-5) },
    };
    out.idleVerdict = idleVerdict;
    say(`idle verdict: ${JSON.stringify(idleVerdict)}`);

    // duplicate query check: mutate again and compare frames per page for duplicate bursts
    const preDup = { A: statsA.received, B: statsB.received };
    await c.mutation("bids:updateBidLeveling", { bidId: bidRes.value.bidId, baseBidAmount: 700500 });
    await delay(4000);
    out.duplicateBurst = { A: statsA.received - preDup.A, B: statsB.received - preDup.B };
    say(`post-second-mutation received frames: A=${out.duplicateBurst.A} B=${out.duplicateBurst.B}`);

    // cleanup realtime bidder + bid via bid delete then contractor delete
    const bidId = bidRes.value?.bidId;
    if (bidId) {
      await call("cleanup realtime bid", () => c.mutation("bids:deleteBid", { bidId }));
    }
    if (rtCtr) {
      await call("cleanup realtime contractor", () => c.mutation("contractors:deleteContractor", { contractorId: rtCtr }));
    }

    writeEvidence("realtime", out);
    writeLog("realtime", log);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });