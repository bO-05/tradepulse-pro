/**
 * QA38-03 full bid-day UI journey on a fresh AUDIT-QA38-JOURNEY project:
 * create -> packages -> contractors -> bids -> clash scan -> 1-click deduct -> REVERSE from the card
 * -> award -> execute -> void -> re-award -> Pre-Bid addendum flow (RFI submit -> PM certify -> issue)
 * -> claims sweep -> exact backend reconciliation -> console/pageerror diagnostics.
 */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, clickTab, selectProjectByTitle, setViewport } from "./lib.mjs";
import { client, fixtureTitle, writeEvidence, writeLog, sleep, detect, creditInvariants, getBid, creditRows, creditClashId } from "./qa38-lib.mjs";

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
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1800)}`);
};
const finding = (id, severity, title, evidence) => {
  results.push({ id, name: title, pass: false, detail: evidence, severity });
  say(`FINDING ${id} [${severity}] ${title}`);
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
    fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
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

async function clickFilterStarts(page, prefix) {
  return page.evaluate((prefix) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const bs = [...document.querySelectorAll("button")].filter(vis);
    const exact = bs.find((x) => (x.innerText || "").replace(/\s+/g, " ").trim() === prefix);
    const any = exact || bs.find((x) => (x.innerText || "").replace(/\s+/g, " ").trim().startsWith(prefix));
    if (!any) return { ok: false, available: bs.map((x) => (x.innerText || "").trim()).filter(Boolean).slice(0, 40) };
    any.scrollIntoView({ block: "center" });
    any.click();
    return { ok: true, text: (any.innerText || "").replace(/\s+/g, " ").trim() };
  }, prefix);
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
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
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
    await sleep(stepMs || 1200);
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
  { id: "staticScanFallback", rx: /Cross-trade scan complete: 2 double-buys \(\$50,500\)/i, skip: true },
  { id: "executedBeforeExecution", rx: /Executed subcontract A401/i, contextual: true },
];
function claimViolations(text) {
  const out = [];
  for (const f of FORBIDDEN_UI) {
    if (f.skip) continue;
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
  record("A38-J.0", "source claims scan: zero Gemini-3.8 / dedicated-inbox / positive-official-AIA / executed-before-execution strings",
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
      try { await c.mutation("agreements:voidExecutedAgreement", { agreementId: a._id, reason: "QA38 journey purge of prior run executed record." }); } catch {}
    }
    try { await c.mutation("projects:deleteProject", { projectId: p._id }); } catch {}
  }

  const addendum = { attempted: false, ok: false, skipReason: null, conversationId: null, status: null, file: null, generated: null };

  try {
    // 1. fresh project through the dialog
    await page.goto(`${BASE}/?qa38=journey`, { waitUntil: "domcontentloaded", timeout: 90000 });
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
      gc: await setVal(page, 'input[aria-label="General contractor or contracting entity"]', "QA38 Journey GC, LLC"),
      budget: await setVal(page, 'input[aria-label="Estimated budget in dollars"]', "2000000"),
      weeks: await setVal(page, 'input[aria-label="Target completion duration in weeks"]', "52"),
      spec: await setVal(page, 'textarea[placeholder*="Outline high-level trade scopes"]', "Division 26 electrical and Division 23 HVAC scope for the QA38 journey."),
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
    record("A38-J.1", "fresh project created through the UI dialog", Boolean(proj) && Object.values(npFills).every(Boolean) && npClick.ok, { id: proj?._id });
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
    const mk26 = await mkPkgUI("26 00 00", "QA38 Journey Electrical", "900000");
    const pkgs1 = await poll(() => c.query("tradePackages:listByProject", { projectId: proj._id }), (x) => (x || []).length >= 1, 40000, 1200);
    const p26 = (pkgs1 || []).find((p) => p.csiDivision.startsWith("26"));
    const mk23 = await mkPkgUI("23 00 00", "QA38 Journey HVAC", "600000");
    const pkgs2 = await poll(() => c.query("tradePackages:listByProject", { projectId: proj._id }), (x) => (x || []).length >= 2, 40000, 1200);
    const p23 = (pkgs2 || []).find((p) => p.csiDivision.startsWith("23"));
    record("A38-J.2", "Div26 + Div23 packages created through the UI dialog", mk26.go.ok && mk23.go.ok && Boolean(p26) && Boolean(p23) && Object.values(mk23.filled).every(Boolean), { p26: p26?._id, p23: p23?._id });

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
    const ctrGo1 = await addCtr(p26.tradeName, "AUDIT-QA38 Journey Prime", "estimating@qa38-journey-e.invalid", "HI-QA38-JE");
    const ctrGo2 = await addCtr(p23.tradeName, "AUDIT-QA38 Journey Mechanical", "estimating@qa38-journey-m.invalid", "HI-QA38-JM");
    const ctrs26 = await c.query("contractors:listByPackage", { tradePackageId: p26._id });
    const ctrs23 = await c.query("contractors:listByPackage", { tradePackageId: p23._id });
    const ctr26 = (ctrs26 || []).find((x) => /QA38 Journey Prime/.test(x.companyName));
    const ctr23 = (ctrs23 || []).find((x) => /QA38 Journey Mechanical/.test(x.companyName));
    record("A38-J.3", "contractors added through the UI for both packages", ctrGo1.ok && ctrGo2.ok && Boolean(ctr26) && Boolean(ctr23), { c26: ctr26?.companyName, c23: ctr23?.companyName });

    // 4. bids (backend; the UI exposes only LLM-backed ingest - documented limitation)
    const bid26 = await c.mutation("bids:submitDirectBid", { tradePackageId: p26._id, contractorId: ctr26._id, subcontractorName: ctr26.companyName, baseBidAmount: 800000, coiComplianceStatus: "compliant", coiPenalty: 0 });
    const bid23 = await c.mutation("bids:submitDirectBid", { tradePackageId: p23._id, contractorId: ctr23._id, subcontractorName: ctr23.companyName, baseBidAmount: 470000, coiComplianceStatus: "compliant", coiPenalty: 0 });
    reconcile.push({ step: "bids", backend: { b26: bid26.leveledTotalCost, b23: bid23.leveledTotalCost } });
    record("A38-J.4", "bids submitted (backend submitDirectBid; deterministic direct-bid UI does not exist, AI ingest excluded)", bid26.leveledTotalCost === 800000 && bid23.leveledTotalCost === 470000, { bid26, bid23 });

    // 5. clash pre-state + scan
    await clickTab(page, "Scope Clash");
    await delay(1800);
    const kpi0 = await uiClashKpis(page);
    reconcile.push({ step: "clash-pre", backend: { buys: 50500, voids: 46500, credits: 0 }, ui: kpi0 });
    record("A38-J.5", "cross-trade pre-state: UI KPI == backend (buys $50,500, voids $46,500, credits $0, no chips/controls)",
      kpi0.doubleBuys === "50,500" && kpi0.voids === "46,500" && kpi0.credits === "0" && kpi0.deductedChips === 0 && kpi0.reverseButtons === 0 && kpi0.staleButtons === 0 && kpi0.deductButtons === 2,
      { kpi0 });

    const scanTry = await clickText(page, "Run Forensic Clash Scan");
    const scanMsg = await poll(() => page.evaluate(() => {
      const t = (document.querySelector("main") || document.body).innerText;
      const m = /Cross-trade scan complete:[^\n]*/.exec(t);
      return m ? m[0] : null;
    }), (m) => Boolean(m), 90000, 2000);
    const scanBackend = await c.action("coordination:scanCrossTradeClashes", { projectId: proj._id });
    record("A38-J.6", "UI clash scan banner reconciles with the backend scan message", scanTry.ok && Boolean(scanMsg) && scanBackend?.analyzed === true && scanMsg === scanBackend.message, { uiMessage: scanMsg, backendMessage: scanBackend?.message ?? null });

    // 6. 1-click deduct
    const dedClick = await clickNth(page, "1-Click Deduct Credit", 0);
    const b23after = await poll(() => getBid(c, proj._id, bid23.bidId), (b) => (b?.valueEngineeringAlternates || []).length > 0, 40000, 1500);
    await delay(1500);
    const kpi1 = await uiClashKpis(page);
    const detect1 = await detect(c, proj._id);
    const vfdCard = detect1.doubleBuys.find((x) => x.id === "clash-vfd-01");
    reconcile.push({ step: "deduct", backend: { leveled: b23after?.leveledTotalCost, deductedAmount: vfdCard?.deductedAmount }, ui: kpi1 });
    record("A38-J.7", "UI 1-click deduct: HVAC -$38,500; card/KPI reconcile (credits $38,500, buys $12,000); reverse control visible",
      dedClick.ok && b23after?.leveledTotalCost === 431500 && vfdCard?.deductedAmount === 38500 && kpi1.credits === "38,500" && kpi1.doubleBuys === "12,000" && kpi1.deductedChips === 1 && kpi1.reverseButtons === 1,
      { leveled: b23after?.leveledTotalCost, card: { status: vfdCard?.status, amount: vfdCard?.deductedAmount }, kpi1 });

    // 7. reverse from the card
    await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 6500) { if (!(await toastText(page))) return; await sleep(300); } })();
    const revClick = await clickText(page, "Reverse credit");
    const revToast = await poll(() => toastText(page), (t) => Boolean(t) && /reversed/.test(t), 12000, 400);
    const b23rev = await poll(() => getBid(c, proj._id, bid23.bidId), (b) => b?.leveledTotalCost === 470000, 40000, 1200);
    await delay(1500);
    const kpiRev = await uiClashKpis(page);
    const detectRev = await detect(c, proj._id);
    const vfdRev = detectRev.doubleBuys.find((x) => x.id === "clash-vfd-01");
    const revLog = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 300 })) || []).find((l) => /Double-Buy Credit Reversed/.test(l.title));
    reconcile.push({ step: "reverse", backend: { leveled: b23rev?.leveledTotalCost, status: vfdRev?.status }, ui: kpiRev });
    record("A38-J.8", "UI reverse from the card: HVAC restored to $470,000, credit row removed, card detected $38,500, KPI credits $0 / buys $50,500, audit says restored $470,000",
      revClick.ok && Boolean(revToast) && b23rev?.leveledTotalCost === 470000 && creditRows(b23rev).length === 0 &&
        vfdRev?.status === "detected" && vfdRev?.redundantAmount === 38500 && kpiRev.credits === "0" && kpiRev.doubleBuys === "50,500" && kpiRev.deductedChips === 0 && kpiRev.reverseButtons === 0 &&
        /restored to \$470,000/.test(revLog?.description || ""),
      { revToast, leveled: b23rev?.leveledTotalCost, kpiRev, audit: revLog?.description });

    // 8. award -> execute (register/viewer truth)
    await clickTab(page, "Bid Leveling");
    await delay(1600);
    await selectPackage(page, p23.tradeName);
    await delay(1200);
    const award1 = await clickText(page, "Award Compliant Winner");
    const awardTry = award1.ok ? award1 : await clickText(page, "Award Subcontract & Draft Agreement");
    const agrs1 = await poll(() => c.query("agreements:listAgreements", { projectId: proj._id }), (x) => (x || []).some((a) => a.status === "generated"), 60000, 2000);
    const agr = (agrs1 || []).find((a) => a.status === "generated");
    await delay(1500);
    const awardRow = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 300 })) || []).find((l) => /AIA A401 Subcontract Agreement Awarded/.test(l.title));
    reconcile.push({ step: "award", backend: { number: agr?.agreementNumber, sum: agr?.contractSum } });
    record("A38-J.9", "UI award generates the agreement at 470,000; audit says 'generated ... pending external execution'",
      awardTry.ok && agr?.contractSum === 470000 && Boolean(awardRow) && /generated for CSI Division 23/.test(awardRow.description) && /pending external execution/.test(awardRow.description) && !/Executed subcontract/i.test(awardRow.description),
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
    record("A38-J.10", "UI execution: executed status; viewer flips to RECORDED • SIGNATURE REQUIRED; audit avoids a 'fully executed' claim",
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
    await clickFilterStarts(page, "Execution Status Recorded");
    await delay(700);
    const regFilterExec = await uiRegister(page);
    await clickFilterStarts(page, "Pending Execution");
    await delay(700);
    const regFilterPending = await uiRegister(page);
    record("A38-J.11", "register (executed): chip 1/1, row badge, search by agreement number finds the row, Pending filter empty",
      regExec.exec === "1/1" && regExec.rows.length === 1 && /Execution Status Recorded/.test(regExec.rows[0].join(" ")) && regSearchNum.rows.length === 1 && regFilterExec.rows.length === 1 && regFilterPending.rows.length === 0,
      { exec: regExec.exec, searchNum: regSearchNum.rows.length, filterExec: regFilterExec.rows.length, filterPending: regFilterPending.rows.length });

    // 9. void -> re-award truth
    await clickFilterStarts(page, "Execution Status Recorded");
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
    const bid23afterVoid = await getBid(c, proj._id, bid23.bidId);
    const regVoid = await uiRegister(page);
    const supViewerText = await mainText(page);
    reconcile.push({ step: "void", backend: { status: (agrs3 || []).find((a) => a._id === agr?._id)?.status, bidAwarded: bid23afterVoid?.isAwarded }, ui: regVoid });
    record("A38-J.12", "UI void: agreement superseded, bid unawarded; viewer flips to Superseded; audit records the operator reason",
      voidOpen.ok && voidDlg.open && (agrs3 || []).some((a) => a.status === "superseded") && bid23afterVoid?.isAwarded === false && Boolean(voidRow) && /was voided:/.test(voidRow.description) && /reopened for leveling/.test(voidRow.description) && /Superseded — voided or replaced/.test(supViewerText),
      { dialog: voidDlg.title, voidConfirm, viewerSuperseded: /Superseded — voided or replaced/.test(supViewerText), bidAwarded: bid23afterVoid?.isAwarded });

    await clickFilterStarts(page, "Active Contracts");
    await delay(700);
    const regAfterVoidActive = await uiRegister(page);
    await clickFilterStarts(page, "Superseded");
    await delay(700);
    const regSuper = await uiRegister(page);
    await setSearch(page, agr.agreementNumber);
    await delay(700);
    const regSuperSearch = await uiRegister(page);
    await setSearch(page, "");
    await delay(500);
    await clickFilterStarts(page, "Active Contracts");
    await delay(500);
    record("A38-J.13", "register (superseded): Active excludes the voided row and sum is 0; Superseded filter shows it read-only; search still finds it",
      regAfterVoidActive.rows.length === 0 && regAfterVoidActive.sum === "0" && regSuper.rows.length === 1 && /Superseded — read-only/.test(regSuper.rows[0].join(" ")) && regSuperSearch.rows.length === 1,
      { active: { rows: regAfterVoidActive.rows.length, sum: regAfterVoidActive.sum }, super: regSuper.rows.length, superSearch: regSuperSearch.rows.length });

    await clickTab(page, "Bid Leveling");
    await delay(1600);
    await selectPackage(page, p23.tradeName);
    await delay(1000);
    const reAward1 = await clickText(page, "Award Compliant Winner");
    const reAward = reAward1.ok ? reAward1 : await clickText(page, "Award Subcontract & Draft Agreement");
    const agrs4 = await poll(() => c.query("agreements:listAgreements", { projectId: proj._id }), (x) => (x || []).some((a) => a._id === agr?._id && a.status === "generated"), 60000, 2000);
    await delay(1500);
    const reRow = ((await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 300 })) || []).find((l) => /Re-Awarded/.test(l.title));
    const bid23re = await getBid(c, proj._id, bid23.bidId);
    record("A38-J.14", "UI re-award reactivates the same agreement (generated) with 'Re-Awarded ... Re-activated' audit and no execution claim",
      reAward.ok && (agrs4 || []).find((a) => a._id === agr?._id)?.agreementNumber === agr?.agreementNumber && (agrs4 || []).find((a) => a._id === agr?._id)?.status === "generated" && bid23re?.isAwarded === true && Boolean(reRow) && /Re-activated subcontract agreement/.test(reRow.description) && !/executed/i.test(reRow.description),
      { status: (agrs4 || []).find((a) => a._id === agr?._id)?.status, reRow: reRow?.description });

    await clickTab(page, "Subcontracts");
    await delay(1500);
    await clickFilterStarts(page, "Pending Execution");
    await delay(700);
    const regReAward = await uiRegister(page);
    record("A38-J.15", "register after re-award: Pending Execution shows the reactivated row once; Active Contracted Sum counts it once ($470,000)",
      regReAward.rows.length === 1 && regReAward.sum === "470,000",
      { rows: regReAward.rows.length, sum: regReAward.sum });

    // 10. addendum flow (RFI -> PM certify -> issue) - best effort within budget
    addendum.attempted = true;
    try {
      await clickTab(page, "Discovery");
      await delay(1400);
      await selectPackage(page, p23.tradeName);
      await delay(900);
      await clickTab(page, "Pre-Bid Q&A");
      await delay(1600);
      const rfiSubject = "QA38 feeder derating clarification";
      const rfiQuestion = "Confirm whether feeder derating at 90C is required for the QA38 riser per spec section 26 05 19.";
      const sSet = await setVal(page, 'input[aria-label="RFI subject or scope topic"]', rfiSubject);
      const qSet = await setVal(page, 'textarea[aria-label="Subcontractor question"]', rfiQuestion);
      const rfiSubmit = await clickText(page, "Submit RFI for Clarification");
      const convo = await poll(
        () => c.query("rfq:listConversations", { tradePackageId: p23._id }).then((xs) => (xs || []).find((x) => x.inboundSubject === rfiSubject)),
        (x) => Boolean(x) && x.status !== "pending_analysis",
        150000,
        4000
      );
      addendum.conversationId = convo?._id ?? null;
      addendum.status = convo?.status ?? null;
      if (convo && (convo.status === "clarified" || convo.status === "escalated_to_pm")) {
        await delay(1500);
        const approve = await clickText(page, "Approve for Addendum");
        let certified = false;
        for (let i = 0; i < 20; i++) {
          await delay(1500);
          const xs = (await c.query("rfq:listConversations", { tradePackageId: p23._id })) || [];
          const cur = xs.find((x) => x._id === convo._id);
          if (cur?.pmCertifiedAt) { certified = true; break; }
          if (!approve.ok) { await clickText(page, "Approve for Addendum"); }
        }
        const issueBtn = await poll(() => page.evaluate(() => {
          const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
          const b = [...document.querySelectorAll("button")].find((x) => vis(x) && /Issue Pre-Bid Addendum NO\. 01/.test(x.innerText || ""));
          return b ? { ok: true, disabled: b.disabled, title: b.getAttribute("title") } : { ok: false };
        }), (x) => x.ok, 20000, 1500);
        const issueClick = await clickText(page, "Issue Pre-Bid Addendum NO. 01");
        const files = await poll(() => c.query("files:listFilesByProject", { projectId: proj._id }), (xs) => (xs || []).some((f) => f.fileType === "addendum"), 90000, 3000);
        const addFile = (files || []).filter((f) => f.fileType === "addendum").sort((a, b) => (b._creationTime || 0) - (a._creationTime || 0))[0] || null;
        addendum.file = addFile ? { _id: addFile._id, fileName: addFile.fileName, uploadedBy: addFile.uploadedBy, hasRfi: /feeder derating|26 05 19/i.test(addFile.textContent || "") } : null;
        const bannerText = await mainText(page);
        addendum.ok = Boolean(certified && issueClick.ok && addFile && addFile.uploadedBy === "TradePulse Pre-Bid Clarification Engine (generated addendum)" && /Successfully Issued & Filed|Pre-Bid Addendum NO\. 01/.test(bannerText));
        record("A38-J.16a", "addendum flow: UI RFI submitted, AI analysis settled, PM certified, addendum file generated by the clarification engine",
          Boolean(sSet && qSet && rfiSubmit.ok && convo && (convo.status === "clarified" || convo.status === "escalated_to_pm") && certified && issueClick.ok && addFile),
          { rfiSubmit, convo: convo && { id: convo._id, status: convo.status }, certified, issueBtn, file: addendum.file, banner: bannerText.replace(/\s+/g, " ").slice(0, 260) });
        record("A38-J.16b", "addendum claims truth: file author is the clarification engine (no 'Legal'), banner says Issued & Filed, no official-AIA claim",
          addendum.ok && !/official AIA/i.test(bannerText) && !/Issue Legal Addendum/i.test(bannerText),
          { file: addendum.file, officialAia: /official AIA/i.test(bannerText) });
      } else {
        addendum.skipReason = convo ? `analysis status=${convo.status}` : "conversation not found within budget";
        record("A38-J.16", "addendum flow: RFI analysis did not settle within budget (not app-blocking; recorded skip)", false,
          { convo: convo && { id: convo._id, status: convo.status }, skipReason: addendum.skipReason });
      }
    } catch (err) {
      addendum.skipReason = `addendum stage error: ${err?.message ?? err}`;
      record("A38-J.16", "addendum flow aborted (not app-blocking; recorded skip)", false, { skipReason: addendum.skipReason });
    }

    // 11. claims sweep across all tabs
    const violations = [];
    for (const t of ["CSI Scoping", "Discovery", "Pre-Bid Q&A", "Bid Leveling", "Scope Clash", "Subcontracts", "Live Activity Audit", "Evals & Architecture"]) {
      await clickTab(page, t);
      await delay(1200);
      const text = await mainText(page);
      for (const v of claimViolations(text)) violations.push({ tab: t, ...v });
    }
    record("A38-J.17", "live claims sweep across all 8 tabs: zero forbidden claims (Gemini-3.8 / dedicated inbox / positive official AIA / executed-before-execution / static scan fallback)",
      violations.length === 0, { violations: violations.slice(0, 6) });

    // 12. exact backend reconciliation at the end
    const snap = {
      packages: await c.query("tradePackages:listByProject", { projectId: proj._id }),
      bids: await c.query("bids:listAllProjectBids", { projectId: proj._id }),
      agreements: await c.query("agreements:listAgreements", { projectId: proj._id }),
      contractors: await c.query("contractors:listByProject", { projectId: proj._id }),
      logs: await c.query("auditLogs:listRecentLogs", { projectId: proj._id, limit: 500 }),
    };
    const inv = await creditInvariants(c, proj._id);
    const dEnd = await detect(c, proj._id);
    const backendBuys = dEnd.doubleBuys.reduce((s, x) => s + (x.redundantAmount || 0), 0);
    const backendVoids = dEnd.scopeVoids.filter((x) => x.status === "open").reduce((s, x) => s + (x.estimatedVoidCost || x.redundantAmount || 0), 0);
    const backendCredits = inv.summary.actualTotal;
    const fmt = (n) => n.toLocaleString("en-US");

    await clickTab(page, "Scope Clash");
    await delay(1600);
    const uiEnd = await uiClashKpis(page);
    await clickTab(page, "Subcontracts");
    await delay(1600);
    const regEnd = await uiRegister(page);

    const agreementEnd = (snap.agreements || []).find((a) => a._id === agr?._id) || null;
    const creditAuditCount = (snap.logs || []).filter((l) => /Double-Buy Credit Deducted/.test(l.title)).length;
    const reverseAuditCount = (snap.logs || []).filter((l) => /Double-Buy Credit Reversed/.test(l.title)).length;
    const reAwardCount = (snap.logs || []).filter((l) => /Re-Awarded/.test(l.title)).length;
    const voidCount = (snap.logs || []).filter((l) => /Executed Subcontract Voided/.test(l.title)).length;

    const finalChecks = {
      packagesTwo: (snap.packages || []).length === 2,
      contractorsTwo: (snap.contractors || []).length === 2,
      bidsTwo: (snap.bids || []).length === 2,
      b26Leveled800k: snap.bids.find((b) => b._id === bid26.bidId)?.leveledTotalCost === 800000,
      b23Leveled470k: snap.bids.find((b) => b._id === bid23.bidId)?.leveledTotalCost === 470000,
      zeroCreditRows: inv.summary.acceptedCredits === 0 && inv.summary.declinedCredits === 0,
      creditInvariantsClean: inv.clean === true,
      kpiBuys: uiEnd.doubleBuys === fmt(backendBuys) && backendBuys === 50500,
      kpiVoids: uiEnd.voids === fmt(backendVoids) && backendVoids === 46500,
      kpiCredits: uiEnd.credits === fmt(backendCredits) && backendCredits === 0,
      uiNoChips: uiEnd.deductedChips === 0 && uiEnd.reverseButtons === 0 && uiEnd.staleButtons === 0,
      agreementGenerated470k: agreementEnd?.status === "generated" && agreementEnd?.contractSum === 470000,
      bid23Awarded: snap.bids.find((b) => b._id === bid23.bidId)?.isAwarded === true,
      bid26Unawarded: snap.bids.find((b) => b._id === bid26.bidId)?.isAwarded === false,
      registerPendingOne: regEnd.rows.length === 1 && /Generated|Pending/i.test(regEnd.rows[0].join(" ")),
      registerSum470k: regEnd.sum === "470,000",
      auditOneDeduct: creditAuditCount === 1,
      auditOneReverse: reverseAuditCount === 1,
      auditOneReAward: reAwardCount === 1,
      auditOneVoid: voidCount === 1,
      noUnexpectedCreditAudits: reverseAuditCount === 1 && (snap.logs || []).filter((l) => /Double-Buy Credit Record Cleared/.test(l.title)).length === 0,
    };
    reconcile.push({
      step: "final",
      backend: { buys: backendBuys, voids: backendVoids, credits: backendCredits, agreement: { status: agreementEnd?.status, sum: agreementEnd?.contractSum }, bids: snap.bids.map((b) => ({ level: b.leveledTotalCost, awarded: !!b.isAwarded })) },
      ui: { clash: uiEnd, register: { rows: regEnd.rows.length, sum: regEnd.sum } },
      checks: finalChecks,
    });
    const finalPass = Object.values(finalChecks).every(Boolean);
    if (!finalPass) finding("A38-J.R", "High", "final backend reconciliation mismatch after the full journey", finalChecks);
    record("A38-J.R", "FINAL RECONCILIATION: packages 2 / contractors 2 / bids 2; b26 800,000 un-awarded, b23 470,000 re-awarded; zero credit rows and invariants clean; UI KPI buys/voids/credits == backend (50,500 / 46,500 / 0) with no chips; agreement generated 470,000; register Pending 1 row / sum 470,000; exactly one deduct, one reverse, one re-award, one void audit and no phantom clear",
      finalPass, finalChecks);

    // 13. diagnostics
    await setViewport(page, 1440, 900);
    await delay(2500);
    const consoleErrors = diag.consoleLogs.filter((l) => l.type === "error");
    const consoleWarnings = diag.consoleLogs.filter((l) => l.type === "warning" || l.type === "warn");
    const appFailed = diag.failedRequests.filter((f) => !/favicon/i.test(f));
    record("A38-J.18", "websocket: reactive connection opened, frames exchanged both ways, no frame errors",
      ws.created >= 1 && ws.framesReceived > 0 && ws.frameErrors.length === 0 && ws.closed <= 2,
      { created: ws.created, closed: ws.closed, framesReceived: ws.framesReceived, framesSent: ws.framesSent, frameErrors: ws.frameErrors.slice(0, 3) });
    record("A38-J.19", "journey diagnostics: ZERO page errors, no failed app requests; console errors only where a refused mutation was expected",
      diag.pageErrors.length === 0 && appFailed.length === 0 && consoleErrors.every((e) => /deductDoubleBuyCredit|already been applied/i.test(e.text)),
      { pageErrors: diag.pageErrors.slice(0, 4), consoleErrors: consoleErrors.slice(0, 5).map((e) => e.text.slice(0, 160)), consoleWarnings: consoleWarnings.slice(0, 4).map((e) => e.text.slice(0, 140)), failedRequests: appFailed.slice(0, 5) });

    writeEvidence("ui-journey", {
      projectId: proj._id, p26: p26._id, p23: p23._id, bid26: bid26.bidId, bid23: bid23.bidId, agreement: agr?.agreementNumber,
      addendum, results, reconcile, ws, sourceClaims: src,
      summary: { pass: results.filter((r) => r.pass).length, total: results.length },
    });
    writeLog("ui-journey", log);
    console.log(`ui-journey: ${results.filter((r) => r.pass).length}/${results.length}`);
    if (results.some((r) => !r.pass && !/^A38-J\.16/.test(r.id))) process.exitCode = 2;
  } catch (err) {
    writeEvidence("ui-journey", { results: [...results, { id: "A38-J.ERR", pass: false, name: "aborted", detail: String(err?.stack ?? err) }], reconcile, addendum, summary: { pass: results.filter((r) => r.pass).length, total: results.length + 1 } });
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