import fs from "node:fs";
import path from "node:path";
import {
  launchBrowser, attachDiagnostics, waitForAppReady, shot, writeJson, delay, getSelectorState,
} from "./lib.mjs";

const EV = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/evidence";
const DL = path.join(EV, "downloads-after");
fs.mkdirSync(DL, { recursive: true });
const FIXTURE = "AUDIT-AFTER-2026-09-17";

const run = async () => {
  const { browser } = await launchBrowser(1440, 900);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  const results = {};
  const client = await page.target().createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL }).catch(() => {});

  const clickTab = async (prefix) => {
    await page.evaluate((p) => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(p));
      b?.click();
    }, prefix);
    await delay(900);
  };
  const clickByText = async (t, exact = false) => page.evaluate(({ t, exact }) => {
    const b = [...document.querySelectorAll("button")].find((x) => { const s = (x.textContent || "").trim(); return exact ? s === t : s.includes(t); });
    if (!b) return { ok: false };
    b.click();
    return { ok: true, text: (b.textContent || "").trim() };
  }, { t, exact });

  try {
    await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page);
    await delay(1500);

    // ============ BUG-06 / BUG-18 / BUG-26 (demo KPI reconciliation)
    results["BUG-06/18/26"] = await page.evaluate(() => {
      const t = document.body.innerText;
      const kpi = t.match(/(\d+) Deceptive Bid[s]? Caught/);
      return {
        leveledBuyoutLabel: /Leveled Buyout: \$[\d,]+\(best bid per package\)/.test(t),
        gapsExposed: (t.match(/Gaps Exposed: \+?\$([\d,]+)/) || [])[1] || null,
        deceptive: kpi ? kpi[1] : null,
        buyout: (t.match(/Buyout: (\d+)\/(\d+) Awarded/) || []).slice(1),
        stepper: (t.match(/(\d+)\/(\d+) Awarded/) || []).slice(1),
      };
    });
    await shot(page, "after-kpi-demo.png");

    // ============ BUG-36 tour live figures on demo
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Demo Tour"));
      if (b && !b.className.includes("ring")) b.click();
    });
    await delay(800);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("04:"));
      b?.click();
    });
    await delay(1200);
    results["BUG-36"] = await page.evaluate(() => {
      const t = document.body.innerText;
      const cue = (t.match(/Cue:"?[^\n]{0,320}/) || [])[0] || null;
      return {
        cue,
        claims61k: /\$61,000 cheaper|\$61k-\$96k/.test(t),
        referencesLive: /\$1,253,000|\$1,225,000|No proposals have been leveled/.test(t),
      };
    });
    await shot(page, "after-tour-scene4.png");

    // ============ BUG-17 label
    results["BUG-17"] = await page.evaluate(() => {
      const t = document.body.innerText;
      return { hasNewLabel: t.includes("Simulate Inbound Bid"), hasOldLabel: t.includes("Simulate Inbound Quote") };
    });

    // ============ BUG-35 contrast
    results["BUG-35"] = await page.evaluate(() => {
      const parse = (c) => { const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
      const lum = (rgb) => { const s = rgb.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
      const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
      const blend = (fg, bg) => { const a = fg[3]; return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]; };
      const bgOf = (el) => { let cur = el; while (cur) { const cs = getComputedStyle(cur); if (cs.backgroundColor && !cs.backgroundColor.includes("rgba(0, 0, 0, 0)")) { const bg = parse(cs.backgroundColor); if (bg && bg[3] > 0.9) return bg; } cur = cur.parentElement; } return [10, 15, 29, 1]; };
      const fails = [];
      for (const el of document.querySelectorAll("span,p,div,li,td,th,label,code")) {
        const txt = (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 3)) ? el.innerText : "";
        if (!txt || txt.length > 100) continue;
        const cs = getComputedStyle(el);
        const fg0 = parse(cs.color);
        if (!fg0) continue;
        const fs = parseFloat(cs.fontSize);
        if (fs > 12.5) continue;
        const bg = bgOf(el);
        if (lum(bg) >= 0.5) continue;
        const fg = fg0[3] < 1 ? blend(fg0, bg) : fg0;
        const r = ratio(fg, bg);
        if (r < 4.5) fails.push({ text: txt.slice(0, 50), ratio: Math.round(r * 100) / 100, fontSize: cs.fontSize });
      }
      return { failCount: fails.length, sample: fails.slice(0, 5) };
    });

    // ============ BUG-10 timestamps (audit tab)
    await clickTab("07:");
    await delay(800);
    results["BUG-10"] = await page.evaluate(() => {
      const t = document.body.innerText;
      return { hasFullDate: /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2},\s+\d{4}/.test(t), sample: (t.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2}, \d{4}, [^\n]*/g) || []).slice(0, 3) };
    });
    await shot(page, "after-audit-timestamps.png");

    // ============ BUG-33 focus trap on Judge Dock
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("60s Judge Dock"))?.click(); });
    await delay(900);
    const trail = [];
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      trail.push(await page.evaluate(() => {
        const el = document.activeElement;
        return { inDialog: !!el?.closest('[role="dialog"]'), text: (el?.textContent || el?.getAttribute("title") || "").trim().slice(0, 40) };
      }));
    }
    await page.keyboard.press("Escape");
    await delay(600);
    results["BUG-33"] = {
      escaped: trail.some((t) => !t.inDialog),
      trail: trail.slice(0, 6),
      focusRestored: await page.evaluate(() => (document.activeElement?.textContent || "").includes("60s Judge Dock")),
      dialogClosed: await page.evaluate(() => !document.querySelector('[role="dialog"]')),
    };

    // ============ BUG-34 overflow
    results["BUG-34"] = {};
    for (const w of [375, 640, 768, 1024, 1280, 1440, 1600]) {
      await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
      await delay(500);
      results["BUG-34"][w] = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, overflow: document.documentElement.scrollWidth - window.innerWidth }));
    }
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await delay(400);

    // ============ BUG-01 New Project modal
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click(); });
    await delay(800);
    results["BUG-01"] = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return { dialog: false };
      const r = dlg.getBoundingClientRect();
      const fields = [...dlg.querySelectorAll("input,textarea")].map((f) => { const fr = f.getBoundingClientRect(); return { top: Math.round(fr.top), bottom: Math.round(fr.bottom), visible: fr.top >= 0 && fr.bottom <= window.innerHeight }; });
      return { dialog: true, top: Math.round(r.top), bottom: Math.round(r.bottom), inHeader: !!dlg.closest("header"), allFieldsVisible: fields.every((f) => f.visible), fields };
    });
    await shot(page, "after-BUG01-newproject.png");
    await page.keyboard.press("Escape");
    await delay(400);

    // ============ Fixture project for mutation checks
    await page.evaluate((title) => {
      [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "New Project")?.click();
      setTimeout(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return;
        const inputs = [...dlg.querySelectorAll("input,textarea")];
        const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        iset.call(inputs[0], title); inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      }, 300);
    }, FIXTURE);
    await delay(800);
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create Commercial Project"));
      btn?.click();
    });
    await delay(4500);
    const sel = await getSelectorState(page);
    results.fixture = sel?.options.find((o) => o.text.includes("AUDIT-AFTER")) || null;

    if (results.fixture) {
      await page.evaluate((val) => {
        const s = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
        s.value = val;
        s.dispatchEvent(new Event("change", { bubbles: true }));
      }, results.fixture.value);
      await delay(1500);

      // BUG-02 tour on empty project
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Demo Tour"));
        if (b && !b.className.includes("ring")) b.click();
      });
      await delay(900);
      results["BUG-02"] = await page.evaluate(() => {
        const t = document.body.innerText;
        return {
          metric: (t.match(/\d+ CSI Trade Packages[^\n]*|No packages scoped yet[^\n]*/) || [])[0] || null,
          tourTruthful: /No packages scoped yet|0 CSI Trade Packages/.test(t),
          claims4Verified: t.includes("4 Verified Specialty Contractors"),
        };
      });
      await shot(page, "after-BUG02-empty-tour.png");
      await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour"))?.click(); });
      await delay(400);

      // BUG-04 empty spec submit
      await clickTab("01:");
      await clickByText("AI Spec Breakdown");
      await delay(800);
      results["BUG-04"] = await page.evaluate(() => {
        const h = [...document.querySelectorAll("h3")].find((el) => (el.textContent || "").includes("AI Specification Breakdown"));
        let dlg = h;
        for (let i = 0; i < 8 && dlg && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("textarea")) break; }
        const ta = dlg?.querySelector("textarea");
        const btn = dlg ? [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Auto-Generate Trade Packages")) : null;
        if (ta) { ta.value = "   "; ta.dispatchEvent(new Event("input", { bubbles: true })); }
        return { dialogFound: !!dlg, btnDisabledAfterWhitespace: btn ? btn.disabled : null, buttonText: btn ? btn.textContent.trim() : null };
      });
      await delay(300);
      if (results["BUG-04"].btnDisabledAfterWhitespace === false) {
        await page.evaluate(() => {
          const h = [...document.querySelectorAll("h3")].find((el) => (el.textContent || "").includes("AI Specification Breakdown"));
          let dlg = h;
          for (let i = 0; i < 8 && dlg && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("textarea")) break; }
          const btn = dlg ? [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Auto-Generate Trade Packages")) : null;
          btn?.click();
        });
        await delay(2500);
        results["BUG-04"].dialogStillOpenAfterClick = await page.evaluate(() => [...document.querySelectorAll("h3")].some((el) => (el.textContent || "").includes("AI Specification Breakdown")));
      }
      await page.keyboard.press("Escape");
      await delay(400);

      // Create one package (with select) + one zero-recipient package for BUG-07/13/16
      const createPackage = async (name, csi) => {
        await clickByText("Create Trade Package");
        await delay(700);
        await page.evaluate(({ name, csi }) => {
          const h = [...document.querySelectorAll("h3")].find((el) => (el.textContent || "").includes("Create CSI Trade Package"));
          let dlg = h;
          for (let i = 0; i < 6 && dlg && dlg.parentElement; i++) { dlg = dlg.parentElement; if (dlg.querySelector("input")) break; }
          const iset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          const tset = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
          for (const el of dlg.querySelectorAll("input,textarea")) {
            const label = (el.closest("div")?.querySelector("label")?.textContent || "").toLowerCase();
            if (label.includes("csi division")) { iset.call(el, csi); el.dispatchEvent(new Event("input", { bubbles: true })); }
            if (label.includes("trade package name")) { iset.call(el, name); el.dispatchEvent(new Event("input", { bubbles: true })); }
            if (label.includes("scope summary")) { tset.call(el, "AUDIT verification scope."); el.dispatchEvent(new Event("input", { bubbles: true })); }
          }
        }, { name, csi });
        await delay(300);
        await clickByText("Create Package", true);
        await delay(2500);
      };
      await createPackage("AUDIT-AFTER Electrical", "26 00 00");
      results["BUG-13"] = await page.evaluate(() => {
        const input = document.querySelector("input#convex-file-upload");
        const select = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "spec"));
        select.value = "spec"; select.dispatchEvent(new Event("change", { bubbles: true }));
        return { specAccept: input ? input.getAttribute("accept") : null };
      });
      await delay(400);
      results["BUG-13"].blueprintAccept = await page.evaluate(() => {
        const select = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "blueprint"));
        select.value = "blueprint"; select.dispatchEvent(new Event("change", { bubbles: true }));
        return document.querySelector("input#convex-file-upload")?.getAttribute("accept");
      });
      await delay(300);
      await page.evaluate(() => {
        const select = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "spec"));
        select.value = "spec"; select.dispatchEvent(new Event("change", { bubbles: true }));
      });

      // Upload a normal file
      const normalPath = path.join(EV, "after-upload-normal.txt");
      fs.writeFileSync(normalPath, "AUDIT-AFTER-UPLOAD-PROOF: stored bytes served verbatim. 2026-09-17.");
      const input = await page.$("input#convex-file-upload");
      await input.uploadFile(normalPath);
      const uploadPoll = [];
      for (let i = 0; i < 15; i++) {
        await delay(1000);
        const s = await page.evaluate(() => {
          const t = document.body.innerText;
          return { counter: (t.match(/Project Documents in Convex Storage \((\d+)\)/) || [])[1], row: t.includes("after-upload-normal.txt") };
        });
        uploadPoll.push(s);
        if (s.row) break;
      }
      results["BUG-13"].uploadPoll = uploadPoll;

      // Download it and verify bytes
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("after-upload-normal.txt") && (d.innerText || "").includes("Download"));
        const row = rows[rows.length - 1];
        row ? [...row.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Download"))?.click() : null;
      });
      await delay(4000);
      const dlFiles = fs.existsSync(DL) ? fs.readdirSync(DL) : [];
      const dlTarget = dlFiles.find((f) => f.includes("after-upload-normal"));
      results["BUG-12"] = { downloads: dlFiles, servedTrueBytes: dlTarget ? fs.readFileSync(path.join(DL, dlTarget), "utf8").includes("AUDIT-AFTER-UPLOAD-PROOF") : null };

      // Preview caption
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("after-upload-normal.txt") && (d.innerText || "").includes("Preview"));
        const row = rows[rows.length - 1];
        row ? [...row.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Preview"))?.click() : null;
      });
      await delay(1200);
      results["BUG-14"] = await page.evaluate(() => {
        const t = document.body.innerText;
        return {
          falseClaim: t.includes("100% Real Construction Document Specification"),
          truthfulCaption: /Stored in Convex _storage/.test(t),
          hasStoredText: t.includes("AUDIT-AFTER-UPLOAD-PROOF"),
        };
      });
      await shot(page, "after-BUG14-preview.png");
      await page.keyboard.press("Escape");
      await delay(500);

      // BUG-16 discovery
      await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Discovery")); b?.click(); });
      await delay(900);
      await clickByText("Discover Trade Contractors");
      await delay(35000);
      results["BUG-16"] = await page.evaluate(() => {
        const t = document.body.innerText;
        return {
          claimsVerified: /Active \/ Verified \(TDLR\)/.test(t),
          claims100Tdlr: t.includes("100% TDLR Validated"),
          unverifiedLabels: (t.match(/Unverified[^\n]*/g) || []).slice(0, 5),
          licenseValues: (t.match(/TX-\d{2}-\d{5}/g) || []).slice(0, 5),
          banner: (t.match(/Subcontractors Identified \([^\n]*\)/) || [])[0] || null,
          provenanceNote: t.includes("Provenance shown per record"),
        };
      });
      await shot(page, "after-BUG16-discovery.png", { full: true });

      // BUG-07 zero-recipient dispatch
      await clickTab("01:");
      await createPackage("AUDIT-AFTER Zero Sub", "23 00 00");
      const dispatch = await page.evaluate(() => {
        const cards = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("AUDIT-AFTER Zero Sub") && (d.innerText || "").includes("Dispatch RFQs"));
        const card = cards[cards.length - 1];
        const btn = card ? [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Dispatch RFQs")) : null;
        btn?.click();
        return { clicked: !!btn };
      });
      await delay(6000);
      results["BUG-07"] = await page.evaluate(() => {
        const t = document.body.innerText;
        const toast = document.querySelector('[role="status"]')?.textContent || null;
        const idx = t.indexOf("AUDIT-AFTER Zero Sub");
        return {
          toast,
          toastIsError: toast ? /No RFQ invitations were sent|No contractors/i.test(toast) : null,
          packageStillDraft: idx >= 0 ? /AUDIT-AFTER Zero Sub[\s\S]{0,300}?Draft/.test(t) : null,
        };
      });
      await shot(page, "after-BUG07-zero-dispatch.png");

      // BUG-15 stacked confirms
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll("div")].filter((d) => (d.innerText || "").includes("after-upload-normal.txt"));
        const row = rows[rows.length - 1];
        row ? [...row.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "").includes("Delete file"))?.click() : null;
      });
      await delay(700);
      const firstConfirm = await page.evaluate(() => {
        const d = document.querySelector('[role="alertdialog"]');
        if (!d) return null;
        const r = d.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), z: getComputedStyle(d.parentElement).zIndex, inHeader: !!d.closest("header") };
      });
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Delete custom project"));
        b?.click();
      });
      await delay(800);
      const stacked = await page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"]')].map((d) => {
        const r = d.getBoundingClientRect();
        return { title: (d.querySelector("h2") || {}).textContent, top: Math.round(r.top), bottom: Math.round(r.bottom), z: getComputedStyle(d.parentElement).zIndex, inHeader: !!d.closest("header") };
      }));
      results["BUG-15"] = { firstConfirm, stacked };
      await shot(page, "after-BUG15-stacked.png");
      await page.evaluate(() => {
        for (const d of [...document.querySelectorAll('[role="alertdialog"]')]) {
          [...d.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Cancel")?.click();
        }
      });
      await delay(600);
    }

    // ============ Evals labels (BUG-30/31)
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Evals & Architecture"))?.click(); });
    await delay(1200);
    results["BUG-30/31"] = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        honestTitle: t.includes("Bid Extraction & ADR-0003 Normalization Check"),
        zeroCheatingRemoved: !t.includes("Zero Cheating"),
        parityRemoved: !t.includes("PARITY ACHIEVED"),
        runIdShown: /Run ID: eval_\d+/.test(t),
        runDateShown: /started (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(t),
      };
    });
    await shot(page, "after-evals.png", { full: true });

    results.diag = { consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 10), pageErrors: diag.pageErrors, failedRequests: diag.failedRequests.slice(0, 10) };
    writeJson("fix-verify-after-local.json", results);
  } catch (e) {
    results.error = String(e && e.stack ? e.stack : e);
    writeJson("fix-verify-after-local.json", results);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 2).slice(0, 20000));
};

run();