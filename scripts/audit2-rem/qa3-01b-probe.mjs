import { launchBrowser, attachDiagnostics, waitForAppReady, selectProjectByTitle, shot, writeJson, delay } from "./lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 1400);
  const page = await browser.newPage();
  attachDiagnostics(page);
  const out = {};
  await page.goto(process.env.REM_BASE_URL || "https://brainy-skunk-440.convex.site", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await selectProjectByTitle(page, "Domain Tower B");
  await delay(1200);
  out.mainCount = await page.evaluate(() => document.querySelectorAll("main").length);
  out.mainHead = await page.evaluate(() => (document.querySelector("main")?.innerText || "").slice(0, 200));
  // click expand
  out.expand = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Expand 6-Card KPI View"));
    if (!b) return "no-expand-button";
    b.click(); return "clicked";
  });
  await delay(800);
  out.kpiContainers = await page.evaluate(() => {
    const cands = [...document.querySelectorAll("div")].filter((d) => (d.textContent || "").includes("Commercial Procurement Financial Baseline"));
    return cands.map((d) => ({ cls: (d.className || "").toString().slice(0, 80), len: (d.textContent || "").length, text: (d.innerText || "").replace(/\s+/g, " ").slice(0, 400) })).slice(-3);
  });
  out.expandedGrid = await page.evaluate(() => {
    const cands = [...document.querySelectorAll("div")].filter((d) => (d.textContent || "").includes("Subcontract Awards") && (d.textContent || "").includes("Leveled Buyout"));
    if (!cands.length) return null;
    const el = cands.reduce((a, b) => ((a.textContent || "").length <= (b.textContent || "").length ? a : b));
    return (el.innerText || "").replace(/\s+/g, " ");
  });
  await shot(page, "fix4-qa3-01b-expanded.png");

  // contracts tab
  out.clickContracts = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Subcontracts") && !(x.getAttribute("title") || "").includes("Demo"));
    if (!b) return { ok: false };
    const t = (b.textContent || "").trim();
    b.click();
    return { ok: true, text: t, title: b.getAttribute("title") };
  });
  await delay(1500);
  out.contractsText = await page.evaluate(() => {
    const t = document.body.innerText;
    const i = t.indexOf("Active Contracted Sum");
    return i >= 0 ? t.slice(Math.max(0, i - 120), i + 200).replace(/\s+/g, " ") : "NOT FOUND";
  });
  await shot(page, "fix4-qa3-01b-contracts.png");

  // tour
  out.tourOpen = await page.evaluate(() => document.body.innerText.includes("Investor Demo Tour"));
  if (!out.tourOpen) {
    out.tourClick = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Demo Tour"));
      if (!b) return "no-tour-button";
      b.click(); return "clicked";
    });
    await delay(1000);
  }
  out.scene04 = await page.evaluate(async () => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:"));
    if (!b) return "no-04";
    b.click();
    return "clicked04";
  });
  await delay(700);
  out.tourText4 = await page.evaluate(() => {
    const t = document.body.innerText;
    const i = t.indexOf("Scene 04");
    return i >= 0 ? t.slice(i, i + 700).replace(/\s+/g, " ") : "NOT FOUND";
  });
  await shot(page, "fix4-qa3-01b-tour04.png");
  out.scene06 = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("06:"));
    if (!b) return "no-06";
    b.click();
    return "clicked06";
  });
  await delay(700);
  out.tourText6 = await page.evaluate(() => {
    const t = document.body.innerText;
    const i = t.indexOf("Scene 06");
    return i >= 0 ? t.slice(i, i + 700).replace(/\s+/g, " ") : "NOT FOUND";
  });
  await shot(page, "fix4-qa3-01b-tour06.png");
  writeJson("fix4-qa3-01b-probe.json", out);
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
};
run().catch((e) => { console.error(e); process.exit(1); });