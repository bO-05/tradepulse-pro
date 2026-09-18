import { launchBrowser, waitForAppReady, writeJson, shot, delay, BASE_URL } from "./lib.mjs";

const probe = () => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.display !== "none" && cs.visibility !== "hidden";
  };
  const overlays = [...document.querySelectorAll("div.fixed.inset-0")].filter(visible).map((o) => ({
    z: getComputedStyle(o).zIndex,
    role: o.getAttribute("role"),
    cls: (o.className || "").toString().slice(0, 120),
  }));
  const ds = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(visible);
  const d = ds[ds.length - 1] || null;
  const nameOf = (el) => {
    if (!el) return "(none)";
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const lb = el.getAttribute("aria-labelledby");
    if (lb) return lb.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ").trim();
    const t = (el.innerText || "").trim().replace(/\s+/g, " ");
    return t ? t.slice(0, 80) : (el.getAttribute("title") || el.getAttribute("placeholder") || "").trim();
  };
  const active = document.activeElement;
  return {
    overlayCount: overlays.length,
    overlays,
    hasDialogRole: !!d,
    dialogRole: d ? d.getAttribute("role") : null,
    ariaModal: d ? d.getAttribute("aria-modal") : null,
    labelledbyResolved: d ? nameOf(d).slice(0, 100) : null,
    ariaLabel: d ? d.getAttribute("aria-label") : null,
    activeTag: active ? active.tagName.toLowerCase() : null,
    activeName: nameOf(active),
    activeInsideDialog: d ? d.contains(active) : false,
    activeInOverlay: overlays.length ? (() => { const last = [...document.querySelectorAll("div.fixed.inset-0")].filter(visible).pop(); return last ? last.contains(active) : false; })() : false,
    bodyOverflow: getComputedStyle(document.body).overflow,
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    mainInert: document.querySelector("main") ? document.querySelector("main").hasAttribute("inert") : null,
    mainAriaHidden: document.querySelector("main") ? document.querySelector("main").getAttribute("aria-hidden") : null,
    headerAriaHidden: document.querySelector("header") ? document.querySelector("header").getAttribute("aria-hidden") : null,
  };
};

const axButtons = async (page, rootHandle) => {
  try {
    const snap = await page.accessibility.snapshot(rootHandle ? { root: rootHandle } : {});
    const out = [];
    const walk = (n) => {
      if (!n) return;
      if (["button", "link", "combobox", "textbox", "checkbox", "menuitem", "tab"].includes(n.role)) {
        out.push({ role: n.role, name: n.name, value: n.value, disabled: n.disabled, focused: n.focused });
      }
      (n.children || []).forEach(walk);
    };
    walk(snap);
    return out;
  } catch {
    return [];
  }
};

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const out = { url: BASE_URL, viewport: "1440x900", cases: {} };
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(900);

    const clickTab = async (label) => {
      await page.evaluate((t) => {
        const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes(t) || (x.innerText || "").includes(t));
        if (b) b.click();
      }, label);
      await delay(650);
    };

    const findRect = async (sel) =>
      page.evaluate((s) => {
        const els = [...document.querySelectorAll(s)];
        const el = els.find((e) => e.getBoundingClientRect().width > 0);
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().slice(0, 80), tag: el.tagName.toLowerCase() };
      }, sel);

    const byText = async (text, exact) =>
      page.evaluate(
        (t, ex) => {
          const els = [...document.querySelectorAll("button")];
          const el = els.find((b) => {
            const s = (b.innerText || "").trim();
            return ex ? s === t : s.includes(t);
          });
          if (!el) return null;
          el.scrollIntoView({ block: "center" });
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().slice(0, 80) };
        },
        text,
        !!exact
      );

    const findIn = async (containerSel, text) =>
      page.evaluate(
        (cs, t) => {
          const c = document.querySelector(cs);
          if (!c) return null;
          const el = [...c.querySelectorAll("button")].find((b) => ((b.getAttribute("aria-label") || "") + (b.getAttribute("title") || "") + (b.innerText || "")).includes(t));
          if (!el) return null;
          el.scrollIntoView({ block: "center" });
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().slice(0, 80) };
        },
        containerSel,
        text
      );

    const dialogCase = async (id, openFn, opts = {}) => {
      const rec = { id, steps: [] };
      const opened = await openFn();
      rec.opener = opened;
      await delay(500);
      rec.open = await page.evaluate(probe);
      rec.ax = await axButtons(page);
      await shot(page, `fix4-qa2-dialog-${id}-open.png`);
      const stops = [];
      let outside = 0;
      for (let i = 0; i < (opts.tabs || 28); i++) {
        await page.keyboard.press("Tab");
        await delay(25);
        const s = await page.evaluate(probe);
        const inD = s.activeInsideDialog || s.activeInOverlay;
        if (!inD) outside++;
        stops.push({ name: s.activeName.slice(0, 70), tag: s.activeTag, zone: inD ? "inside" : "OUTSIDE", tagName: s.activeTag });
        if (opts.stopAfterOutside && outside >= 2) break;
      }
      rec.tabStops = stops;
      rec.tabOutsideCount = outside;
      const esc = opts.escape === false ? null : await (async () => {
        await page.keyboard.press("Escape");
        await delay(400);
        return page.evaluate(probe);
      })();
      rec.afterEscape = esc;
      rec.escapeClosed = esc ? esc.overlayCount === 0 : null;
      if (!esc || esc.overlayCount > 0) {
        rec.closedByButton = await (async () => {
          const before = await page.evaluate(probe);
          if (opts.cancel) {
            const target = await page.evaluate((label) => {
              const wants = (b) => {
                const s = ((b.getAttribute("aria-label") || "") + " " + (b.getAttribute("title") || "") + " " + (b.innerText || "")).trim();
                return s.includes(label);
              };
              const overlays = [...document.querySelectorAll("div.fixed.inset-0")].filter((o) => o.getBoundingClientRect().width > 0);
              const top = overlays[overlays.length - 1];
              const scope = top || document;
              const el = [...scope.querySelectorAll("button")].find(wants);
              if (!el) return null;
              el.scrollIntoView({ block: "center" });
              const r = el.getBoundingClientRect();
              return { x: r.left + r.width / 2, y: r.top + r.height / 2, label };
            }, opts.cancel);
            if (target) await page.mouse.click(target.x, target.y);
          }
          await delay(400);
          return { before: before.overlayCount, after: await page.evaluate(probe) };
        })();
      }
      await delay(250);
      rec.afterClose = await page.evaluate(probe);
      rec.focusRestored = await page.evaluate(
        (expected) => {
          const a = document.activeElement;
          if (!a) return { restored: false, active: null };
          const label = (a.getAttribute("aria-label") || (a.innerText || "").trim() || a.getAttribute("title") || "").slice(0, 80);
          return { restored: label.includes(expected) || (expected || "").includes(label), active: label };
        },
        opened ? opened.name : ""
      );
      await shot(page, `fix4-qa2-dialog-${id}-after.png`);
      out.cases[id] = rec;
      console.log(
        `DIALOG ${id}: role=${rec.open.dialogRole} ariaModal=${rec.open.ariaModal} overlay=${rec.open.overlayCount} active="${rec.open.activeName.slice(0, 40)}" inside=${rec.open.activeInsideDialog} tabOutside=${outside} escapeClosed=${rec.escapeClosed} focusRestored=${rec.focusRestored.restored}`
      );
      return rec;
    };

    await dialogCase("new-project", async () => {
      const r = await byText("New Project", true);
      await page.mouse.click(r.x, r.y);
      return r;
    }, { cancel: "Cancel" });

    await clickTab("01: CSI Scoping");
    await dialogCase("ai-spec", async () => {
      const r = await byText("AI Spec Breakdown", false);
      await page.mouse.click(r.x, r.y);
      return r;
    }, { cancel: "Close AI specification breakdown" });
    await dialogCase("create-package", async () => {
      const r = await byText("Create Trade Package", true);
      await page.mouse.click(r.x, r.y);
      return r;
    }, { cancel: "Cancel" });
    await dialogCase("confirm-delete-package", async () => {
      const r = await findRect('button[title="Delete Trade Package"]');
      await page.mouse.click(r.x, r.y);
      return r;
    }, { cancel: "Cancel" });
    await dialogCase("files-preview", async () => {
      const r = await byText("Preview", true);
      await page.mouse.click(r.x, r.y);
      return r;
    }, { cancel: "Close document preview" });

    await clickTab("02: Discovery");
    await dialogCase("add-contractor", async () => {
      const r = await byText("Add Contractor Manually", true);
      await page.mouse.click(r.x, r.y);
      return r;
    }, { cancel: "Cancel" });
    await dialogCase("edit-contractor", async () => {
      const r = await findRect('button[title="Edit contractor info"]');
      await page.mouse.click(r.x, r.y);
      return r;
    }, { cancel: "Cancel" });

    await clickTab("04: Bid Leveling");
    await dialogCase("ingest-quote", async () => {
      const r = await byText("Ingest Quote / PDF", true);
      await page.mouse.click(r.x, r.y);
      return r;
    }, { cancel: "Cancel" });

    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(300);
    const judgeOpened = await dialogCase("judge-dock", async () => {
      const r = await byText("60s Judge Dock", false);
      await page.mouse.click(r.x, r.y);
      return r;
    });
    const resetBtn = await findIn('[role="dialog"]', "Reset Demo Data");
    if (resetBtn) {
      await page.mouse.click(resetBtn.x, resetBtn.y);
      await delay(400);
      const confirm = { opener: resetBtn };
      const open = await page.evaluate(probe);
      const stops = [];
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press("Tab");
        await delay(25);
        const s = await page.evaluate(probe);
        stops.push({ name: s.activeName.slice(0, 70), inside: s.activeInsideDialog || s.activeInOverlay });
      }
      await shot(page, "fix4-qa2-dialog-judge-reset-confirm-open.png");
      await page.keyboard.press("Escape");
      await delay(400);
      const afterEscape = await page.evaluate(probe);
      const restored = await page.evaluate((expected) => {
        const a = document.activeElement;
        const label = a ? (a.getAttribute("aria-label") || (a.innerText || "").trim() || a.getAttribute("title") || "").slice(0, 80) : null;
        return { active: label, restored: !!label && label.includes(expected) };
      }, resetBtn.name);
      await shot(page, "fix4-qa2-dialog-judge-reset-confirm-after.png");
      out.cases["judge-reset-confirm"] = { open, stops, tabOutsideCount: stops.filter((s) => !s.inside).length, afterEscape, escapeClosed: afterEscape.overlayCount > 0, restored, opener: resetBtn };
      console.log(`DIALOG judge-reset-confirm: role=${open.dialogRole} ariaModal=${open.ariaModal} overlay=${open.overlayCount} tabOutside=${stops.filter((s) => !s.inside).length} escapeClosed=${afterEscape.overlayCount > 0} focusRestored=${restored.restored} (active="${restored.active}")`);
      await page.keyboard.press("Escape");
      await delay(300);
    }
    const afterJudgeEsc = await page.evaluate(probe);
    console.log(`JUDGE DOCK after own Escape: overlays=${afterJudgeEsc.overlayCount} focusRestoredToOpener(60s Judge Dock)=${(await page.evaluate(() => { const a = document.activeElement; return a ? ((a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 60)) : null; })).includes("Judge Dock")}`);
    out.judgeAfterClose = afterJudgeEsc;
    writeJson("fix4-qa2-02-dialogs.json", out);
  } finally {
    await browser.close();
  }
};
run();