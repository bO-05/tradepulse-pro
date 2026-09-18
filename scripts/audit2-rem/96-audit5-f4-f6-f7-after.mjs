import { setTimeout as delay } from "node:timers/promises";
import { launchBrowser, waitForAppReady, shot, writeJson } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const R = { startedAt: new Date().toISOString() };
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");
const FIXTURE = "AUDIT-5-F3-BEFORE-2026-09-18";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const closeTour = async () => {
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
  };
  const clickTab = async (prefix) => {
    await page.evaluate((p) => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(p)); b?.click(); }, prefix);
    await delay(900);
  };
  const selectProject = async (needle) => {
    await page.evaluate((n) => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      const o = [...s.options].find((x) => x.textContent.includes(n));
      s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true }));
    }, needle);
    await delay(1800);
  };
  try {
    const projects = await http.query("projects:listProjects", {});
    const fixtureProject = projects.find((p) => p.title.includes(FIXTURE));
    const pkgs = await http.query("tradePackages:listByProject", { projectId: fixtureProject._id });
    const div26 = pkgs.find((p) => p.csiDivision.startsWith("26"));
    const div22 = pkgs.find((p) => p.csiDivision.startsWith("22"));
    const div26Before = (await http.query("rfq:listConversations", { tradePackageId: div26._id })).length;
    const div22Before = (await http.query("rfq:listConversations", { tradePackageId: div22._id })).length;

    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await closeTour();
    await page.evaluate((pid) => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      s.value = pid; s.dispatchEvent(new Event("change", { bubbles: true }));
    }, fixtureProject._id);
    await delay(1600);

    // ---------- F4 label + behavior
    await clickTab("04:");
    R.f4 = {
      oldLabelPresent: await page.evaluate(() => document.body.innerText.includes("Simulate Inbound Bid…")),
      newLabelPresent: await page.evaluate(() => document.body.innerText.includes("Open Demo Simulation…")),
    };
    const simBox = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Open Demo Simulation"));
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, title: b.getAttribute("title") };
    });
    R.f4.title = simBox.title;
    await page.mouse.click(simBox.x, simBox.y);
    await delay(900);
    R.f4.dockOpen = await page.evaluate(() => document.body.innerText.includes("60-Second Executive Demo & Simulation Engine"));
    await shot(page, "fix4-after-F4-renamed-control.png");
    await page.keyboard.press("Escape");
    await delay(500);

    // ---------- F6 selector + routing
    await clickTab("03:");
    await delay(800);
    R.f6 = {
      selectorOptions: await page.evaluate(() => {
        const sel = document.querySelector("#rfi-trade-package");
        return sel ? [...sel.options].map((o) => o.textContent.trim()) : null;
      }),
    };
    // choose the Div 22 option through the native select
    await page.select("#rfi-trade-package", div22._id);
    await delay(500);
    R.f6.routingLine = await page.evaluate(() => (document.body.innerText.match(/Routing to:[^\n]*/) || [])[0] || null);
    R.f6.contractorForcedGuest = await page.evaluate(() => {
      const form = [...document.querySelectorAll("form")].slice(-1)[0];
      const selects = [...form.querySelectorAll("select")];
      const contractor = selects.find((s) => s !== document.querySelector("#rfi-trade-package"));
      return { disabled: contractor?.disabled, value: contractor?.value };
    });
    const boxes = await page.evaluate(() => {
      const form = [...document.querySelectorAll("form")].slice(-1)[0];
      const i = form.querySelector('input[type="text"]');
      const ta = form.querySelector("textarea");
      i.scrollIntoView({ block: "center" });
      const ri = i.getBoundingClientRect(); const rt = ta.getBoundingClientRect();
      return { i: { x: ri.left + ri.width / 2, y: ri.top + ri.height / 2 }, t: { x: rt.left + rt.width / 2, y: rt.top + rt.height / 2 } };
    });
    await page.mouse.click(boxes.i.x, boxes.i.y);
    await page.keyboard.type("AUDIT F6 medical gas routed question", { delay: 5 });
    await page.mouse.click(boxes.t.x, boxes.t.y);
    await page.keyboard.type("Does Division 22 plumbing carry third-party medical gas certification for this project?", { delay: 3 });
    await shot(page, "fix4-after-F6-routing-selected.png");
    await page.evaluate(() => { const b = [...document.querySelectorAll("form")].slice(-1)[0].querySelector('button[type="submit"]'); b.scrollIntoView({ block: "center" }); b.click(); });
    let routed = null;
    for (let i = 0; i < 90; i++) {
      await delay(2000);
      const convos22 = await http.query("rfq:listConversations", { tradePackageId: div22._id });
      routed = convos22.find((c) => c.inboundSubject.includes("F6 medical gas routed"));
      if (routed && routed.status !== "pending_analysis") break;
    }
    const div26After = (await http.query("rfq:listConversations", { tradePackageId: div26._id })).length;
    const div22After = (await http.query("rfq:listConversations", { tradePackageId: div22._id })).length;
    R.f6.storedOnDiv22 = Boolean(routed);
    R.f6.storedPackageId = routed?.tradePackageId || null;
    R.f6.expectedPackageId = div22._id;
    R.f6.div26Counts = { before: div26Before, after: div26After };
    R.f6.div22Counts = { before: div22Before, after: div22After };
    await shot(page, "fix4-after-F6-routed-result.png");

    // ---------- F7 contrast on demo
    await selectProject("The Domain Tower B");
    await clickTab("03:");
    await delay(900);
    R.f7 = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => /Review PM Queue/.test(b.textContent || ""));
      if (!btn) return { found: false };
      const cs = getComputedStyle(btn);
      const parse = (c) => { const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const fg = parse(cs.color); const bg = parse(cs.backgroundColor);
      let ratio = null;
      if (fg && bg) { const L1 = lum(fg); const L2 = lum(bg); ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); }
      return { found: true, text: btn.textContent.trim(), fontSize: cs.fontSize, color: cs.color, bg: cs.backgroundColor, ratio: ratio ? +ratio.toFixed(2) : null };
    });
    await shot(page, "fix4-after-F7-contrast.png");
    writeJson("fix4-after-f4-f6-f7.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-after-f4-f6-f7.json", R);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 10000));
};
run();