import { launchBrowser, waitForAppReady, delay, selectProjectByTitle } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, call } from "./qa10-lib.mjs";

const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function main() {
  const c = client();
  const F = readEvidence("fixtures");
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const reqs = [];
  const responses = {};
  page.on("request", (r) => reqs.push({ t: Date.now(), url: r.url(), type: r.resourceType(), initiator: r.initiator()?.type ?? null }));
  page.on("response", async (r) => {
    if (r.url().includes("tradepulse.svg")) {
      responses.svg = { status: r.status(), headers: r.headers() };
    }
  });
  try {
    await page.evaluateOnNewDocument(() => {
      const Orig = window.WebSocket;
      window.__wsProbe = { instances: 0, framesSent: 0, framesReceived: 0, opens: 0, closes: 0, errors: 0, urls: [] };
      function Wrapped(url, protocols) {
        window.__wsProbe.instances++;
        window.__wsProbe.urls.push(String(url).slice(0, 80));
        const ws = new Orig(url, protocols);
        ws.addEventListener("open", () => window.__wsProbe.opens++);
        ws.addEventListener("close", () => window.__wsProbe.closes++);
        ws.addEventListener("error", () => window.__wsProbe.errors++);
        const origSend = ws.send.bind(ws);
        ws.send = (data) => { window.__wsProbe.framesSent++; return origSend(data); };
        ws.addEventListener("message", () => window.__wsProbe.framesReceived++);
        return ws;
      }
      Wrapped.prototype = Orig.prototype;
      Object.setPrototypeOf(Wrapped, Orig);
      window.WebSocket = Wrapped;
    });
    await page.goto("https://brainy-skunk-440.convex.site", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(600);
    await selectProjectByTitle(page, "AUDIT-QA10-ALPHA");
    await delay(1500);
    const probe0 = await page.evaluate(() => ({ ...window.__wsProbe }));
    say(`ws probe after connect: ${JSON.stringify(probe0)}`);
    const reqCount0 = reqs.length;

    // second mutation for duplicate-query burst measurement
    const st = readEvidence("fixtures");
    const bids = await c.query("bids:listByPackage", { tradePackageId: st.alpha.elecPackageId });
    const target = bids.find((b) => !b.isAwarded);
    const mutation = await call("probe mutation", () => c.mutation("bids:updateBidLeveling", { bidId: target._id, longLeadEquipmentWeeks: 11 }));
    await delay(4000);
    const probe1 = await page.evaluate(() => ({ ...window.__wsProbe }));
    say(`ws probe after mutation: ${JSON.stringify(probe1)}`);

    const idleStart = Date.now();
    await delay(62000);
    const probe2 = await page.evaluate(() => ({ ...window.__wsProbe }));
    const idleReqs = reqs.slice(reqCount0);
    const byUrl = {};
    for (const r of idleReqs) {
      const key = r.url.replace(/https?:\/\/[^/]+/, "").split("?")[0];
      byUrl[key] = (byUrl[key] || 0) + 1;
    }
    const idleSec = (Date.now() - idleStart) / 1000;
    const afterMutationWs = { sent: probe1.framesSent - probe0.framesSent, received: probe1.framesReceived - probe0.framesReceived, opens: probe1.opens - probe0.opens, closes: probe1.closes - probe0.closes };
    const idleWs = { sent: probe2.framesSent - probe1.framesSent, received: probe2.framesReceived - probe1.framesReceived, opens: probe2.opens - probe1.opens, closes: probe2.closes - probe1.closes };
    const result = {
      probe0, probe1, probe2,
      afterMutationWs,
      idleSeconds: idleSec,
      idleWs,
      idleWsPerMinute: { sent: (idleWs.sent / idleSec) * 60, received: (idleWs.received / idleSec) * 60 },
      idleHttpRequests: { total: idleReqs.length, perMinute: (idleReqs.length / idleSec) * 60, byUrl },
      svgResponseHeaders: responses.svg ?? null,
      requestInitiators: reqs.slice(0, 30).map((r) => `${r.type} ${r.url.replace(/https?:\/\/[^/]+/, "")} init=${r.initiator}`),
    };
    say(`after-mutation ws frames: ${JSON.stringify(afterMutationWs)}`);
    say(`idle ${idleSec.toFixed(1)}s ws frames: ${JSON.stringify(idleWs)} (${JSON.stringify(result.idleWsPerMinute)})`);
    say(`idle HTTP requests: total=${idleReqs.length} perMinute=${result.idleHttpRequests.perMinute.toFixed(1)} byUrl=${JSON.stringify(byUrl)}`);
    say(`tradepulse.svg response: ${JSON.stringify(result.svgResponseHeaders)}`);
    writeEvidence("ws-probe", result);
    writeLog("ws-probe", log);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });