import { launchBrowser, waitForAppReady, writeJson, shot, delay, BASE_URL } from "./lib.mjs";
import { SCAN, FIELD_AUDIT } from "./qa2-lib.mjs";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = { url: BASE_URL, cases: {} };
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(900);

    const clickTab = async (label) => {
      await page.evaluate((t) => {
        const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes(t) || (x.innerText || "").includes(t));
        if (b) b.click();
      }, label);
      await delay(600);
    };
    const clickText = async (text, exact) => {
      const r = await page.evaluate(
        (t, ex) => {
          const el = [...document.querySelectorAll("button")].find((b) => (ex ? (b.innerText || "").trim() === t : (b.innerText || "").includes(t)));
          if (!el) return null;
          el.scrollIntoView({ block: "center" });
          const rr = el.getBoundingClientRect();
          return { x: rr.left + rr.width / 2, y: rr.top + rr.height / 2 };
        },
        text,
        !!exact
      );
      if (r) await page.mouse.click(r.x, r.y);
      return !!r;
    };
    const closeTop = async (label) => {
      await page.keyboard.press("Escape");
      await delay(300);
      const still = await page.evaluate(() => [...document.querySelectorAll("div.fixed.inset-0")].filter((o) => o.getBoundingClientRect().width > 0).length);
      if (still > 0) {
        const target = await page.evaluate((l) => {
          const overlays = [...document.querySelectorAll("div.fixed.inset-0")].filter((o) => o.getBoundingClientRect().width > 0);
          const scope = overlays[overlays.length - 1] || document;
          const b = [...scope.querySelectorAll("button")].find((x) => ((x.getAttribute("aria-label") || "") + " " + (x.innerText || "")).includes(l));
          if (!b) return null;
          const rr = b.getBoundingClientRect();
          return { x: rr.left + rr.width / 2, y: rr.top + rr.height / 2 };
        }, label);
        if (target) await page.mouse.click(target.x, target.y);
        else await page.keyboard.press("Escape");
      }
      await delay(350);
    };

    const capture = async (id) => {
      await delay(400);
      const scan = await page.evaluate(SCAN);
      const fields = await page.evaluate(FIELD_AUDIT);
      const dlg = await page.$('[role="dialog"],[role="alertdialog"]');
      let ax = [];
      try {
        const snap = dlg ? await page.accessibility.snapshot({ root: dlg }) : await page.accessibility.snapshot({ interestingOnly: true });
        const walk = (n) => {
          if (!n) return;
          if (["button", "link", "combobox", "textbox", "checkbox"].includes(n.role)) ax.push({ role: n.role, name: n.name, focused: n.focused, disabled: n.disabled });
          (n.children || []).forEach(walk);
        };
        walk(snap);
      } catch {}
      await shot(page, `fix4-qa2-modal-${id}.png`);
      out.cases[id] = { scan, fields, ax };
      console.log(`MODAL ${id}: contrastViolations=${scan.totalViolations} (gradientText=${scan.gradientTextCount}) fields=${fields.length} unlabeledProgrammatically=${fields.filter((f) => !f.programmaticName).length} unnamedControls=${ax.filter((a) => !a.name).length}`);
      scan.violations.filter((v) => !v.gradientAncestor).slice(0, 8).forEach((v) => console.log(`   ${v.ratio}:1 ${v.text.slice(0, 60)}`));
      fields.filter((f) => !f.programmaticName).forEach((f) => console.log(`   UNLABELED ${f.tag}[${f.type}] ph="${(f.placeholder || "").slice(0, 40)}"`));
      ax.filter((a) => !a.name).forEach((a) => console.log(`   UNNAMED ${a.role}`));
    };

    await clickText("New Project", true);
    await capture("new-project");
    await closeTop("Cancel");

    await clickTab("01: CSI Scoping");
    await clickText("AI Spec Breakdown", false);
    await capture("ai-spec");
    await closeTop("Close AI specification breakdown dialog");
    await clickText("Create Trade Package", true);
    await capture("create-package");
    await closeTop("Cancel");
    await clickText("Preview", true);
    await capture("files-preview");
    await closeTop("Close document preview");

    await clickTab("02: Discovery");
    await clickText("Add Contractor Manually", true);
    await capture("add-contractor");
    await closeTop("Cancel");
    const editBtn = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button[title="Edit contractor info"]')].find((b) => b.getBoundingClientRect().width > 0);
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const rr = el.getBoundingClientRect();
      return { x: rr.left + rr.width / 2, y: rr.top + rr.height / 2 };
    });
    if (editBtn) {
      await page.mouse.click(editBtn.x, editBtn.y);
      await capture("edit-contractor");
      await closeTop("Cancel");
    }

    await clickTab("04: Bid Leveling");
    await clickText("Ingest Quote / PDF", true);
    await capture("ingest-quote");
    await closeTop("Cancel");

    await clickText("60s Judge Dock", false);
    await capture("judge-dock");
    await closeTop("Close Dock");

    writeJson("fix4-qa2-03b-contrast-modals.json", out);
  } finally {
    await browser.close();
  }
};
run();