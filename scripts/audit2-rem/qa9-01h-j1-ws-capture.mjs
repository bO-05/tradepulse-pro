/**
 * QA9 J1h: CDP WebSocket frame capture around the UI dispatch click.
 * Evidence: evidence/fix4-qa9-j1h-*.json
 */
import { client, launchBrowser, waitForAppReady, delay, selectProjectByTitle, writeEvidence, FIXTURE_TAG } from "./qa9-lib.mjs";

const c = client();
const PROJECT = `${FIXTURE_TAG}-J1-ESTIMATOR`;
const p = (await c.query("projects:listProjects", {})).find((x) => x.title === PROJECT);
const pkg = await c.mutation("tradePackages:createTradePackage", {
  projectId: p._id, csiDivision: "15 00 00", tradeName: "QA9 Mechanical Insulation", budgetEstimate: 130000,
  scopeSummary: "Insulation probe.", mandatoryInclusions: ["Thickness cert"],
  bidDeadline: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
});
await c.mutation("contractors:createContractor", {
  tradePackageId: pkg, companyName: "QA9 InsulProbe", contactEmail: "bids@qa9-insul.test",
  phone: "(208) 555-0701", licenseNumber: "ID-QA9-6001", licenseStatus: "Active & Verified",
  sourceUrl: "https://qa9-insul.test", rfqStatus: "discovered",
});

const result = { journey: "J1h", data: { pkgId: pkg } };
const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const sent = []; const received = [];
try {
  const cdp = await page.target().createCDPSession();
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketFrameSent", (e) => {
    const d = e.response.payloadData || "";
    if (d.includes("dispatch") || d.includes("rfq")) sent.push(d.slice(0, 500));
  });
  cdp.on("Network.webSocketFrameReceived", (e) => {
    const d = e.response.payloadData || "";
    if (d.includes("Server Error") || d.includes("dispatchRfqs") || d.includes("error")) received.push(d.slice(0, 900));
  });
  await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, PROJECT);
  await delay(1800);
  await page.keyboard.press("Digit1");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => (b.getAttribute("title") || "").includes("Dispatch RFQ")), { timeout: 10000 });
  const hit = await page.evaluate((ct) => {
    const buttons = [...document.querySelectorAll("button")].filter((b) => (b.getAttribute("title") || "").includes("Dispatch RFQ"));
    for (const b of buttons) {
      let node = b;
      for (let i = 0; i < 8 && node; i++) {
        if ((node.textContent || "").includes(ct)) {
          b.scrollIntoView({ block: "center" });
          const r = b.getBoundingClientRect();
          return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, cardText: (node.textContent || "").slice(0, 100) };
        }
        node = node.parentElement;
      }
    }
    return { ok: false };
  }, "QA9 Mechanical Insulation");
  result.data.hit = hit;
  sent.length = 0; received.length = 0;
  if (hit.ok) {
    await page.mouse.click(hit.x, hit.y);
    await delay(9000);
  }
  result.data.sentCount = sent.length;
  result.data.sent = sent.slice(0, 4);
  result.data.receivedCount = received.length;
  result.data.received = received.slice(0, 6);
  const after = await c.query("tradePackages:getPackage", { tradePackageId: pkg });
  result.data.statusAfter = after.status;
} catch (err) {
  result.crash = String(err?.message ?? err);
} finally {
  writeEvidence("j1h-estimator", result);
  await browser.close();
}
console.log("hit:", JSON.stringify(result.data.hit));
console.log("sent:", JSON.stringify(result.data.sent, null, 1).slice(0, 2000));
console.log("received:", JSON.stringify(result.data.received, null, 1).slice(0, 3000));
console.log("statusAfter:", result.data.statusAfter, result.crash ?? "");