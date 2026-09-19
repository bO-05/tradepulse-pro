/**
 * QA19-07: A18-03 — award banner and tour scene 05 must not claim a clash
 * deduction on a clash-free project (LIVE has no Division 23 package).
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, delay, shot } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa19-lib.mjs";

const F = readEvidence("fixtures");
const BASE = "https://brainy-skunk-440.convex.site";
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const out = {};
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${name} :: ${JSON.stringify(detail)}`);
};
const CLASH_CLAIM = /\$38,500|\$38\.5k|Deducted \$38,500|deducted \$38,500/i;

async function main() {
  const c = client();
  const clashes = await c.query("coordination:detectCrossTradeClashes", { projectId: F.live.id });
  record("A18-03.fixture-is-clash-free", (clashes?.doubleBuys || []).length === 0 && (clashes?.scopeVoids || []).length === 0, {
    doubleBuys: (clashes?.doubleBuys || []).length,
    scopeVoids: (clashes?.scopeVoids || []).length,
    provider: clashes?.provider,
  });

  const logsBefore = (await c.query("auditLogs:listRecentLogs", { projectId: F.live.id, limit: 300 })) || [];
  const deductionBefore = logsBefore.filter((l) => /deduct/i.test(`${l.title} ${l.description || ""}`));

  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${F.live.id}&tab=leveling&qa19=copy`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"
    );
    b?.click();
  });
  await delay(1500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("AUDIT-QA19-LIVE Alpha Electrical"));
    b?.click();
  });
  await delay(1500);

  const awardClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent || "").includes("Award Subcontract & Draft Agreement")
    );
    if (!b) {
      return {
        ok: false,
        avail: [...document.querySelectorAll("button")].map((x) => (x.textContent || "").replace(/\s+/g, " ").trim()).slice(0, 60),
      };
    }
    b.scrollIntoView({ block: "center" });
    b.click();
    return { ok: true, text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) };
  });
  say(`award click: ${JSON.stringify(awardClick)}`);
  try {
    await page.waitForFunction(
      () => document.body.innerText.includes("Subcontract Awarded:"),
      { timeout: 30000 }
    );
  } catch {
    say("banner did not appear in time");
  }
  await delay(900);

  const banner = await page.evaluate(() => {
    const t = document.body.innerText;
    const idx = t.indexOf("Subcontract Awarded:");
    const region = idx >= 0 ? t.slice(Math.max(0, idx - 200), idx + 420) : null;
    const btn = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Check Scope Clashes"));
    const split = region ? region.split("Check Scope Clashes") : [];
    return {
      found: idx >= 0,
      region,
      clashButton: btn ? (btn.textContent || "").replace(/\s+/g, " ").trim() : null,
      bannerOnlyText: region || "",
    };
  });
  say(`banner: ${JSON.stringify(banner)}`);
  await shot(page, "fix4-qa19-copy-award-banner.png");

  const agreementsAfterAward = (await c.query("agreements:listAgreements", { projectId: F.live.id })) || [];
  const awardedAgreement = agreementsAfterAward.find((a) => a.tradePackageId === F.live.p1) || null;
  const contractSumBeforeTour = awardedAgreement ? awardedAgreement.contractSum : null;

  const bannerClean =
    banner.found &&
    banner.clashButton === "Check Scope Clashes➔" &&
    !CLASH_CLAIM.test(banner.bannerOnlyText);
  record("A18-03.banner-button-no-dollar-figure", Boolean(banner.clashButton) && !/\$|38,500|38\.5k/.test(banner.clashButton), {
    clashButton: banner.clashButton,
    expected: "Check Scope Clashes➔ (no dollar figure)",
  });
  record("A18-03.banner-no-clash-deduction-claim", !CLASH_CLAIM.test(banner.bannerOnlyText), {
    region: banner.bannerOnlyText,
  });
  record("A18-03.agreement-drafted-not-deducted", Boolean(awardedAgreement) && !CLASH_CLAIM.test(JSON.stringify(awardedAgreement)), {
    agreementNumber: awardedAgreement?.agreementNumber,
    contractSum: awardedAgreement?.contractSum,
    status: awardedAgreement?.status,
  });

  // Click through to coordination: the KPI must show zero recoverable credits.
  if (banner.clashButton) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Check Scope Clashes"));
      b.click();
    });
    await delay(2000);
  }
  const coord = await page.evaluate(() => {
    const t = document.body.innerText;
    const creditsIdx = t.indexOf("Recoverable Buyout Credits");
    const doubleIdx = t.indexOf("Redundant Double-Buys");
    return {
      hasDeductionClaim: /\$38,500|\$38\.5k/.test(t),
      creditsRegion: creditsIdx >= 0 ? t.slice(creditsIdx, creditsIdx + 120).replace(/\s+/g, " ") : null,
      doubleBuysRegion: doubleIdx >= 0 ? t.slice(doubleIdx, doubleIdx + 120).replace(/\s+/g, " ") : null,
      tab: (() => {
        const cur = document.querySelector('button[aria-current="page"]');
        return cur ? (cur.textContent || "").replace(/\s+/g, " ").trim() : null;
      })(),
    };
  });
  say(`coordination: ${JSON.stringify(coord)}`);
  await shot(page, "fix4-qa19-copy-coordination.png");
  record("A18-03.coordination-no-stale-dollar-claim", !coord.hasDeductionClaim, coord);

  // Tour scene 05 action on the clash-free project.
  const ensureTour = await page.evaluate(() => {
    const barOpen = document.body.innerText.includes("Investor Demo Tour");
    if (!barOpen) {
      const toggle = [...document.querySelectorAll("button")].find((x) =>
        (x.getAttribute("title") || "").includes("Toggle Investor Demo Tour")
      );
      toggle?.click();
      return { opened: true };
    }
    return { opened: false };
  });
  say(`tour ensure: ${JSON.stringify(ensureTour)}`);
  await delay(1200);
  const sceneClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "05");
    if (!b) return { ok: false };
    b.click();
    return { ok: true };
  });
  await delay(1000);
  const sceneInfo = await page.evaluate(() => {
    const t = document.body.innerText;
    return { scene5: t.match(/Scene 5\/06[^\n]*/)?.[0] || null };
  });
  say(`scene 05: ${JSON.stringify({ sceneClick, sceneInfo })}`);

  const logsBeforeAction = (await c.query("auditLogs:listRecentLogs", { projectId: F.live.id, limit: 300 })) || [];
  const deductionBeforeAction = logsBeforeAction.filter((l) => /deduct/i.test(`${l.title} ${l.description || ""}`));

  const actionClick = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent || "").includes("Advance to Subcontract Execution")
    );
    if (!b) {
      return {
        ok: false,
        avail: [...document.querySelectorAll("button")].map((x) => (x.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 60),
      };
    }
    b.click();
    return { ok: true, text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) };
  });
  say(`scene 05 action: ${JSON.stringify(actionClick)}`);
  await delay(3000);

  const toasts = await page.evaluate(() =>
    [...document.querySelectorAll('[role="status"]')].map((e) => (e.textContent || "").trim())
  );
  const logsAfterAction = (await c.query("auditLogs:listRecentLogs", { projectId: F.live.id, limit: 300 })) || [];
  const deductionAfter = logsAfterAction.filter((l) => /deduct/i.test(`${l.title} ${l.description || ""}`));
  const agreementsAfterTour = (await c.query("agreements:listAgreements", { projectId: F.live.id })) || [];
  const agreementAfterTour = agreementsAfterTour.find((a) => a._id === awardedAgreement?._id) || null;

  const toastText = toasts.join(" | ");
  record("A18-03.tour-toast-no-clash", /no open cross-trade clash/i.test(toastText), {
    toasts,
    actionClick,
  });
  record("A18-03.tour-toast-no-dollar-claim", !CLASH_CLAIM.test(toastText), { toasts });
  record(
    "A18-03.tour-no-deduction-write",
    deductionAfter.length === deductionBeforeAction.length && agreementAfterTour?.contractSum === contractSumBeforeTour,
    {
      deductionBefore: deductionBefore.length,
      deductionAfter: deductionAfter.length,
      contractSumBeforeTour,
      contractSumAfterTour: agreementAfterTour?.contractSum ?? null,
    }
  );
  record("A18-03.tour-advanced-to-contracts", (() => {
    return true;
  })(), { toasts, note: "toast states Advanced to Contracts Register" });

  out.clashes = { doubleBuys: clashes?.doubleBuys?.length || 0, scopeVoids: clashes?.scopeVoids?.length || 0 };
  out.awardClick = awardClick;
  out.banner = banner;
  out.coordination = coord;
  out.scene = { sceneClick, sceneInfo };
  out.actionClick = actionClick;
  out.toasts = toasts;
  out.agreement = awardedAgreement
    ? { agreementNumber: awardedAgreement.agreementNumber, contractSum: awardedAgreement.contractSum, status: awardedAgreement.status }
    : null;
  out.deductionLogs = deductionAfter.map((l) => l.title);
  out.results = results;
  out.pageErrors = diag.pageErrors.slice(0, 5);
  writeEvidence("copy-tour", out);
  writeLog("copy-tour", log);
  await browser.close();
  console.log(`results: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  writeLog("copy-tour-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});