import { launchBrowser, waitForAppReady, delay, shot } from "./lib.mjs";
import { client, readEvidence, writeEvidence, writeLog } from "./qa10-lib.mjs";

const log = [];
const say = (s) => { log.push(s); console.log(s); };
const WEBSITE = "https://brainy-skunk-440.convex.site";

const ACTIVE = () => {
  const a = document.activeElement;
  if (!a) return { tag: "none" };
  const r = a.getBoundingClientRect();
  const name = (a.getAttribute("aria-label") || a.innerText || a.getAttribute("title") || a.getAttribute("placeholder") || "").toString().trim().replace(/\s+/g, " ").slice(0, 80);
  return {
    tag: a.tagName.toLowerCase(),
    name,
    role: a.getAttribute("role"),
    inDialog: !!a.closest('[role="dialog"],[role="alertdialog"]'),
    rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    value: a.tagName === "SELECT" ? a.options[a.selectedIndex]?.textContent : undefined,
  };
};

async function tabTo(page, predicate, max = 800, label = "target") {
  const seen = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    await delay(12);
    const info = await page.evaluate(ACTIVE);
    seen.push(info.name);
    if (predicate(info)) return { found: true, tabs: i + 1, info, seen: seen.slice(-8) };
  }
  return { found: false, tabs: max, seen: seen.slice(-15) };
}

async function main() {
  const c = client();
  const F = readEvidence("fixtures");
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = { phases: {} };
  try {
    await page.goto(WEBSITE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(900);

    // ---------- Phase 1: select ALPHA project with keyboard only ----------
    const sel = await tabTo(page, (i) => i.tag === "select" && i.name.includes("Select Commercial Construction Project"), 120, "project select");
    let selected = null;
    if (sel.found) {
      for (let i = 0; i < 30; i++) {
        const info = await page.evaluate(ACTIVE);
        if ((info.value || "").includes("AUDIT-QA10-ALPHA")) { selected = info.value; break; }
        await page.keyboard.press("ArrowDown");
        await delay(120);
      }
      if (!selected) {
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press("ArrowUp");
          await delay(120);
          const info = await page.evaluate(ACTIVE);
          if ((info.value || "").includes("AUDIT-QA10-ALPHA")) { selected = info.value; break; }
        }
      }
    }
    out.phases.select = { ...sel, selected };
    say(`[kbd] project select: found=${sel.found} tabs=${sel.tabs} selected=${selected}`);
    if (!selected) throw new Error("keyboard project selection failed");
    await delay(1200);

    // ---------- Phase 2: keyboard-open Leveling tab ----------
    const lvl = await tabTo(page, (i) => i.tag === "button" && i.name.includes("Bid Leveling"), 200, "leveling tab");
    if (lvl.found) await page.keyboard.press("Enter");
    await delay(1000);
    out.phases.levelingTab = lvl;
    say(`[kbd] leveling tab: found=${lvl.found} tabs=${lvl.tabs}`);

    // ---------- Phase 3: keyboard-open Ingest Quote dialog, focus check, Escape ----------
    const ing = await tabTo(page, (i) => i.tag === "button" && /Ingest/i.test(i.name), 250, "ingest");
    let ingestFocus = null;
    if (ing.found) {
      await page.keyboard.press("Enter");
      await delay(600);
      ingestFocus = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"],[role="alertdialog"]');
        const a = document.activeElement;
        return { dialogOpen: !!dlg, focusInsideDialog: dlg ? dlg.contains(a) : false, activeName: (a.getAttribute("aria-label") || a.innerText || "").trim().slice(0, 50) };
      });
      await page.keyboard.press("Escape");
      await delay(400);
    }
    out.phases.ingestKeyboard = { ...ing, ingestFocus };
    say(`[kbd] ingest dialog: found=${ing.found} tabs=${ing.tabs} focusInside=${ingestFocus?.focusInsideDialog} active="${ingestFocus?.activeName}"`);

    // ---------- Phase 4: keyboard award (Award ... Draft Agreement) ----------
    const award = await tabTo(page, (i) => i.tag === "button" && /Award/i.test(i.name) && i.name.length > 5, 700, "award");
    out.phases.awardButton = award;
    say(`[kbd] award button: found=${award.found} tabs=${award.tabs} name="${award.info?.name}"`);
    if (award.found) {
      await page.keyboard.press("Enter");
      await delay(3500);
    }
    let agreement = null;
    for (let i = 0; i < 20 && !agreement; i++) {
      const ags = await c.query("agreements:listAgreements", { projectId: F.alpha.projectId });
      agreement = ags.find((a) => a.status === "generated") || null;
      if (!agreement) await delay(1000);
    }
    out.phases.agreementAfterAward = agreement ? { id: agreement._id, number: agreement.agreementNumber, status: agreement.status, contractSum: agreement.contractSum } : null;
    say(`[kbd] agreement after award: ${JSON.stringify(out.phases.agreementAfterAward)}`);
    await shot(page, "fix4-qa10-08-keyboard-after-award.png");

    // ---------- Phase 5: keyboard switch to Subcontracts, record execution ----------
    const contractTab = await tabTo(page, (i) => i.tag === "button" && i.name.includes("Subcontracts"), 200, "contracts tab");
    if (contractTab.found) await page.keyboard.press("Enter");
    await delay(1200);
    out.phases.contractsTab = contractTab;
    say(`[kbd] contracts tab: found=${contractTab.found} tabs=${contractTab.tabs}`);

    const execBtn = await tabTo(page, (i) => i.tag === "button" && /Record Execution/i.test(i.name), 400, "execute");
    out.phases.executeButton = execBtn;
    say(`[kbd] record execution: found=${execBtn.found} tabs=${execBtn.tabs} name="${execBtn.info?.name}"`);
    if (execBtn.found) {
      await page.keyboard.press("Enter");
      await delay(700);
      const dlg = await page.evaluate(() => {
        const d = document.querySelector('[role="alertdialog"],[role="dialog"]');
        return d ? { open: true, buttons: [...d.querySelectorAll("button")].map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim().slice(0, 40)) } : { open: false };
      });
      out.phases.execConfirmDialog = dlg;
      say(`[kbd] confirm dialog: ${JSON.stringify(dlg)}`);
      // keyboard: confirm button is likely last; Tab until inside dialog on confirm-like button then Enter
      let confirmed = false;
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        await delay(60);
        const info = await page.evaluate(ACTIVE);
        if (info.inDialog && info.tag === "button" && !/cancel|close/i.test(info.name) && !/^×/.test(info.name)) {
          await page.keyboard.press("Enter");
          confirmed = true;
          out.phases.confirmStop = { tabs: i + 1, name: info.name };
          break;
        }
      }
      if (!confirmed) say("[kbd] WARN: no confirm button reached by keyboard");
      await delay(2500);
    }
    let executed = null;
    for (let i = 0; i < 15 && !executed; i++) {
      const ags = await c.query("agreements:listAgreements", { projectId: F.alpha.projectId });
      executed = ags.find((a) => a.status === "executed") || null;
      if (!executed) await delay(1000);
    }
    out.phases.executedAgreement = executed ? { id: executed._id, number: executed.agreementNumber, status: executed.status } : null;
    say(`[kbd] executed agreement: ${JSON.stringify(out.phases.executedAgreement)}`);
    await shot(page, "fix4-qa10-08-keyboard-after-execute.png");

    out.verdict = {
      keyboardOnlyInputs: true,
      projectSelected: !!selected,
      awardCompleted: !!agreement,
      executionCompleted: !!executed,
    };
    writeEvidence("keyboard-lifecycle", out);
    writeLog("keyboard-lifecycle", log);
    console.log(`VERDICT: ${JSON.stringify(out.verdict)}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });