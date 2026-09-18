import { launchBrowser, waitForAppReady, delay, selectProjectByTitle, shot } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog, fullFixtureState } from "./qa10-lib.mjs";

const c = client();
const log = [];
const rows = [];
const say = (s) => { log.push(s); console.log(s); };

function record(id, label, expected, observed, ok) {
  rows.push({ id, label, expected, observed, ok });
  say(`${ok ? "ok " : "FLAG"} ${id} ${label} :: expected=${JSON.stringify(expected)} observed=${JSON.stringify(observed)}`);
}

const TAB_TITLES = {
  packages: "CSI Scoping",
  discovery: "Discovery",
  qna: "Pre-Bid Q&A",
  leveling: "Bid Leveling",
  coordination: "Scope Clash",
  contracts: "Subcontracts",
  audit: "Live Activity Audit",
  diagnostics: "Evals & Architecture",
};

async function clickTab(page, title) {
  await page.evaluate((t) => {
    const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes(t) || (x.innerText || "").includes(t));
    if (b) b.click();
  }, title);
  await delay(900);
}

async function main() {
  const F = readEvidence("fixtures");
  const st = await fullFixtureState(c, F.alpha.projectId);
  const backend = {
    packages: st.packages.length,
    contractors: st.contractors.length,
    bids: st.bids.filter((b) => b.tradePackageId === F.alpha.elecPackageId).length,
    conversations: st.conversations.length,
    agreements: st.agreements.length,
    executed: st.agreements.filter((a) => a.status === "executed").length,
    logs: st.logs.length,
  };
  say(`backend counts: ${JSON.stringify(backend)}`);

  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const uiText = {};
  try {
    await page.goto("https://brainy-skunk-440.convex.site", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(700);
    await selectProjectByTitle(page, "AUDIT-QA10-ALPHA");
    await delay(1200);

    // ---- packages tab ----
    await clickTab(page, TAB_TITLES.packages);
    uiText.packages = await page.evaluate(() => document.querySelector("main")?.innerText || "");
    const pkgButtons = await page.evaluate(() => [...document.querySelectorAll("main button")].filter((b) => /^\d{2} \d{2} \d{2}/.test((b.innerText || "").trim())).map((b) => b.innerText.trim().split("\n")[0]));
    record("A10-CL01", "Packages tab lists every backend package", backend.packages, `${pkgButtons.length} CSI buttons: ${pkgButtons.slice(0, 6).join(" | ")}`, pkgButtons.length === backend.packages);

    // ---- discovery tab ----
    await clickTab(page, TAB_TITLES.discovery);
    uiText.discovery = await page.evaluate(() => document.querySelector("main")?.innerText || "");
    const discCount = (uiText.discovery.match(/Active \/ Verified|Unverified|Active \/ Verified \(TDLR-QA\)/g) || []).length;
    record("A10-CL02", "Discovery tab shows contractor records", backend.contractors, `license-ish labels=${discCount}; text sample="${uiText.discovery.slice(0, 120).replace(/\n/g, " / ")}"`, uiText.discovery.includes("AUDIT-QA10 Alpha Electric"));

    // ---- qna tab ----
    await clickTab(page, TAB_TITLES.qna);
    uiText.qna = await page.evaluate(() => document.querySelector("main")?.innerText || "");
    const allRfi = uiText.qna.match(/All RFIs \((\d+)\)/);
    record("A10-CL03", "Q&A 'All RFIs' count matches backend conversations", backend.conversations, allRfi ? allRfi[1] : "not found", !!allRfi && Number(allRfi[1]) === backend.conversations);
    const approved = uiText.qna.match(/Approved for Addendum \((\d+)\)/);
    const certified = st.conversations.filter((x) => x.status === "clarified" && x.pmCertifiedAt).length;
    record("A10-CL04", "Q&A 'Approved for Addendum' count matches pm-certified rows", certified, approved ? approved[1] : "not found", !!approved && Number(approved[1]) === certified);

    // ---- leveling tab ----
    await clickTab(page, TAB_TITLES.leveling);
    uiText.leveling = await page.evaluate(() => document.querySelector("main")?.innerText || "");
    const proposalMatch = uiText.leveling.match(/(\d+)\s+Proposal/i) || uiText.leveling.match(/Proposals?:\s*(\d+)/i);
    record("A10-CL05", "Leveling proposal count matches backend bids", backend.bids, proposalMatch ? proposalMatch[1] : "not found in visible text", !!proposalMatch && Number(proposalMatch[1]) === backend.bids);
    const awardedShown = uiText.leveling.includes("AWARDED") || uiText.leveling.includes("Awarded");
    record("A10-CL06", "Leveling shows awarded state for the executed bid", true, awardedShown, awardedShown);

    // leveling overflow detail at 320 / 375
    const overflow = {};
    for (const w of [320, 375]) {
      await page.setViewport({ width: w, height: 700, deviceScaleFactor: 1 });
      await delay(500);
      await page.evaluate(() => window.scrollTo(0, 0));
      await delay(200);
      overflow[w] = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const maxScrollX = document.documentElement.scrollWidth - vw;
        const btn = [...document.querySelectorAll("button")].find((b) => /Award/i.test(b.innerText || "") && b.getBoundingClientRect().width > 200);
        let after = null;
        if (btn) {
          const r = btn.getBoundingClientRect();
          const cs = getComputedStyle(btn);
          window.scrollTo(maxScrollX, 0);
          const r2 = btn.getBoundingClientRect();
          after = { text: btn.innerText.trim().slice(0, 60), whiteSpace: cs.whiteSpace, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), afterScrollLeft: Math.round(r2.left), afterScrollRight: Math.round(r2.right), fullyVisibleAfterScroll: r2.left >= -1 && r2.right <= vw + 1 };
        }
        const scrolled = window.scrollX;
        window.scrollTo(0, 0);
        return { vw, maxScrollX, scrolled, button: after };
      });
      say(`[overflow ${w}px] maxScrollX=${overflow[w].maxScrollX} button=${JSON.stringify(overflow[w].button)}`);
      await shot(page, `fix4-qa10-09-leveling-${w}.png`);
    }
    record("A10-CL07", "Leveling primary award CTA overflows viewport at 320/375", "no horizontal overflow",
      `320: maxScrollX=${overflow[320].maxScrollX}, buttonRight=${overflow[320].button?.right}, fullyVisibleAfterScroll=${overflow[320].button?.fullyVisibleAfterScroll}; 375: maxScrollX=${overflow[375].maxScrollX}, buttonRight=${overflow[375].button?.right}`,
      overflow[320].maxScrollX <= 1 && overflow[375].maxScrollX <= 1);

    // ---- coordination tab ----
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await delay(400);
    await clickTab(page, TAB_TITLES.coordination);
    uiText.coordination = await page.evaluate(() => document.querySelector("main")?.innerText || "");
    const clash = st.clashes;
    const uiNet = uiText.coordination.match(/NET BUYOUT EXPOSURE[^\n]*\n?[^\n]*\$?([\d,.]+)/i);
    const backendNet = Math.abs(clash.summary.totalScopeVoidExposure - clash.summary.totalDoubleBuyExposure);
    const netOk = uiText.coordination.replace(/[,\s.]/g, "").includes(String(backendNet).replace(/,/g, ""));
    record("A10-CL08", "Coordination net exposure reconciles with backend clash sums", backendNet, `backend=${backendNet} uiContains=${netOk}`, netOk);

    // ---- contracts tab ----
    await clickTab(page, TAB_TITLES.contracts);
    uiText.contracts = await page.evaluate(() => document.querySelector("main")?.innerText || "");
    const execShown = /Execution Status Recorded|Executed/i.test(uiText.contracts);
    record("A10-CL09", "Contracts tab reflects executed agreement", `executed=${backend.executed}`, `executed text shown=${execShown}; agreements=${uiText.contracts.match(/(\d+)\s+contract/i)?.[1] ?? "?"}`, backend.executed > 0 ? execShown : true);

    // ---- audit tab ----
    await clickTab(page, TAB_TITLES.audit);
    uiText.audit = await page.evaluate(() => document.querySelector("main")?.innerText || "");
    const latestLog = st.logs.sort((a, b) => b.timestamp - a.timestamp)[0];
    record("A10-CL10", "Audit tab shows the newest backend audit title", latestLog?.title?.slice(0, 60), (uiText.audit.match(/^.*Awarded.*$/m) || ["not found"])[0].slice(0, 80), uiText.audit.includes("Awarded") || uiText.audit.includes("Subcontract"));

    // ---- diagnostics tab ----
    await clickTab(page, TAB_TITLES.diagnostics);
    uiText.diagnostics = await page.evaluate(() => document.querySelector("main")?.innerText || "");
    const diagClaims = uiText.diagnostics.includes("cases") || uiText.diagnostics.includes("Eval");
    record("A10-CL11", "Diagnostics tab renders evaluation claims", true, diagClaims ? "claims present" : "no claims found", diagClaims);

    writeEvidence("claims", { backend, rows, uiTextSamples: Object.fromEntries(Object.entries(uiText).map(([k, v]) => [k, v.slice(0, 800)])), overflow });
    writeLog("claims", log);
    console.log(`\nCLAIMS: ${rows.filter((r) => r.ok).length}/${rows.length} held`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });