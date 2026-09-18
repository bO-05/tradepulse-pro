import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, getSelectorState } from "./lib.mjs";
import { ConvexHttpClient } from "convex/browser";

const EV = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/evidence";
const FIXTURE = "AUDIT-5-F3-BEFORE-2026-09-18";
const EMPTY_FIXTURE = "AUDIT-5-EMPTY-2026-09-18";
const R = { startedAt: new Date().toISOString(), fixture: FIXTURE };
const http = new ConvexHttpClient("https://brainy-skunk-440.convex.cloud");

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);

  const clickByText = async (t, exact = false) => page.evaluate(({ t, exact }) => {
    const b = [...document.querySelectorAll("button")].find((x) => { const s = (x.textContent || "").trim(); return exact ? s === t : s.includes(t); });
    if (!b) return { ok: false, available: [...document.querySelectorAll("button")].map((x) => (x.textContent || "").trim()).filter(Boolean).slice(0, 60) };
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    return { ok: true, text: (b.textContent || "").trim(), x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: b.disabled };
  }, { t, exact });
  const realClick = async (t, exact = false) => {
    const b = await clickByText(t, exact);
    if (!b.ok) return b;
    await page.mouse.click(b.x, b.y);
    return b;
  };
  const clickTab = async (prefix) => {
    await page.evaluate((p) => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(p)); b?.click(); }, prefix);
    await delay(700);
  };
  const closeTour = async () => {
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss"); b?.click(); });
    await delay(300);
  };
  const selectProjectByTitle = async (needle) => {
    const res = await page.evaluate((n) => {
      const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
      const o = [...s.options].find((x) => x.textContent.includes(n));
      if (!o) return { ok: false };
      s.value = o.value;
      s.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: o.value, text: o.textContent.trim() };
    }, needle);
    await delay(1800);
    return res;
  };
  const typeInto = async (selector, text) => {
    await page.click(selector);
    await page.keyboard.press("End");
    await page.keyboard.type(text, { delay: 12 });
  };

  try {
    await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1200);
    await closeTour();
    await shot(page, "fix4-before-00-landing.png");

    // ============ F2: zero-bid project (leftover audit project)
    const gc = await selectProjectByTitle("GC-AUDIT");
    R.f2 = { selected: gc };
    R.f2.compactText = await page.evaluate(() => {
      const main = document.querySelector("main");
      return main ? main.innerText.split("\n").slice(0, 12).join(" | ") : null;
    });
    R.f2.bestBidClaim = await page.evaluate(() => document.body.innerText.includes("(best bid per package)"));
    await shot(page, "fix4-before-F2-zero-bids-compact.png");
    await realClick("Expand 6-Card KPI View");
    await delay(500);
    R.f2.expandedText = await page.evaluate(() => {
      const main = document.querySelector("main");
      return main ? main.innerText.split("\n").slice(0, 30).join(" | ") : null;
    });
    await shot(page, "fix4-before-F2-zero-bids-expanded.png");
    await realClick("Compact Mode");
    await delay(400);

    // ============ F3: New Project prefill + append (before)
    R.f3 = {};
    await realClick("New Project");
    await delay(700);
    const dlgState = async () => page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return null;
      const fields = [...dlg.querySelectorAll("input,textarea")].map((el) => ({
        label: (el.closest("div")?.querySelector("label")?.textContent || "").trim(),
        placeholder: el.getAttribute("placeholder"),
        value: el.value,
        type: el.getAttribute("type"),
        max: el.getAttribute("max"),
      }));
      const r = dlg.getBoundingClientRect();
      return { fields, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
    });
    R.f3.initial = await dlgState();
    const locBox = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const i = [...dlg.querySelectorAll("input")].find((x) => (x.getAttribute("placeholder") || "").includes("Austin, TX"));
      i.scrollIntoView({ block: "center" });
      const r = i.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(locBox.x, locBox.y);
    await page.keyboard.press("End");
    await page.keyboard.type("Tampa, FL", { delay: 15 });
    const budBox = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const i = [...dlg.querySelectorAll("input")].find((x) => x.getAttribute("type") === "number");
      i.scrollIntoView({ block: "center" });
      const r = i.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(budBox.x, budBox.y);
    await page.keyboard.press("End");
    await page.keyboard.type("14200000");
    R.f3.afterTyping = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const out = {};
      [...dlg.querySelectorAll("input")].forEach((el) => {
        const label = (el.closest("div")?.querySelector("label")?.textContent || "").trim();
        out[label || el.getAttribute("placeholder") || "?"] = el.value;
      });
      return out;
    });
    await shot(page, "fix4-before-F3-append.png");
    // now fill cleanly with select-all (recovery) and create fixture
    const setField = async (labelFragment, value) => {
      const box = await page.evaluate((frag) => {
        const dlg = document.querySelector('[role="dialog"]');
        const el = [...dlg.querySelectorAll("input,textarea")].find((x) => ((x.closest("div")?.querySelector("label")?.textContent || "") + (x.getAttribute("placeholder") || "")).includes(frag));
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName };
      }, labelFragment);
      if (!box) throw new Error("field not found " + labelFragment);
      await page.mouse.click(box.x, box.y);
      await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
      await page.keyboard.type(String(value), { delay: 8 });
    };
    await setField("Project Title", FIXTURE);
    await setField("Location", "Tampa, FL");
    await setField("Project Type", "Healthcare / Surgical");
    await setField("General Contractor", "AUDIT GC LLC");
    await setField("Estimated Budget", "14200000");
    await setField("Duration", "78");
    const before = await getSelectorState(page);
    const submit = await realClick("Create Commercial Project");
    let created = null;
    for (let i = 0; i < 20; i++) {
      await delay(700);
      const s = await getSelectorState(page);
      created = s.options.find((o) => o.text.includes(FIXTURE));
      if (created) break;
    }
    R.f3.submit = submit;
    R.f3.created = created;
    const projects = await http.query("projects:listProjects", {});
    const fixtureProject = projects.find((p) => p.title.includes(FIXTURE));
    R.f3.backendProject = fixtureProject ? { title: fixtureProject.title, location: fixtureProject.location, projectType: fixtureProject.projectType, gc: fixtureProject.generalContractorName, budget: fixtureProject.estBudget, weeks: fixtureProject.targetCompletionWeeks } : null;
    if (!fixtureProject) throw new Error("F3 fixture not created: " + JSON.stringify(R.f3));

    // ============ empty fixture (for empty-state CTA duplication)
    await selectProjectByTitle("The Domain Tower B");
    await realClick("New Project");
    await delay(600);
    await page.evaluate(() => { const dlg = document.querySelector('[role="dialog"]'); const el = dlg.querySelector("input"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, "AUDIT-5-EMPTY-2026-09-18"); el.dispatchEvent(new Event("input", { bubbles: true })); });
    await realClick("Create Commercial Project");
    await delay(5000);
    await selectProjectByTitle(EMPTY_FIXTURE);
    await delay(1000);
    R.f5 = { emptyStateButtons: await page.evaluate(() => [...document.querySelectorAll("main button")].map((b) => ({ t: (b.textContent || "").trim(), disabled: b.disabled })).filter((b) => /Spec Breakdown|Run AI|Create Trade Package|Advance/i.test(b.t))) };
    await shot(page, "fix4-before-F5-empty-state.png");

    // ============ fixture packages (Div 26 + Div 22)
    await selectProjectByTitle(FIXTURE);
    await delay(1200);
    const createPkg = async (div, name, budget) => {
      await realClick("Create Trade Package");
      await delay(700);
      await setField("CSI Division", div);
      await setField("Trade Package Name", name);
      await setField("Budget Estimate", budget);
      await setField("Scope Summary", "AUDIT-5 scope summary.");
      await realClick("Create Package", true);
      await delay(2800);
    };
    await createPkg("26 00 00", "AUDIT Electrical", "850000");
    await createPkg("22 00 00", "AUDIT Plumbing", "620000");
    const fixturePkgs = await http.query("tradePackages:listByProject", { projectId: fixtureProject._id });
    R.fixturePackages = fixturePkgs.map((p) => ({ id: p._id, div: p.csiDivision, name: p.tradeName, budget: p.budgetEstimate }));

    // select Div 26 package then QnA
    await page.evaluate((div) => {
      const cards = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("AUDIT Electrical") && (d.innerText || "").includes("Dispatch RFQs"));
      const card = cards[cards.length - 1];
      if (card) card.click();
    }, "26");
    await delay(800);
    await clickTab("03:");
    await delay(900);
    R.f6 = { formFields: await page.evaluate(() => [...document.querySelectorAll("form")].slice(-1).map((f) => [...f.querySelectorAll("label")].map((l) => l.textContent.trim()))) };
    R.f6.hasTradeSelectorInForm = await page.evaluate(() => {
      const form = [...document.querySelectorAll("form")].slice(-1)[0];
      return form ? [...form.querySelectorAll("label,select")].some((el) => /trade|division|csi/i.test(el.textContent || "") || /package/i.test(el.getAttribute?.("aria-label") || "")) : null;
    });
    await shot(page, "fix4-before-F6-rfi-form.png");

    // submit a Div-22-topic RFI while Div 26 is active
    const qBox = await page.evaluate(() => {
      const form = [...document.querySelectorAll("form")].slice(-1)[0];
      const ta = form.querySelector("textarea");
      ta.scrollIntoView({ block: "center" });
      const r = ta.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const sBox = await page.evaluate(() => {
      const form = [...document.querySelectorAll("form")].slice(-1)[0];
      const i = form.querySelector('input[type="text"]');
      i.scrollIntoView({ block: "center" });
      const r = i.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(sBox.x, sBox.y);
    await page.keyboard.type("AUDIT Medical gas certification routing", { delay: 6 });
    await page.mouse.click(qBox.x, qBox.y);
    await page.keyboard.type("Our Div 22 plumbing scope includes medical gas rough-in. Does this contract require third-party medical gas certification and who bears the cost?", { delay: 4 });
    const t0 = Date.now();
    await realClick("Submit RFI for Clarification", true);
    let rfiRow = null;
    let rfiWaitMs = null;
    for (let i = 0; i < 90; i++) {
      await delay(2000);
      const convos = await http.query("rfq:listConversations", { tradePackageId: fixturePkgs.find((p) => p.csiDivision.startsWith("26"))._id });
      const found = convos.find((c) => c.inboundSubject.includes("Medical gas certification"));
      if (found) { rfiRow = found; rfiWaitMs = Date.now() - t0; break; }
    }
    R.f6.rfiWaitMs = rfiWaitMs;
    R.f6.rfiStoredOnDiv26 = Boolean(rfiRow);
    R.f6.rfiPackageId = rfiRow?.tradePackageId;
    R.f6.rfiExpectedPackage = fixturePkgs.find((p) => p.csiDivision.startsWith("22"))?._id;
    R.f10 = { reply: rfiRow?.autonomousReply || null, status: rfiRow?.status || null, confidence: rfiRow?.confidenceScore ?? null };
    R.f6.formClearedAfterSubmit = await page.evaluate(() => {
      const form = [...document.querySelectorAll("form")].slice(-1)[0];
      const ta = form.querySelector("textarea");
      return { question: ta.value, pendingPanel: document.body.innerText.includes("RFI submitted. The AI is analyzing") };
    });
    await shot(page, "fix4-before-F6-rfi-result.png");

    // ============ demo: F4, F5, F7, F9, F11, F12, §4 checks
    await selectProjectByTitle("The Domain Tower B");
    await delay(1500);
    await clickTab("04:");
    await delay(1000);
    R.f5.levelingControls = await page.evaluate(() => [...document.querySelectorAll("main button")].map((b) => (b.textContent || "").trim()).filter((t) => /Advance|Skip ahead|Scope Clash|Contracts Register/i.test(t)));
    await shot(page, "fix4-before-F5-leveling-ctas.png");
    const bidsBefore = (await http.query("bids:listAllProjectBids", { projectId: (await http.query("projects:listProjects", {})).find((p) => p.isDemoProject)._id })).length;
    const simBtn = await realClick("Simulate Inbound Bid");
    await delay(900);
    R.f4 = {
      clicked: simBtn,
      dockOpen: await page.evaluate(() => document.body.innerText.includes("60-Second Executive Demo & Simulation Engine")),
      bidCountBefore: bidsBefore,
      emptyStateHint: await page.evaluate(() => document.body.innerText.includes("Simulate Inbound Bid")),
    };
    await shot(page, "fix4-before-F4-simulate-dock.png");
    await page.keyboard.press("Escape");
    await delay(600);

    // F7 contrast on PM Queue button
    await clickTab("03:");
    await delay(900);
    R.f7 = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => /Review PM Queue/.test(b.textContent || ""));
      if (!btn) return { found: false, buttons: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).slice(0, 50) };
      const cs = getComputedStyle(btn);
      const parse = (c) => { const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const fg = parse(cs.color); const bg = parse(cs.backgroundColor);
      let ratio = null;
      if (fg && bg) { const L1 = lum(fg); const L2 = lum(bg); ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); }
      return { found: true, text: btn.textContent.trim(), fontSize: cs.fontSize, color: cs.color, bg: cs.backgroundColor, ratio: ratio ? +ratio.toFixed(2) : null };
    });
    await shot(page, "fix4-before-F7-amber-button.png");

    // F10 existing AI reply formatting
    R.f10.demoReply = await page.evaluate(() => {
      const el = [...document.querySelectorAll("p")].find((p) => (p.innerText || "").includes("RFI SUBJECT:") || (p.innerText || "").includes("Per TradePulse"));
      return el ? el.innerText.slice(0, 400) : null;
    });

    // F9 tour copy
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Demo Tour")); if (b) b.click(); });
    await delay(800);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("01:"))?.click(); });
    await delay(900);
    R.f9 = await page.evaluate(() => {
      const t = document.body.innerText;
      const cue = (t.match(/Cue:[^\n]{0,320}/) || [])[0] || null;
      return { cue, dedicatedVisible: /dedicated/i.test(t), keyMetric: (t.match(/\d+ CSI Trade Packages? •[^\n]*/) || [])[0] || null };
    });
    await shot(page, "fix4-before-F9-tour-copy.png");
    await closeTour();

    // F11 trade selector inventory on each stage
    const selectorInventory = {};
    for (const prefix of ["01:", "02:", "03:", "04:"]) {
      await clickTab(prefix);
      await delay(700);
      selectorInventory[prefix] = await page.evaluate(() => {
        const out = [];
        [...document.querySelectorAll("main button, main select")].forEach((el) => {
          const t = (el.textContent || "").trim().slice(0, 80);
          const aria = el.getAttribute?.("aria-label") || "";
          if (/Select Trade|CSI \d{2} 00 00|Div \d{2}/i.test(t) || /select.*trade|trade.*package/i.test(aria)) out.push({ tag: el.tagName, text: t, aria });
        });
        return out;
      });
    }
    R.f11 = selectorInventory;

    // F12 buyout usage
    await clickTab("01:");
    await delay(800);
    R.f12 = await page.evaluate(() => {
      const t = document.body.innerText;
      return (t.match(/[^\n]{0,60}Buyout[^\n]{0,60}/g) || []).slice(0, 10);
    });

    // §4.1 modal centering
    await realClick("New Project");
    await delay(600);
    R.s4_modal = await page.evaluate(() => { const r = document.querySelector('[role="dialog"]').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
    await page.keyboard.press("Escape");
    await delay(400);
    R.s4_modal.escapeRestored = await page.evaluate(() => (document.activeElement?.textContent || "").trim().includes("New Project"));

    // §3 whitespace submit disabled (fixture QnA)
    await selectProjectByTitle(FIXTURE);
    await delay(1200);
    await clickTab("03:");
    await delay(800);
    R.s3_whitespace = await page.evaluate(() => {
      const form = [...document.querySelectorAll("form")].slice(-1)[0];
      const submit = form.querySelector('button[type="submit"]');
      return { disabledWhenEmpty: submit.disabled };
    });
    // type spaces only in question
    await page.evaluate(() => {
      const form = [...document.querySelectorAll("form")].slice(-1)[0];
      const ta = form.querySelector("textarea");
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(ta, "   "); ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await delay(300);
    R.s3_whitespace.disabledWhenSpaces = await page.evaluate(() => {
      const form = [...document.querySelectorAll("form")].slice(-1)[0];
      return form.querySelector('button[type="submit"]').disabled;
    });

    // §3 empty auto-scope disabled
    await clickTab("01:");
    await delay(700);
    await realClick("AI Spec Breakdown");
    await delay(700);
    R.s3_emptyAutoScope = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const ta = dlg.querySelector("textarea");
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(ta, ""); ta.dispatchEvent(new Event("input", { bubbles: true }));
      const btn = [...dlg.querySelectorAll("button")].find((b) => /Auto-Generate|Analyzing/i.test(b.textContent || ""));
      return { disabled: btn?.disabled };
    });
    await page.keyboard.press("Escape");
    await delay(400);

    // §4.2 dynamic tour counts
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Demo Tour")); if (b) b.click(); });
    await delay(800);
    R.s4_tourDynamic = await page.evaluate(() => (document.body.innerText.match(/The active project currently has [^\n.]*/) || [])[0] || null);
    await closeTour();

    // §4.10 LD distinction
    await clickTab("04:");
    await delay(800);
    R.s4_ld = await page.evaluate(() => {
      const t = document.body.innerText;
      const i = t.indexOf("schedule-impact rate");
      return i >= 0 ? t.slice(Math.max(0, i - 80), i + 140) : null;
    });

    // Back/Forward URL sync check
    const tabBefore = await page.evaluate(() => location.search);
    await clickTab("06:");
    const tabAfter = await page.evaluate(() => location.search);
    await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
    await delay(900);
    const tabBack = await page.evaluate(() => location.search);
    R.s3_back = { tabBefore, tabAfter, tabBack, urlSynced: tabAfter !== tabBefore };

    R.diag = {
      consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((l) => l.text.slice(0, 160)).slice(0, 10),
      pageErrors: diag.pageErrors.slice(0, 6),
      failedRequests: diag.failedRequests.slice(0, 6),
      requestCount: diag.requests.length,
    };
    writeJson("fix4-before-verification.json", R);
  } catch (e) {
    R.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-before-verification.json", R);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(R, null, 2).slice(0, 20000));
};
run();