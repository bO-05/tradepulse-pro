/**
 * QA20-05 a11y + double-click race + responsive checks on the newest surfaces
 * (leveling contract viewer, void confirm, inline errors) with the journey fixture.
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, shot, delay, setViewport } from "./lib.mjs";
import { client, readEvidence, readEvidence as re, writeEvidence, writeLog, sleep } from "./qa20-lib.mjs";

const F = readEvidence("fixtures");
const c = client();
const BASE = "https://brainy-skunk-440.convex.site";
const J = F.journey;
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 800)}`);
};

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function contrast(rgb1, rgb2) {
  const L1 = 0.2126 * channel(rgb1[0]) + 0.7152 * channel(rgb1[1]) + 0.0722 * channel(rgb1[2]);
  const L2 = 0.2126 * channel(rgb2[0]) + 0.7152 * channel(rgb2[1]) + 0.0722 * channel(rgb2[2]);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}
function parseRgb(s) {
  const m = String(s).match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

async function clickTab(page, label) {
  await page.evaluate((t) => {
    const b = [...document.querySelectorAll("header button")].find((x) => (x.getAttribute("title") || "").includes(t) || (x.innerText || "").includes(t));
    b?.click();
  }, label);
  await delay(1700);
}
async function realMouseClickText(page, needle) {
  const box = await page.evaluate((n) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const b = [...document.querySelectorAll("button")].find((x) => vis(x) && (x.innerText || "").includes(n));
    if (!b) return null;
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (b.innerText || "").replace(/\s+/g, " ").trim() };
  }, needle);
  if (!box) return { ok: false };
  await page.mouse.click(box.x, box.y);
  return { ok: true, text: box.text };
}
async function domClickText(page, needle) {
  return page.evaluate((n) => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const b = [...document.querySelectorAll("button")].find((x) => vis(x) && (x.innerText || "").includes(n));
    if (!b) return false;
    b.click();
    return true;
  }, needle);
}
const LEVEL_DRAFT = /A401-style Subcontract Draft/;
async function levelingViewer(page) {
  return page.evaluate((draftRe) => {
    const re = new RegExp(draftRe);
    const overlays = [...document.querySelectorAll("div.fixed.inset-0")].filter((d) => d.getBoundingClientRect().width > 1 && re.test(d.innerText || ""));
    const ov = overlays[overlays.length - 1] || null;
    if (!ov) return { open: false };
    const inner = ov.querySelector("div");
    return {
      open: true,
      role: inner?.getAttribute("role") || null,
      ariaModal: inner?.getAttribute("aria-modal") || null,
      ariaLabelledby: inner?.getAttribute("aria-labelledby") || null,
      buttons: [...ov.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()).slice(0, 14),
      isDialogRole: !!inner && inner.getAttribute("role") === "dialog",
    };
  }, LEVEL_DRAFT.source);
}
async function focusInsideLeveling(page) {
  return page.evaluate((draftRe) => {
    const re = new RegExp(draftRe);
    const el = document.activeElement;
    if (!el) return { tag: "NONE" };
    const ov = el.closest("div.fixed.inset-0");
    return {
      tag: el.tagName,
      text: (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 60),
      insideViewer: Boolean(ov && re.test(ov.innerText || "")),
    };
  }, LEVEL_DRAFT.source);
}
async function focusInfo(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    return el ? { tag: el.tagName, text: (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 70) } : { tag: "NONE" };
  });
}
async function dialogState(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
    const ds = [...document.querySelectorAll('[role="alertdialog"]')].filter(vis);
    const top = ds[ds.length - 1] || null;
    return top ? { open: true, title: (top.querySelector("h2") || {}).innerText || "", alert: top.querySelector('[role="alert"]')?.innerText || null, buttons: [...top.querySelectorAll("button")].map((b) => (b.innerText || "").trim()) } : { open: false };
  });
}
async function poll(fn, pred, timeout = 25000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await fn();
    if (pred(last)) return last;
    await sleep(600);
  }
  return last;
}
async function agreementState() {
  const agrs = (await c.query("agreements:listAgreements", { projectId: J.id })) || [];
  return agrs.filter((a) => a.tradePackageId === J.packageId).map((a) => ({ id: a._id, status: a.status, num: a.agreementNumber }));
}

async function main() {
  const { browser } = await launchBrowser(1440, 950);
  const page = await browser.newPage();
  const diag = attachDiagnostics(page);
  await page.goto(`${BASE}/?project=${J.id}&tab=leveling&qa20=a11y`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForAppReady(page, 60000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Close Demo Tour") || (x.textContent || "").trim() === "Dismiss");
    b?.click();
  });
  await delay(1200);

  // ---- A: leveling contract viewer a11y ----
  let openViewer = false;
  for (let i = 0; i < 12 && !openViewer; i++) {
    openViewer = await domClickText(page, "Inspect Draft");
    if (!openViewer) await delay(1000);
    else await delay(1200);
  }
  if (!openViewer) {
    say(`leveling body dump: ${(await page.evaluate(() => (document.querySelector("main") || document.body).innerText)).slice(0, 600).replace(/\n/g, " | ")}`);
  }
  const lv = await levelingViewer(page);
  const lvButtons = lv.buttons || [];
  // focus first control inside viewer then tab to see if focus escapes
  await page.evaluate((draftRe) => {
    const re = new RegExp(draftRe);
    const ov = [...document.querySelectorAll("div.fixed.inset-0")].find((d) => d.getBoundingClientRect().width > 1 && re.test(d.innerText || ""));
    const b = ov && ov.querySelector("button");
    b?.focus();
  }, LEVEL_DRAFT.source);
  const escapeTest = [];
  await page.keyboard.press("Escape");
  await delay(600);
  const afterEscapeOpen = await levelingViewer(page);
  escapeTest.push({ key: "Escape", stillOpen: afterEscapeOpen.open });
  const tabSeq = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    tabSeq.push(await focusInsideLeveling(page));
  }
  const escapedFocus = tabSeq.filter((s) => !s.insideViewer).length;
  await shot(page, "fix4-qa20-a11y-leveling-viewer.png");
  record(
    "A20-05.1",
    "leveling contract viewer exposes dialog role + Escape + focus trap",
    openViewer && lv.open && lv.isDialogRole && lv.ariaModal === "true" && !afterEscapeOpen.open && escapedFocus === 0,
    { openViewer, viewer: { role: lv.role, ariaModal: lv.ariaModal, ariaLabelledby: lv.ariaLabelledby, buttons: lvButtons }, afterEscapeOpen: afterEscapeOpen.open, tabStops: tabSeq.length, focusEscapes: escapedFocus, firstTab: tabSeq.slice(0, 4) }
  );
  await domClickText(page, "Close Viewer");
  await delay(1000);

  // ---- B: contracts viewer + ConfirmDialog focus ----
  await clickTab(page, "Subcontracts");
  await delay(1200);
  await page.evaluate(() => {
    // natural focus on the trigger before the real mouse click
    const b = [...document.querySelectorAll("button")].find((x) => /Inspect Draft/.test(x.innerText || ""));
    b?.focus();
  });
  const exec1 = await realMouseClickText(page, "Inspect Draft");
  await delay(1200);
  const contractsViewer = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /Subcontract Draft/.test(x.innerText || ""));
    return d ? { role: d.getAttribute("role"), ariaModal: d.getAttribute("aria-modal"), labelledby: d.getAttribute("aria-labelledby") } : null;
  });
  const exec2 = await realMouseClickText(page, "Record External Execution");
  await delay(900);
  const focusOnDialogOpen = await focusInfo(page);
  await page.keyboard.press("Escape");
  await delay(700);
  const dlgAfterEsc = await dialogState(page);
  const focusAfterEsc = await focusInfo(page);
  record(
    "A20-05.2",
    "contracts viewer is a dialog; execute confirm focuses Cancel, Escape closes and restores focus",
    Boolean(contractsViewer?.role === "dialog") && exec2.ok && focusOnDialogOpen.text === "Cancel" && !dlgAfterEsc.open && /Record External Execution/.test(focusAfterEsc.text),
    { contractsViewer, exec2, focusOnDialogOpen, afterEsc: { open: dlgAfterEsc.open, focus: focusAfterEsc } }
  );

  // execute for real (mouse double-click on confirm to race it)
  const exec3 = await realMouseClickText(page, "Record External Execution");
  await delay(800);
  const confirmBox = await page.evaluate(() => {
    const ds = [...document.querySelectorAll('[role="alertdialog"]')].filter((d) => d.getBoundingClientRect().width > 1);
    const top = ds[ds.length - 1];
    if (!top) return null;
    const b = [...top.querySelectorAll("button")].find((x) => /Record execution/.test(x.innerText || ""));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: b.disabled };
  });
  if (confirmBox) {
    await page.mouse.click(confirmBox.x, confirmBox.y);
    await page.mouse.click(confirmBox.x, confirmBox.y); // double-click race
  }
  const execState = await poll(agreementState, (s) => s.some((a) => a.status === "executed"), 30000);
  await delay(1800);
  const afterRace = await agreementState();
  const auditCount = await page.evaluate(async () => 0);
  await shot(page, "fix4-qa20-a11y-executed.png");
  record(
    "A20-05.3",
    "double-click confirm executes once and leaves one executed agreement",
    exec3.ok && execState.some((a) => a.status === "executed") && afterRace.filter((a) => a.status === "executed").length === 1 && afterRace.length === 1,
    { exec3, afterRace }
  );

  // ---- C: executed-bid revision via UI error text ----
  await clickTab(page, "Bid Leveling");
  await delay(1600);
  const ingestOpen = await domClickText(page, "Ingest Quote");
  await delay(1200);
  const modalInfo = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /Ingest/.test(x.innerText || ""));
    return d ? { found: true, selects: [...d.querySelectorAll("select")].map((s) => s.getAttribute("aria-label") || s.id), fields: [...d.querySelectorAll("input,textarea")].map((i) => i.getAttribute("aria-label")) } : { found: false };
  });
  let ingestResult = null;
  if (modalInfo.found) {
    ingestResult = await page.evaluate((targetBidName) => {
      const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /Ingest/.test(x.innerText || ""));
      const sel = [...d.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent.includes(targetBidName)));
      if (!sel) return { ok: false, reason: "contractor select not found", selectLabels: [...d.querySelectorAll("select")].map((s) => s.getAttribute("aria-label")) };
      const target = [...sel.options].find((o) => o.textContent.includes(targetBidName));
      sel.value = target.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, selected: target.textContent.trim() };
    }, "AUDIT-QA20 Alpha Electric");
    if (ingestResult.ok) {
      await delay(600);
      const quote = "PROPOSAL AND QUOTATION\nBase Bid Price: $1,180,000.00\nRevised quote for executed contract test.";
      const setRes = await page.evaluate((q) => {
        const ta = [...document.querySelectorAll("textarea")].find((t) => /proposal|quote/i.test(t.getAttribute("aria-label") || "") || (t.closest('[role="dialog"]') && t.getBoundingClientRect().width > 1));
        if (!ta) return { ok: false };
        const proto = HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(ta, q);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, label: ta.getAttribute("aria-label") };
      }, quote);
      ingestResult.setText = setRes;
    }
    if (ingestResult.ok) {
      const submit = await domClickText(page, "Extract");
      await delay(6000);
      const toast = await page.evaluate(() => {
        const st = [...document.querySelectorAll('[role="status"]')].filter((e) => (e.innerText || "").trim());
        return st.length ? st[st.length - 1].innerText.trim() : null;
      });
      const inline = await page.evaluate(() => {
        const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /Ingest/.test(x.innerText || ""));
        return d ? d.querySelector('[role="alert"]')?.innerText?.trim() || null : null;
      });
      ingestResult.submit = submit;
      ingestResult.toast = toast;
      ingestResult.inline = inline;
    }
  }
  await shot(page, "fix4-qa20-a11y-ingest-executed.png");
  const errorText = `${ingestResult?.inline || ""} ${ingestResult?.toast || ""}`.trim();
  record(
    "A20-05.4",
    "executed-bid revision refusal shows the actual reason (not a redacted Server Error)",
    Boolean(ingestResult?.ok) && /immutable|amendment/i.test(errorText) && !/Server Error/i.test(errorText),
    { modalInfo, ingestResult }
  );
  await page.keyboard.press("Escape");
  await delay(600);
  await domClickText(page, "Close");
  await delay(500);

  // ---- D: contrast on newest buttons (contracts register) ----
  await clickTab(page, "Subcontracts");
  await delay(1400);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Inspect Draft/.test(x.innerText || ""));
    b?.click();
  });
  await delay(1300);
  const contrastReport = await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 1;
    const targets = ["Inspect Draft", "Record Execution Status", "Record External Execution", "Void execution record", "Adjust Leveling", "Unaward"];
    const seen = new Set();
    const out = [];
    for (const name of targets) {
      const b = [...document.querySelectorAll("button")].find((x) => vis(x) && (x.innerText || "").replace(/\s+/g, " ").trim() === name);
      if (!b || seen.has(name)) continue;
      seen.add(name);
      const cs = getComputedStyle(b);
      out.push({ name, bg: cs.backgroundColor, color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight });
    }
    return out;
  });
  const contrastRows = contrastReport.map((r) => {
    const bg = parseRgb(r.bg);
    const fg = parseRgb(r.color);
    return { ...r, ratio: bg && fg ? Number(contrast(bg, fg).toFixed(2)) : null };
  });
  record(
    "A20-05.5",
    "newest action buttons meet WCAG AA contrast (>=4.5 for small text)",
    contrastRows.length >= 3 && contrastRows.every((r) => r.ratio === null || r.ratio >= 4.5),
    { contrastRows }
  );

  // ---- E: 375 and 200% responsive on viewer + void confirm ----
  const responsive = [];
  for (const vp of [{ w: 375, h: 812, tag: "375px" }, { w: 720, h: 950, tag: "200pct" }]) {
    await setViewport(page, vp.w, vp.h);
    await delay(700);
    const viewer = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].filter((x) => /Subcontract Draft/.test(x.innerText || "") && x.getBoundingClientRect().width > 1);
      const el = d[d.length - 1] || null;
      return el ? { open: true, w: el.getBoundingClientRect().width, viewport: window.innerWidth } : { open: false };
    });
    if (viewer.open) {
      await domClickText(page, "Void execution record");
      await delay(800);
      const dialog = await page.evaluate(() => {
        const ds = [...document.querySelectorAll('[role="alertdialog"]')].filter((d) => d.getBoundingClientRect().width > 1);
        const top = ds[ds.length - 1];
        if (!top) return { open: false };
        const r = top.getBoundingClientRect();
        return { open: true, w: r.width, left: r.left, right: r.right, viewport: window.innerWidth, overflowX: document.documentElement.scrollWidth > window.innerWidth, buttons: [...top.querySelectorAll("button")].map((b) => { const br = b.getBoundingClientRect(); return { t: (b.innerText || "").trim(), right: br.right, left: br.left }; }) };
      });
      await shot(page, `fix4-qa20-responsive-${vp.tag}-void.png`);
      await page.keyboard.press("Escape");
      await delay(500);
      responsive.push({ tag: vp.tag, viewer, voidDialog: dialog });
    } else {
      responsive.push({ tag: vp.tag, viewer });
    }
  }
  const responsiveFail = responsive.some((r) => r.voidDialog?.open && (r.voidDialog.overflowX || (r.voidDialog.buttons || []).some((b) => b.right > r.voidDialog.viewport + 1 || b.left < -1)));
  record("A20-05.6", "375px and ~200% zoom: void confirm fits without horizontal overflow", !responsiveFail, { responsive });
  await setViewport(page, 1440, 950);

  const outDiag = { pageErrors: diag.pageErrors.slice(0, 10), consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").map((e) => e.text.slice(0, 200)).slice(-10) };
  writeEvidence("a11y-races", { results, outDiag, summary: { pass: results.filter((r) => r.pass).length, total: results.length } });
  writeLog("a11y-races", log);
  await browser.close();
  console.log(`a11y/races: ${results.filter((r) => r.pass).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("a11y-races-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});