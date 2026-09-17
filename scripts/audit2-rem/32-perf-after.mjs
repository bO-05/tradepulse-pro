import { launchBrowser, attachDiagnostics, waitForAppReady, writeJson, delay } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const out = { url: "https://brainy-skunk-440.convex.site", measuredAt: new Date().toISOString() };
  const client = await page.target().createCDPSession();
  await client.send("Network.enable");
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  const resources = [];
  page.on("response", async (r) => {
    try {
      const headers = r.headers();
      resources.push({ url: r.url(), status: r.status(), type: headers["content-type"], len: headers["content-length"] ? Number(headers["content-length"]) : null });
    } catch { /* ignore */ }
  });
  await page.goto(out.url, { waitUntil: "load", timeout: 60000 });
  await delay(800);
  out.timing = await page.evaluate(() => {
    const t = performance.getEntriesByType("navigation")[0];
    const paints = performance.getEntriesByType("paint");
    const fcp = paints.find((p) => p.name === "first-contentful-paint");
    return {
      ttfb: Math.round(t.responseStart - t.requestStart),
      domContentLoaded: Math.round(t.domContentLoadedEventEnd),
      load: Math.round(t.loadEventEnd),
      fcp: fcp ? Math.round(fcp.startTime) : null,
    };
  });
  out.resourceCount = resources.filter((r) => r.url.startsWith(out.url)).length;
  out.resources = resources.filter((r) => r.url.startsWith(out.url)).map((r) => ({ url: r.url.replace(out.url, ""), status: r.status, kb: r.len ? Math.round(r.len / 1024) : null }));
  out.domNodes = await page.evaluate(() => document.querySelectorAll("*").length);
  await waitForAppReady(page);
  out.domNodesAfterLoad = await page.evaluate(() => document.querySelectorAll("*").length);
  out.consoleErrors = diag.consoleLogs.filter((l) => l.type === "error").length;
  out.pageErrors = diag.pageErrors.length;
  out.failedRequests = diag.failedRequests.length;
  out.websockets = await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => r.name.includes("convex.cloud")).length);
  writeJson("fix-perf-after.json", out);
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
};
run();