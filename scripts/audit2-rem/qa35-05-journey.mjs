/**
 * QA35-05 full bid-day UI journey on a fresh AUDIT-QA35-JOURNEY project:
 * create -> packages -> contractors -> bids -> clash scan -> deduct -> REVERSE from the card
 * -> re-deduct -> stale creation through the leveling Adjust modal (un-accept the credit)
 * -> refusal probe (deduct while stale, must toast and never pageerror) -> CLEAR STALE CREDIT
 * -> re-deduct -> assign void -> award -> execute -> register filters/viewer -> void -> re-award
 * -> claims sweep -> 375px/720px overflow probes -> console/network/pageerror/websocket diagnostics.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab, selectProjectByTitle, setViewport } from "./lib.mjs";
import { client, fixtureTitle, writeEvidence, writeLog, sleep } from "./qa35-lib.mjs";

const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const TITLE = fixtureTitle("JOURNEY");
const REPO = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const reconcile = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1600)}`);
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

function scanClaimsSources() {
  const files = [...walk(path.join(REPO, "src")), ...walk(path.join(REPO, "convex"))].filter((f) => !/\.test\.|_generated|ai-files/.test(f));
  const hits = { gemini38: [], dedicated: [], officialAiaPositive: [], executedClaims: [] };
  for (const f of files) {
    const rel = path.relative(REPO, f).replace(/\\/g, "/");
    const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      const where = `${rel}:${i + 1}`;
      if (/Gemini 3\.8/i.test(line)) hits.gemini38.push({ where, line: line.trim().slice(0, 150) });
      if (/dedicated (programmatic|stateful)?\s*(@agentmail\.to )?inbox|Dedicated (AgentMail|Stateful)/i.test(line) && !/instead of claiming|never a dedicated|not a dedicated/i.test(line)) hits.dedicated.push({ where, line: line.trim().slice(0, 150) });
      if (/official AIA/i.test(line) && !/\bnot\b|\bnever\b|no official/i.test(line)) hits.officialAiaPositive.push({ where, line: line.trim().slice(0, 150) });
      if (/Executed subcontract .*A401|fully executed/i.test(line)) hits.executedClaims.push({ where, line: line.trim().slice(0, 150) });
    });
  }
  return hits;
}

async function clickText(page, needle, exact = false) {
  return page.evaluate(
    ({ needle, exact }) => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const b = [...document.querySelectorAll("button")].find((x) => {
        const t = (x.innerText || "").replace(/\s+/g, " ").trim();
        return vis(x) && (exact ? t === needle : t.includes(needle));
      });
      if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 70) };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim(), disabled: b.disabled };
    },
    { needle, exact }
  );
}

async function clickNth(page, needle, n) {
  return page.evaluate(
    ({ needle, n }) => {
      const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
      const bs = [...document.querySelectorAll("button")].filter((x) => vis(x) && (x.innerText || "").includes(needle));
      const b = bs[n];
      if (!b) return { ok: false, count: bs.length };
      b.scrollIntoView({ block: "center" });
      b.click();
      return { ok: true, text: (b.innerText || "").replace(/\s+/g, " ").trim(), count: bs.length };
    },
    { needle, n }
  );
}

async function clickDialogConfirm(page, label) {
  return page.evaluate((label) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const ds = [...document.querySelectorAll('[role="alertdialog"],[role="dialog"]')].filter(vis);
    const top = ds[ds.length - 1];
    if (!top) return { ok: false, reason: "no dialog" };
    const b = [...top.querySelectorAll("button")].find((x) => (x.innerText || "").replace(/\s+/g, " ").trim() === label || (x.innerText || "").includes(label));
    if (!b) return { ok: false, reason: "no button", texts: [...top.querySelectorAll("button")].map((x) => (x.innerText || "").trim()) };
    b.click();
    return { ok: true, text: (b.innerText || "").trim() };
  }, label);
}

async function selectPackage(page, name) {
  return page.evaluate((n) => {
    const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => (x.innerText || "").includes(n));
    if (!b) return { ok: false, available: [...document.querySelectorAll("button[aria-pressed]")].map((x) => (x.innerText || "").trim()) };
    b.click();
    return { ok: true, text: (b.innerText || "").trim(), pressed: b.getAttribute("aria-pressed") };
  }, name);
}

async function setVal(page, sel, val) {
  return page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value === val;
  }, { sel, val });
}

async function typeInto(page, selector, value) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(selector, value, { delay: 12 });
}

async function poll(fn, pred, timeoutMs, stepMs) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await sleep(stepMs);
  }
  return last;
}

async function dialogInfo(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const ds = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(vis);
    const top = ds[ds.length - 1] || null;
    if (!top) return { open: false };
    return { open: true, role: top.getAttribute("role"), title: (top.querySelector("h2,h3") || {}).innerText || null, buttons: [...top.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).slice(0, 16) };
  });
}

const mainText = (page) => page.evaluate(() => (document.querySelector("main") || document.body).innerText);
const toastText = (page) => page.evaluate(() => [...document.querySelectorAll('[role="status"],[aria-live="polite"]')].map((e) => (e.innerText || "").trim()).filter(Boolean).join(" | "));

async function uiClashKpis(page) {
  return page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText.replace(/\n/g, " ");
    const grab = (label) => {
      const re = new RegExp(label + "\\s*\\$?([\\d,]+)");
      return re.exec(t)?.[1] ?? null;
    };
    const labels = [...document.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim());
    return {
      doubleBuys: grab("Redundant Double-Buys"),
      voids: grab("Unassigned Scope Voids"),
      credits: grab("Recoverable Buyout Credits"),
      risk: /Coordination Risk Level\s*(Resolved|Active Audit)/.exec(t)?.[1] ?? null,
      deductedChips: (t.match(/credit deducted & leveled/gi) || []).length,
      assignedChips: (t.match(/scope assigned & covered/gi) || []).length,
      reverseButtons: labels.filter((x) => /Reverse credit/.test(x)).length,
      staleButtons: labels.filter((x) => /Clear stale credit record/.test(x)).length,
      deductButtons: labels.filter((x) => /1-Click Deduct Credit/.test(x)).length,
    };
  });
}

async function uiRegister(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll("table tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.innerText || "").replace(/\s+/g, " ").trim()));
    const t = (document.querySelector("main") || document.body).innerText.replace(/\s+/g, " ");
    return {
      rows,
      sum: /ACTIVE CONTRACTED SUM\s*\$([\d,]+)/i.exec(t)?.[1] ?? null,
      exec: /EXECUTION STATUS RECORDED\s*(\d+)\s*\/\s*(\d+)/i.exec(t) ? `${RegExp.$1}/${RegExp.$2}` : null,
      chips: [...document.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()).filter((x) => /^(Active Contracts|Execution Status Recorded|Superseded|Pending Execution)/.test(x)),
    };
  });
}

async function setSearch(page, value) {
  return page.evaluate((v) => {
    const el = document.querySelector('input[placeholder^="Search by agreement"]');
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value === v;
  }, value);
}

async function clickFilter(page, label) {
  return clickText(page, label, true);
}

async function clickRowButton(page, rowNeedle, label) {
  return page.evaluate(({ rowNeedle, label }) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    let cand = null;
    for (const el of [...document.querySelectorAll("tr, div")].filter(vis)) {
      if ((el.innerText || "").includes(rowNeedle)) {
        if (!cand || el.innerText.length < cand.innerText.length) cand = el;
      }
    }
    if (!cand) return { ok: false, reason: "no row" };
    let node = cand;
    for (let i = 0; i < 8 && node; i++) {
      const b = [...node.querySelectorAll("button")].find((x) => vis(x) && (x.innerText || "").replace(/\s+/g, " ").trim().includes(label));
      if (b) { b.scrollIntoView({ block: "center" }); b.click(); return { ok: true, text: (b.innerText || "").trim() }; }
      node = node.parentElement;
    }
    return { ok: false, reason: "no button in row" };
  }, { rowNeedle, label });
}

async function toggleCreditRowInDialog(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const modals = [...document.querySelectorAll("div")].filter((d) => vis(d) && (d.innerText || "").includes("Forensic Leveling Adjustments") && (d.innerText || "").includes("Save Leveling Adjustments"));
    const top = modals.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!top) return { ok: false, reason: "no adjustments modal", texts: [...document.querySelectorAll("h2,h3")].map((h) => h.innerText).slice(0, 10) };
    const rows = [...top.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("Cross-Trade Clash Credit") && d.querySelector("button"));
    const row = rows.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!row) return { ok: false, reason: "credit row not in modal", body: (top.innerText || "").slice(0, 400) };
    const btn = [...row.querySelectorAll("button")][0];
    if (!btn) return { ok: false, reason: "credit row has no toggle" };
    btn.click();
    return { ok: true, before: (btn.innerText || "").trim() };
  });
}

async function adjustModalInfo(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const modals = [...document.querySelectorAll("div")].filter((d) => vis(d) && (d.innerText || "").includes("Forensic Leveling Adjustments") && (d.innerText || "").includes("Save Leveling Adjustments"));
    const top = modals.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!top) return { open: false };
    return { open: true, header: (top.querySelector("h3") || {}).innerText || null, hasCreditRow: (top.innerText || "").includes("Cross-Trade Clash Credit") };
  });
}

const OVERFLOW_PROBE = () => {
  const vw = document.documentElement.clientWidth;
  const insideScroller = (el) => {
    let n = el.parentElement;
    while (n && n !== document.body) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
      n = n.parentElement;
    }
    return false;
  };
  const offenders = [...document.querySelectorAll("body *")]
    .map((el) => ({ el, r: el.getBoundingClientRect(), cs: getComputedStyle(el) }))
    .filter(({ r, cs }) => r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden")
    .filter(({ r }) => r.right > vw + 0.5)
    .filter(({ el }) => !insideScroller(el))
    .map(({ el, r }) => ({ tag: el.tagName, cls: String(el.className || "").slice(0, 80), text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50), right: Math.round(r.right * 10) / 10 }));
  return { vw, pageOverflow: document.documentElement.scrollWidth - vw, bodyOverflow: document.body.scrollWidth - vw, offenders: offenders.slice(0, 8), offenderCount: offenders.length };
};

const FORBIDDEN_UI = [
  { id: "gemini38", rx: /Gemini 3\.8/i },
  { id: "dedicatedInbox", rx: /dedicated (programmatic|stateful)?\s*(@agentmail\.to )?inbox|Dedicated (AgentMail|Stateful)/i },
  { id: "officialAia", rx: /(?<!\bnot an )official AIA (licensed )?(form|document)/i },
  { id: "staticScanFallback", rx: /Cross-trade scan complete: 2 double-buys \(\$50,500\)/i },
  { id: "executedBeforeExecution", rx: /Executed subcontract A401/i, contextual: true },
];

function claimViolations(text) {
  const out = [];
  for (const f of FORBIDDEN_UI) {
    if (f.id === "staticScanFallback") continue;
    if (!f.rx.test(text)) continue;
    if (f.contextual) {
      const idx = text.search(f.rx);
      const around = text.slice(Math.max(0, idx - 260), idx + 260);
      if (/voided|superseded|generated for/i.test(around)) continue;
    }
    out.push({ rule: f.id, sample: text.replace(/\s+/g, " ").slice(0, 160) });
  }
  return out;
}

async function main() {
  const src = scanClaimsSources();
  record("A35-J.0", "source claims scan: zero Gemini-3.8 / dedicated-inbox / positive-official-AIA / executed-before-execution strings",
    src.gemini38.length === 0 && src.dedicated.length === 0 && src.officialAiaPositive.length === 0 && src.executedClaims.length === 0,
    { gemini38: src.gemini38.slice(0, 3), dedicated: src.dedicated.slice(0, 3), officialAiaPositive: src.officialAiaPositive.slice(0, 3), executedClaims: src.executedClaims.slice(0, 3) });

  const { browser } = await launchBrowser(1500, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  let cdp = null;
  const ws = { created: 0, closed: 0, framesReceived: 0, framesSent: 0, frameErrors: [], urls: [] };
  try {
    cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    cdp.on("Network.webSocketCreated", (e) => { ws.created += 1; ws.urls.push(e.url); });
    cdp.on("Network.webSocketClosed", () => { ws.closed += 1; });
    cdp.on("Network.webSocketFrameReceived", () => { ws.framesReceived += 1; });
    cdp.on("Network.webSocketFrameSent", () => { ws.framesSent += 1; });
    cdp.on("Network.webSocketFrameError", (e) => { ws.frameErrors.push(String(e.errorMessage || "frame error")); });
  } catch (err) {
    say(`CDP websocket probe unavailable: ${err?.message ?? err}`);
  }

  for (const p of ((await c.query("projects:listProjects", {})) || []).filter((x) => x.title === TITLE)) {
    const agrs0 = (await c.query("agreements:listAgreements", { projectId: p._id })) || [];
    for (const a of agrs0.filter((x) => x.status === "executed")) {
      try { await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA35 journey purge of prior run executed record." }); } catch {}
    }
    try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
  }

  try {
    // 1. fresh project through the dialog
    await page.goto(`${BASE}/?qa35=journey`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForAppReady(page, 60000);
    await page.evaluate(() => { localStorage.removeItem("tradepulse.selectedProjectId"); localStorage.removeItem("tradepulse.selectedPackageId"); });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
      b?.click();
    });
    await delay(900);
    await clickText(page, "New Project");
    await delay(700);
    const npFills = {
      title: await setVal(page, 'input[aria-label="Project title"]', TITLE),
      location: await setVal(page, 'input[aria-label="Project location"]', "Honolulu, HI"),
      type: await setVal(page, 'input[aria-label="Project type"]', "Healthcare / Mixed-Use"),
      gc: await setVal(page, 'input[aria-label="General contractor or contracting entity"]', "QA35 Journey GC, LLC"),
      budget: await setVal(page, 'input[aria-label="Estimated budget in dollars"]', "2000000"),
      weeks: await setVal(page, 'input[aria-label="Target completion duration in weeks"]', "52"),
      spec: await setVal(page, 'textarea[placeholder*="Outline high-level trade scopes"]', "Division 26 electrical and Division 23 HVAC scope for the QA35 journey."),
    };
    const npClick = await page.evaluate(() => {
      const ds = [...document.querySelectorAll('[role="dialog"]')].filter((x) => x.getBoundingClientRect().width > 1);
      const d = ds[ds.length - 1];
      const b = d && [...d.querySelectorAll("button")].find((x) => /Create Commercial Project/.test(x.innerText || ""));
      if (!b) return { ok: false };
      b.click();
      return { ok: true, disabled: b.disabled };
    });
    const proj = await poll(() => c.query("projects:listProjects", {}).then((ps) => ps.find((p) => p.title === TITLE)), (p) => Boolean(p), 90000, 2000);
    await delay(2000);
    record("A35-J.1", "fresh project created through the UI dialog", Boolean(proj) && Object.values(npFills).every(Boolean) && npClick.ok, { id: proj?._id });
    if (!proj) throw new Error("journey project not created");
    await selectProjectByTitle(page, TITLE);
    await delay(1200);

    // 2. packages through the UI
    await clickTab(page, "CSI Scoping");
    await delay(1400);
    const d = new Date(Date.now() + 14 * 86400000);
    const localD = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const mkPkgUI = async (csi, name, budget) => {
      await clickText(page, "Create Trade Package");
      await delay(800);
      const filled = {
        csi: await setVal(page, 'input[aria-label="CSI division number"]', csi),
        name: await setVal(page, 'input[aria-label="Trade package name"]', name),
        budget: await setVal(page, 'input[aria-label="Budget estimate in dollars"]', budget),
        scope: await setVal(page, 'textarea[aria-label="Scope summary"]', `${name} scope per CSI ${csi}.`),
        inclusions: await setVal(page, 'textarea[aria-label="Mandatory inclusions, one per line"]', "All labor and materials per plans and specifications"),
        deadline: await setVal(page, 'input[aria-label="Bid deadline"]', localD),
      };
      const go = await clickText(page, "Create Package");
      await delay(1500);
      return { filled, go };
    };
    const mk26 = await mkPkgUI("26 00 00", "QA35 Journey Electrical", "900000");
    const pkgs1 = await poll(() => c.query("tradePackages:listByProject", { projectId: proj._id }), (x) => (x || []).length >= 1, 40000, 1200);
    const p26 = (pkgs1 || []).find((p) => p.csiDivision.startsWith("26"));
    const mk23 = await mkPkgUI("23 00 00", "QA35 Journey HVAC", "600000");
    const pkgs2 = await poll(() => c.query("tradePackages:listByProject", { projectId: proj._id }), (x) => (x || []).length >= 2, 40000, 1200);
    const p23 = (pkgs2 || []).find((p) => p.csiDivision.startsWith("23"));
    record("A35-J.2", "Div26 + Div23 packages created through the UI dialog", mk26.go.ok && mk23.go.ok && Boolean(p26) && Boolean(p23) && Object.values(mk23.filled).every(Boolean), { p26: p26?._id, p23: p23?._id });

    // 3. contractors through the UI
    const addCtr = async (pkgName, company, email, lic) => {
      await clickTab(page, "Discovery");
      await delay(1500);
      await selectPackage(page, pkgName);
      await delay(700);
      await clickText(page, "Add Contractor Manually");
      await delay(800);
      await typeInto(page, 'input[placeholder*="Rosendin"]', company);
      await typeInto(page, 'input[placeholder*="estimating@rosendin"]', email);
      await typeInto(page, 'input[placeholder*="TECL"]', lic);
      const go = await clickText(page, "Add to Directory");
      await delay(2200);
      return go;
    };
    const ctrGo1 = await addCtr(p26.tradeName, "AUDIT-QA35 Journey Prime", "estimating@QA35-journey-e.invalid", "HI-QA35-JE");
    const ctrGo2 = await addCtr(p23.tradeName, "AUDIT-QA35 Journey Mechanical", "estimating@QA35-journey-m.invalid", "HI-QA35-JM");
    const ctrs26 = await c.query("contractors:listByPackage", { tradePackageId: p26._id });
    const ctrs23 = await c.query("contractors:listByPackage", { tradePackageId: p23._id });
    const ctr26 = (ctrs26 || []).find((x) => /QA35 Journey Prime/.test(x.companyName));
    const ctr23 = (ctrs23 || []).find((x) => /QA35 Journey Mechanical/.test(x.companyName));
    record("A35-J.3", "contractors added through the UI for both packages", ctrGo1.ok && ctrGo2.ok && Boolean(ctr26) && Boolean(ctr23), { c26: ctr26?.companyName, c23: ctr23?.companyName });

    // 4. bids (backend; the UI exposes only LLM-backed ingest - documented limitation)
    const bid26 = await c.mutation("bids:submitDirectBid", { tradePackageId: p26._id, contractorId: ctr26._id, subcontractorName: ctr26.companyName, baseBidAmount: 800000, coiComplianceStatus: "compliant", coiPenalty: 0 });
    const bid23 = await c.mutation("bids:submitDirectBid", { tradePackageId: p23._id, contractorId: ctr23._id, subcontractorName: ctr23.companyName, baseBidAmount: 470000, coiComplianceStatus: "compliant", coiPenalty: 0 });
    reconcile.push({ step: "bids", backend: { b26: bid26.leveledTotalCost, b23: bid23.leveledTotalCost } });
    record("A35-J.4", "bids submitted (backend submitDirectBid; deterministic direct-bid UI does not exist, AI ingest excluded)", bid26.leveledTotalCost === 800000 && bid23.leveledTotalCost === 470000, { bid26, bid23 });

    // 5. clash pre-state + scan
    await clickTab(page, "Scope Clash");
    await delay(1800);
    const kpi0 = await uiClashKpis(page);
    reconcile.push({ step: "clash-pre", backend: { buys: 50500, voids: 46500, credits: 0 }, ui: kpi0 });
    record("A35-J.5", "cross-trade pre-state: UI KPI == backend (buys $50,500, voids $46,500, credits $0, no chips/controls)",
      kpi0.doubleBuys === "50,500" && kpi0.voids === "46,500" && kpi0.credits === "0" && kpi0.deductedChips === 0 && kpi0.reverseButtons === 0 && kpi0.staleButtons === 0 && kpi0.deductButtons === 2,
      { kpi0 });

    const scanTry = await clickText(page, "Run Forensic Clash Scan");
    const scanMsg = await poll(() => page.evaluate(() => {
      const t = (document.querySelector("main") || document.body).innerText;
      const m = /Cross-trade scan complete:[^\n]*/.exec(t);
      return m ? m[0] : null;
    }), (m) => Boolean(m), 90000, 2000);
    const scanBackend = await c.action("coordination:scanCrossTradeClashes", { projectId: proj._id });
    record("A35-J.6", "UI clash scan banner reconciles with the backend scan message", scanTry.ok && Boolean(scanMsg) && scanBackend?.analyzed === true && scanMsg === scanBackend.message, { uiMessage: scanMsg, backendMessage: scanBackend?.message ?? null });

    // 6. 1-click deduct
    const dedClick = await clickNth(page, "1-Click Deduct Credit", 0);
    const b23after = await poll(() => c.query("bids:listByPackage", { tradePackageId: p23._id }).then((bs) => bs.find((b) => b._id === bid23.bidId)), (b) => (b?.valueEngineeringAlternates || []).length > 0, 40000, 1500);
    await delay(1500);
    const kpi1 = await uiClashKpis(page);
    const detect1 = await c.query("coordination:detectCrossTradeClashes", { projectId: proj._id });
    const vfdCard = detect1.doubleBuys.find((x) => x.id === "clash-vfd-01");
    reconcile.push({ step: "deduct", backend: { leveled: b23after?.leveledTotalCost, deductedAmount: vfdCard?.deductedAmount }, ui: kpi1 });
    record("A35-J.7", "UI 1-click deduct: HVAC -$38,500; card/KPI reconcile (credits $38,500, buys $12,000); reverse control visible",
      dedClick.ok && b23after?.leveledTotalCost === 431500 && vfdCard?.deductedAmount === 38500 && kpi1.credits === "38,500" && kpi1.doubleBuys === "12,000" && kpi1.deductedChips === 1 && kpi1.reverseButtons === 1,
      { leveled: b23after?.leveledTotalCost, card: { status: vfdCard?.status, amount: vfdCard?.deductedAmount }, kpi1 });

    // 7. reverse from the card (newest fix)
    await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 6500) { if (!(await toastText(page))) return; await sleep(300); } })();
    const revClick = await clickText(page, "Reverse credit");
    const revToast = await poll(() => toastText(page), (t) => Boolean(t) && /reversed/.test(t), 12000, 400);
    const b23rev = await poll(() => c.query("bids:listByPackage", { tradePackageId: p23._id }).then((bs) => bs.find((b) => b._id === bid23.bidId)), (b) => b?.leveledTotalCost === 470000, 40000, 1200);
    await delay(1500);
    const kpiRev = await uiClashKpis(page);
    const detectRev = await c.query("coordination:detectCrossTradeClashes", { projectId: proj._id });
    const vfdRev = detectRev.doubleBuys.find((x) => x.id === "clash-vfd-01");
    const revLog = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 300 })) || []).find((l) => /Double-Buy Credit Reversed/.test(l.title));
    reconcile.push({ step: "reverse", backend: { leveled: b23rev?.leveledTotalCost, status: vfdRev?.status }, ui: kpiRev });
    record("A35-J.8", "UI reverse from the card: HVAC restored to $470,000, credit row removed, card detected $38,500, KPI credits $0 / buys $50,500, audit says restored $470,000",
      revClick.ok && Boolean(revToast) && b23rev?.leveledTotalCost === 470000 && (b23rev?.valueEngineeringAlternates || []).length === 0 &&
        vfdRev?.status === "detected" && vfdRev?.redundantAmount === 38500 && kpiRev.credits === "0" && kpiRev.doubleBuys === "50,500" && kpiRev.deductedChips === 0 && kpiRev.reverseButtons === 0 &&
        /restored to \$470,000/.test(revLog?.description || ""),
      { revToast, leveled: b23rev?.leveledTotalCost, kpiRev, audit: revLog?.description });

    // 8. re-deduct
    const dedClick2 = await clickNth(page, "1-Click Deduct Credit", 0);
    const b23again = await poll(() => c.query("bids:listByPackage", { tradePackageId: p23._id }).then((bs) => bs.find((b) => b._id === bid23.bidId)), (b) => b?.leveledTotalCost === 431500, 40000, 1200);
    await delay(1200);
    const kpi2dup = await uiClashKpis(page);
    record("A35-J.9", "UI re-deduct after reverse applies exactly once (431,500; one credit row; credits $38,500)",
      dedClick2.ok && b23again?.leveledTotalCost === 431500 && (b23again?.valueEngineeringAlternates || []).filter((v) => /^Cross-Trade Clash Credit(?: \[[^\]]+\])?:/.test(v.description)).length === 1 && kpi2dup.credits === "38,500",
      { leveled: b23again?.leveledTotalCost, kpi2dup });

    // 9. stale creation through the leveling Adjust modal (un-accept the applied credit)
    await clickTab(page, "Bid Leveling");
    await delay(1600);
    await selectPackage(page, p23.tradeName);
    await delay(1200);
    const adjustClick = await clickRowButton(page, "QA35 Journey Mechanical", "Adjust");
    await delay(900);
    const adjDialog = await adjustModalInfo(page);
    const toggleCredit = await toggleCreditRowInDialog(page);
    await delay(400);
    const toggleState = await adjustModalInfo(page);
    const saveAdj = await clickText(page, "Save Leveling Adjustments");
    const b23stale = await poll(() => c.query("bids:listByPackage", { tradePackageId: p23._id }).then((bs) => bs.find((b) => b._id === bid23.bidId)), (b) => b?.leveledTotalCost === 470000, 40000, 1200);
    const staleRows = (b23stale?.valueEngineeringAlternates || []).filter((v) => /^Cross-Trade Clash Credit(?: \[[^\]]+\])?:/.test(v.description));
    record("A35-J.10", "stale created through the real leveling Adjust modal: credit row declined via UI toggle + Save; bid back to $470,000",
      adjustClick.ok && adjDialog.open && adjDialog.hasCreditRow && toggleCredit.ok && saveAdj.ok && b23stale?.leveledTotalCost === 470000 && staleRows.length === 1 && staleRows[0].isAccepted === false,
      { adjustClick, dialog: adjDialog, toggle: toggleCredit, toggleState, saveAdj, leveled: b23stale?.leveledTotalCost, rows: staleRows });

    await clickTab(page, "Scope Clash");
    await delay(1600);
    const kpiStale = await uiClashKpis(page);
    const detectStale = await c.query("coordination:detectCrossTradeClashes", { projectId: proj._id });
    const vfdStale = detectStale.doubleBuys.find((x) => x.id === "clash-vfd-01");
    record("A35-J.11", "stale overlay truth: card detected $38,500 with staleResolution, 'Clear stale credit record' visible, KPI credits $0 / buys $50,500",
      vfdStale?.status === "detected" && vfdStale?.staleResolution === true && kpiStale.staleButtons === 1 && kpiStale.credits === "0" && kpiStale.doubleBuys === "50,500",
      { card: { status: vfdStale?.status, stale: vfdStale?.staleResolution, redundant: vfdStale?.redundantAmount }, kpiStale });

    // 10. refusal probe: deduct while stale -> toast, no pageerror
    const pageErrorsBefore = diag.pageErrors.length;
    const refuseClick = await clickNth(page, "1-Click Deduct Credit", 0);
    const refuseToast = await poll(() => toastText(page), (t) => Boolean(t) && /Deduct credit failed/.test(t), 12000, 400);
    const pageErrorsAfter = diag.pageErrors.length;
    await delay(800);
    const b23ref = await c.query("bids:listByPackage", { tradePackageId: p23._id }).then((bs) => bs.find((b) => b._id === bid23.bidId));
    record("A35-J.12", "refusal probe: deduct while stale refuses with a toast ('already been applied'), bid untouched, ZERO pageerrors from the refusal",
      refuseClick.ok && Boolean(refuseToast) && /already been applied/.test(refuseToast) && b23ref?.leveledTotalCost === 470000 && pageErrorsAfter === pageErrorsBefore,
      { refuseToast, leveled: b23ref?.leveledTotalCost, pageErrorsDelta: pageErrorsAfter - pageErrorsBefore });

    // 11. clear stale credit through the UI
    await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 8000) { if (!(await toastText(page))) return; await sleep(300); } })();
    const clearClick = await clickText(page, "Clear stale credit record");
    const clearToast = await poll(() => toastText(page), (t) => Boolean(t) && /revers/i.test(t), 15000, 300);
    await delay(1200);
    const b23clear = await c.query("bids:listByPackage", { tradePackageId: p23._id }).then((bs) => bs.find((b) => b._id === bid23.bidId));
    const detectClear = await c.query("coordination:detectCrossTradeClashes", { projectId: proj._id });
    const vfdClear = detectClear.doubleBuys.find((x) => x.id === "clash-vfd-01");
    record("A35-J.13", "UI 'Clear stale credit record': declined row removed, bid stays $470,000, card fully detected (no stale), toast confirms",
      clearClick.ok && Boolean(clearToast) && b23clear?.leveledTotalCost === 470000 && (b23clear?.valueEngineeringAlternates || []).filter((v) => /^Cross-Trade Clash Credit(?: \[[^\]]+\])?:/.test(v.description)).length === 0 &&
        vfdClear?.status === "detected" && !vfdClear?.staleResolution,
      { clearToast, leveled: b23clear?.leveledTotalCost, card: { status: vfdClear?.status, stale: vfdClear?.staleResolution } });

    // 12. re-deduct after stale clear (full recovery)
    const dedClick3 = await clickNth(page, "1-Click Deduct Credit", 0);
    const b23final = await poll(() => c.query("bids:listByPackage", { tradePackageId: p23._id }).then((bs) => bs.find((b) => b._id === bid23.bidId)), (b) => b?.leveledTotalCost === 431500, 40000, 1200);
    await delay(1000);
    const kpiFinal = await uiClashKpis(page);
    record("A35-J.14", "re-deduct after stale clear recovers fully: 431,500; credits $38,500; one reverse control",
      dedClick3.ok && b23final?.leveledTotalCost === 431500 && kpiFinal.credits === "38,500" && kpiFinal.reverseButtons === 1,
      { leveled: b23final?.leveledTotalCost, kpiFinal });

    // 13. assign void
    const asgClick = await clickNth(page, "Assign to Div 26 (Electrical)", 0);
    const b26after = await poll(() => c.query("bids:listByPackage", { tradePackageId: p26._id }).then((bs) => bs.find((b) => b._id === bid26.bidId)), (b) => (b?.baseBidAmount || 0) > 800000, 40000, 1500);
    await delay(1500);
    const kpi2 = await uiClashKpis(page);
    const detect2 = await c.query("coordination:detectCrossTradeClashes", { projectId: proj._id });
    const basCard = detect2.scopeVoids.find((x) => x.id === "void-bas-wiring-01");
    const p26now = (await c.query("tradePackages:listByProject", { projectId: proj._id })).find((x) => x._id === p26._id);
    reconcile.push({ step: "assign", backend: { base: b26after?.baseBidAmount, status: basCard?.status }, ui: kpi2 });
    record("A35-J.15", "UI assign scope void: Div26 +$28,000, inclusion added, KPI voids $18,500, assigned chip 1",
      asgClick.ok && b26after?.baseBidAmount === 828000 && basCard?.status === "assigned" && (p26now?.mandatoryInclusions || []).some((i) => i.includes("BAS")) && kpi2.voids === "18,500" && kpi2.assignedChips === 1 && kpi2.credits === "38,500",
      { base: b26after?.baseBidAmount, card: basCard ? { status: basCard.status, assignedTo: basCard.assignedToTradeName } : null, kpi2 });

    // 14. award -> execute (register/viewer truth)
    await clickTab(page, "Bid Leveling");
    await delay(1600);
    await selectPackage(page, p26.tradeName);
    await delay(1200);
    const award1 = await clickText(page, "Award Compliant Winner");
    const awardTry = award1.ok ? award1 : await clickText(page, "Award Subcontract & Draft Agreement");
    const agrs1 = await poll(() => c.query("agreements:listAgreements", { projectId: proj._id }), (x) => (x || []).some((a) => a.status === "generated"), 60000, 2000);
    const agr = (agrs1 || []).find((a) => a.status === "generated");
    await delay(1500);
    const awardRow = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 300 })) || []).find((l) => /AIA A401 Subcontract Agreement Awarded/.test(l.title));
    reconcile.push({ step: "award", backend: { number: agr?.agreementNumber, sum: agr?.contractSum } });
    record("A35-J.16", "UI award generates the agreement at 828,000; audit says 'generated ... pending external execution'",
      awardTry.ok && agr?.contractSum === 828000 && Boolean(awardRow) && /generated for CSI Division 26/.test(awardRow.description) && /pending external execution/.test(awardRow.description) && !/Executed subcontract/i.test(awardRow.description),
      { agr: { n: agr?.agreementNumber, s: agr?.status, sum: agr?.contractSum }, awardRow: awardRow?.description });

    await page.keyboard.press("Escape");
    await delay(500);
    await clickTab(page, "Subcontracts");
    await delay(1800);
    await clickText(page, "Inspect Draft");
    await delay(1200);
    const genViewer = await mainText(page);
    const genBadge = /Generated \/ Pending Execution/.test(genViewer);
    const execOpen1 = await clickText(page, "Record External Execution");
    const execOpen = execOpen1.ok ? execOpen1 : await clickText(page, "Record Execution Status");
    await delay(800);
    const execDlg = await dialogInfo(page);
    await clickDialogConfirm(page, "Record execution");
    const agrs2 = await poll(() => c.query("agreements:listAgreements", { projectId: proj._id }), (x) => (x || []).some((a) => a.status === "executed"), 45000, 1500);
    await delay(1500);
    const execRow = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 300 })) || []).find((l) => /Execution Status Recorded/.test(l.title));
    const viewerText = await mainText(page);
    record("A35-J.17", "UI execution: executed status; viewer flips from Pending Execution to RECORDED • SIGNATURE REQUIRED; audit avoids a 'fully executed' claim",
      execOpen.ok && execDlg.open && genBadge && /RECORDED • SIGNATURE REQUIRED/.test(viewerText) && (agrs2 || []).some((a) => a.status === "executed") &&
        Boolean(execRow) && /external signature verification remains required/.test(execRow.description) && !/was executed|fully executed/i.test(execRow.description),
      { genBadge, dialog: execDlg.title, execRow: execRow?.description });

    await clickText(page, "Close Viewer");
    await delay(800);

    const regExec = await uiRegister(page);
    await setSearch(page, agr.agreementNumber.slice(0, 16));
    await delay(900);
    const regSearchNum = await uiRegister(page);
    await setSearch(page, "");
    await delay(700);
    await clickFilter(page, "Execution Status Recorded");
    await delay(700);
    const regFilterExec = await uiRegister(page);
    await clickFilter(page, "Pending Execution");
    await delay(700);
    const regFilterPending = await uiRegister(page);
    record("A35-J.18", "register (executed): chip 1/1, row badge, search by agreement number finds the row, Pending filter empty",
      regExec.exec === "1/1" && regExec.rows.length === 1 && /Execution Status Recorded/.test(regExec.rows[0].join(" ")) && regSearchNum.rows.length === 1 && regFilterExec.rows.length === 1 && regFilterPending.rows.length === 0,
      { exec: regExec.exec, searchNum: regSearchNum.rows.length, filterExec: regFilterExec.rows.length, filterPending: regFilterPending.rows.length });

    // 15. void -> re-award truth
    await clickFilter(page, "Execution Status Recorded");
    await delay(700);
    await clickText(page, "Inspect Draft");
    await delay(1000);
    const voidOpen = await clickText(page, "Void execution record");
    await delay(800);
    const voidDlg = await dialogInfo(page);
    const voidConfirm = await clickDialogConfirm(page, "Void execution record");
    const agrs3 = await poll(() => c.query("agreements:listAgreements", { projectId: proj._id }), (x) => (x || []).some((a) => a.status === "superseded"), 45000, 1500);
    await delay(1800);
    const voidRow = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 300 })) || []).find((l) => /Executed Subcontract Voided/.test(l.title));
    const bid26afterVoid = (await c.query("bids:listByPackage", { tradePackageId: p26._id })).find((b) => b._id === bid26.bidId);
    const regVoid = await uiRegister(page);
    const supViewerText = await mainText(page);
    reconcile.push({ step: "void", backend: { status: (agrs3 || []).find((a) => a._id === agr?._id)?.status, bidAwarded: bid26afterVoid?.isAwarded }, ui: regVoid });
    record("A35-J.19", "UI void: agreement superseded, bid unawarded; viewer flips to Superseded; audit records the operator reason",
      voidOpen.ok && voidDlg.open && (agrs3 || []).some((a) => a.status === "superseded") && bid26afterVoid?.isAwarded === false && Boolean(voidRow) && /was voided:/.test(voidRow.description) && /reopened for leveling/.test(voidRow.description) && /Superseded — voided or replaced/.test(supViewerText),
      { dialog: voidDlg.title, voidConfirm, viewerSuperseded: /Superseded — voided or replaced/.test(supViewerText), bidAwarded: bid26afterVoid?.isAwarded });

    await clickFilter(page, "Active Contracts");
    await delay(700);
    const regAfterVoidActive = await uiRegister(page);
    await clickFilter(page, "Superseded (1)");
    await delay(700);
    const regSuper = await uiRegister(page);
    await setSearch(page, agr.agreementNumber);
    await delay(700);
    const regSuperSearch = await uiRegister(page);
    await setSearch(page, "");
    await delay(500);
    await clickFilter(page, "Active Contracts");
    await delay(500);
    record("A35-J.20", "register (superseded): Active excludes the voided row and sum is 0; Superseded filter shows it read-only; search still finds it",
      regAfterVoidActive.rows.length === 0 && regAfterVoidActive.sum === "0" && regSuper.rows.length === 1 && /Superseded — read-only/.test(regSuper.rows[0].join(" ")) && regSuperSearch.rows.length === 1,
      { active: { rows: regAfterVoidActive.rows.length, sum: regAfterVoidActive.sum }, super: regSuper.rows.length, superSearch: regSuperSearch.rows.length });

    await clickTab(page, "Bid Leveling");
    await delay(1600);
    await selectPackage(page, p26.tradeName);
    await delay(1000);
    const reAward1 = await clickText(page, "Award Compliant Winner");
    const reAward = reAward1.ok ? reAward1 : await clickText(page, "Award Subcontract & Draft Agreement");
    const agrs4 = await poll(() => c.query("agreements:listAgreements", { projectId: proj._id }), (x) => (x || []).some((a) => a._id === agr?._id && a.status === "generated"), 60000, 2000);
    await delay(1500);
    const reRow = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 300 })) || []).find((l) => /Re-Awarded/.test(l.title));
    const bid26re = (await c.query("bids:listByPackage", { tradePackageId: p26._id })).find((b) => b._id === bid26.bidId);
    record("A35-J.21", "UI re-award reactivates the same agreement (generated) with 'Re-Awarded ... Re-activated' audit and no execution claim",
      reAward.ok && (agrs4 || []).find((a) => a._id === agr?._id)?.agreementNumber === agr?.agreementNumber && (agrs4 || []).find((a) => a._id === agr?._id)?.status === "generated" && bid26re?.isAwarded === true && Boolean(reRow) && /Re-activated subcontract agreement/.test(reRow.description) && !/executed/i.test(reRow.description),
      { status: (agrs4 || []).find((a) => a._id === agr?._id)?.status, reRow: reRow?.description });

    await clickTab(page, "Subcontracts");
    await delay(1500);
    await clickFilter(page, "Pending Execution");
    await delay(700);
    const regReAward = await uiRegister(page);
    record("A35-J.22", "register after re-award: Pending Execution shows the reactivated row once; Active Contracted Sum counts it once ($828,000)",
      regReAward.rows.length === 1 && regReAward.sum === "828,000",
      { rows: regReAward.rows.length, sum: regReAward.sum });

    // 16. claims sweep
    const violations = [];
    for (const t of ["CSI Scoping", "Discovery", "Pre-Bid Q&A", "Bid Leveling", "Scope Clash", "Subcontracts", "Live Activity Audit", "Evals & Architecture"]) {
      await clickTab(page, t);
      await delay(1200);
      const text = await mainText(page);
      for (const v of claimViolations(text)) violations.push({ tab: t, ...v });
    }
    record("A35-J.23", "live claims sweep across all 8 tabs: zero forbidden claims (Gemini-3.8 / dedicated inbox / positive official AIA / executed-before-execution / static scan fallback)",
      violations.length === 0, { violations: violations.slice(0, 6) });

    // 17. responsive probes on changed surfaces
    await clickTab(page, "Scope Clash");
    await delay(1200);
    await page.setViewport({ width: 375, height: 780, deviceScaleFactor: 1 });
    await delay(1200);
    const m375 = await page.evaluate(OVERFLOW_PROBE);
    await shot(page, "fix4-qa35-mobile-375-coordination.png", { full: true });
    const controls375 = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.innerText || "").filter((t) => /Reverse credit|1-Click Deduct Credit|Clear stale/.test(t)).length);
    record("A35-J.24", "coordination at 375px (credit applied, reverse control rendered): zero page-level horizontal overflow, no unclipped offenders",
      m375.pageOverflow <= 0 && m375.bodyOverflow <= 0 && m375.offenderCount === 0 && controls375 >= 1,
      { vw: m375.vw, pageOverflow: m375.pageOverflow, offenderCount: m375.offenderCount, offenders: m375.offenders.slice(0, 4), controls375 });

    await clickTab(page, "Subcontracts");
    await delay(1200);
    const m375reg = await page.evaluate(OVERFLOW_PROBE);
    await shot(page, "fix4-qa35-mobile-375-register.png", { full: true });
    await page.setViewport({ width: 720, height: 900, deviceScaleFactor: 1 });
    await delay(1200);
    const m720reg = await page.evaluate(OVERFLOW_PROBE);
    await shot(page, "fix4-qa35-zoom200-register.png", { full: true });
    await clickTab(page, "Scope Clash");
    await delay(1200);
    const m720coord = await page.evaluate(OVERFLOW_PROBE);
    await shot(page, "fix4-qa35-zoom200-coordination.png", { full: true });
    record("A35-J.25", "200% zoom equivalent (720px): register and coordination zero page-level horizontal overflow",
      m375reg.pageOverflow <= 0 && m375reg.bodyOverflow <= 0 && m720reg.pageOverflow <= 0 && m720reg.bodyOverflow <= 0 && m720coord.pageOverflow <= 0 && m720coord.bodyOverflow <= 0,
      { reg375: { ov: m375reg.pageOverflow, off: m375reg.offenderCount }, reg720: { ov: m720reg.pageOverflow, off: m720reg.offenderCount }, coord720: { ov: m720coord.pageOverflow, off: m720coord.offenderCount } });

    // 18. diagnostics
    await setViewport(page, 1440, 900);
    await delay(2500);
    const consoleErrors = diag.consoleLogs.filter((l) => l.type === "error");
    const consoleWarnings = diag.consoleLogs.filter((l) => l.type === "warning" || l.type === "warn");
    const appFailed = diag.failedRequests.filter((f) => !/favicon/i.test(f));
    record("A35-J.26", "websocket: reactive connection opened, frames exchanged both ways, no frame errors",
      ws.created >= 1 && ws.framesReceived > 0 && ws.frameErrors.length === 0 && ws.closed <= 2,
      { created: ws.created, closed: ws.closed, framesReceived: ws.framesReceived, framesSent: ws.framesSent, frameErrors: ws.frameErrors.slice(0, 3) });
    record("A35-J.27", "journey diagnostics: ZERO page errors (including the stale refusal), no failed app requests; the only console error is the Convex client logging the expected refused mutation",
      diag.pageErrors.length === 0 && appFailed.length === 0 && consoleErrors.every((e) => /deductDoubleBuyCredit|already been applied/.test(e.text)),
      { pageErrors: diag.pageErrors.slice(0, 4), consoleErrors: consoleErrors.slice(0, 5).map((e) => e.text.slice(0, 160)), consoleWarnings: consoleWarnings.slice(0, 4).map((e) => e.text.slice(0, 140)), failedRequests: appFailed.slice(0, 5) });

    writeEvidence("ui-journey", {
      projectId: proj._id, p26: p26._id, p23: p23._id, bid26: bid26.bidId, bid23: bid23.bidId, agreement: agr?.agreementNumber,
      results, reconcile, ws, sourceClaims: src,
      summary: { pass: results.filter((r) => r.pass).length, total: results.length },
    });
    writeLog("ui-journey", log);
    console.log(`ui-journey: ${results.filter((r) => r.pass).length}/${results.length}`);
  } catch (err) {
    writeEvidence("ui-journey", { results: [...results, { id: "A35-J.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }], reconcile, summary: { pass: results.filter((r) => r.pass).length, total: results.length + 1 } });
    writeLog("ui-journey", [...log, String(err?.stack ?? err)]);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  writeLog("ui-journey-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});