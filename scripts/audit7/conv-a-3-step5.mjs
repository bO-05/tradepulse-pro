/**
 * AUDIT7 CONV-A round 1 — Step 5 (honesty guarantees):
 * a) Dispatch RFQs from the Div 22 package card; toast must not claim delivery when the
 *    audit log says 0 of N; card must show "Email delivery unavailable".
 * b) Public-demo banner exists.
 * c) Auto-Scope modal requires a preview confirmation before writing: paste an ambiguous
 *    Div-22 spec, confirm the preview lists detected divisions, click Re-parse and confirm
 *    nothing was written, then Generate.
 */
import fs from "node:fs";
import path from "node:path";
import {
  delay, openApp, q, clickTab, selectProject, clickText, clickTab as _ct, poll,
  writeEvidence, PREFIX, DAILY,
} from "./lib.mjs";

const TITLE = `${PREFIX}CONV-A-${DAILY}`;
const out = {
  startedAt: new Date().toISOString(),
  assertions: {},
  toasts: [],
  auditDelivery: null,
  deliveryStatus: null,
  packageCardText: null,
  preview: null,
  reparse: null,
  generate: null,
};
const evidenceDir = path.join(process.cwd(), "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });

const AMBIG_SPEC = [
  "PROJECT MANUAL - AMBIGUOUS MEP ISSUE SET (AUDIT7 CONV-A probe)",
  "SECTION 22 11 23 - DOMESTIC WATER BOOSTER PUMPS",
  "Furnish a triplex domestic water booster pump skid with factory certified startup and seismic snubbers.",
  "Provide backflow prevention assemblies and municipal inspection certification.",
  "",
  "SECTION 22 13 16 - SANITARY DRAINAGE",
  "Cast iron sanitary waste and vent piping, floor drains, and cleanouts.",
  "",
  "SECTION 23 00 00 - HVAC GENERAL",
  "Rooftop air handling units and VAV terminal boxes with electric reheat.",
  "",
  "SECTION 26 00 00 - ELECTRICAL",
  "Switchboards, transformers, feeder distribution and emergency lighting inverters.",
].join("\n");

const proj = ((await q("projects:listProjects", {})) || []).find((p) => p.title === TITLE);
if (!proj) throw new Error("CONV-A fixture missing");
const pkgsBefore = (await q("tradePackages:listByProject", { projectId: proj._id })) || [];
const pkg = pkgsBefore.find((p) => String(p.csiDivision).startsWith("22"));

function toastText(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="status"],[aria-live="polite"],[aria-live="assertive"]')]
      .map((e) => (e.innerText || "").trim())
      .filter(Boolean)
      .join(" | ")
  );
}

const { browser, page } = await openApp(1440, 900);
try {
  await selectProject(page, proj._id);

  // ---------- (b) public demo banner ----------
  out.assertions.publicDemoBanner = await page.evaluate(() =>
    document.body.innerText.includes("Public shared demo — everything here is visible to anyone with this URL")
  );

  // ---------- (a) dispatch RFQs from the package card ----------
  await clickTab(page, "01:");
  await delay(1500);
  const dispatchClick = await page.evaluate((tradeName) => {
    const cards = [...document.querySelectorAll("div")].filter(
      (d) => d.innerText && d.innerText.includes(tradeName) && d.innerText.includes("Dispatch RFQs")
    );
    if (!cards.length) return { ok: false };
    cards.sort((a, b) => a.innerText.length - b.innerText.length);
    const b = [...cards[0].querySelectorAll("button")].find((x) => (x.textContent || "").includes("Dispatch RFQs"));
    if (!b) return { ok: false, note: "button missing in card" };
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    b.click();
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, pkg.tradeName);
  out.assertions.dispatchClicked = dispatchClick.ok;
  if (dispatchClick.ok) await page.mouse.click(dispatchClick.x, dispatchClick.y);
  const seen = new Set();
  for (let i = 0; i < 24; i++) {
    await delay(400);
    const t = await toastText(page);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.toasts.push({ at: i * 400, text: t });
    }
  }
  out.deliveryStatus = await q("rfq:getProjectDeliveryStatus", { projectId: proj._id }).catch((e) => ({ error: String(e?.message ?? e) }));
  const logs = (await q("auditLogs:listRecentLogs", { projectId: proj._id, limit: 200 })) || [];
  const deliveryLogs = logs.filter((l) => /AgentMail Delivery:/i.test(l.title));
  out.auditDelivery = deliveryLogs.slice(0, 3).map((l) => ({ title: l.title, description: l.description }));
  const latest = deliveryLogs.sort((a, b) => b.timestamp - a.timestamp)[0];
  const match = latest ? /^AgentMail Delivery:\s*(\d+)\s+of\s+(\d+)/i.exec(latest.title) : null;
  const auditSent = match ? Number(match[1]) : null;
  const auditEligible = match ? Number(match[2]) : null;
  const toastJoins = out.toasts.map((t) => t.text).join(" || ");
  out.assertions.dispatchHonesty = {
    auditSent,
    auditEligible,
    toastTexts: out.toasts.map((t) => t.text),
    toastClaimsDelivered: /delivered to \d+ contractor/i.test(toastJoins),
    toastClaimsNoEmail: /no email (left|was delivered)|not configured/i.test(toastJoins),
    honest:
      auditSent === 0
        ? !/delivered to \d+ contractor/i.test(toastJoins)
        : /delivered to \d+ contractor/i.test(toastJoins),
  };
  await page.screenshot({ path: path.join(evidenceDir, "a7conv-a-step5-dispatch.png") });

  // package card delivery notice (reactive deliveryStatus)
  await clickTab(page, "01:");
  await delay(2500);
  out.packageCardText = await page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText;
    const i = t.indexOf("Email delivery unavailable");
    return i === -1 ? null : t.slice(Math.max(0, i - 220), i + 120).replace(/\n+/g, " | ");
  });
  out.assertions.packageCardNotice = Boolean(out.packageCardText);
  await page.screenshot({ path: path.join(evidenceDir, "a7conv-a-step5-card-notice.png") });

  // ---------- (c) Auto-Scope preview gate ----------
  const pkgsBeforeAutoscope = ((await q("tradePackages:listByProject", { projectId: proj._id })) || []).length;
  await clickText(page, "AI Spec Breakdown (Auto-Scope)");
  await delay(1500);
  await page.evaluate(() => {
    const ta = document.querySelector('textarea[aria-label="Architectural and engineering specifications text"]');
    ta.scrollIntoView({ block: "center" });
  });
  await page.evaluate((text) => {
    const ta = document.querySelector('textarea[aria-label="Architectural and engineering specifications text"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
  }, AMBIG_SPEC);
  await delay(300);
  out.assertions.autoscopeOpened = await page.evaluate(() =>
    Boolean(document.querySelector('textarea[aria-label="Architectural and engineering specifications text"]'))
  );
  await clickText(page, "Analyze Specifications & Preview");
  const previewUp = await poll(
    () => page.evaluate(() => (document.body.innerText.includes("Step 2 of 2") ? document.body.innerText : null)),
    (t) => Boolean(t),
    120000,
    1500
  );
  out.preview = await page.evaluate(() => {
    const t = (document.querySelector("main") || document.body).innerText;
    const i = t.indexOf("Step 2 of 2");
    const slice = i === -1 ? null : t.slice(i, i + 1400);
    const divs = [...t.matchAll(/Div\s+([0-9]{2})/g)].map((m) => m[1]);
    return { slice: slice ? slice.replace(/\n+/g, " | ") : null, detectedDivisions: [...new Set(divs)] };
  });
  const countDuringPreview = ((await q("tradePackages:listByProject", { projectId: proj._id })) || []).length;
  out.assertions.previewListsDivisions = Boolean(out.preview && out.preview.detectedDivisions.length >= 2);
  out.assertions.previewDetectedDivisions = out.preview ? out.preview.detectedDivisions : [];
  out.assertions.noWriteDuringPreview = countDuringPreview === pkgsBeforeAutoscope;
  await page.screenshot({ path: path.join(evidenceDir, "a7conv-a-step5-autoscope-preview.png") });

  // Re-parse: must write nothing
  await clickText(page, "Re-parse");
  await delay(1200);
  const afterReparse = await page.evaluate(() => ({
    stillPreview: document.body.innerText.includes("Step 2 of 2"),
    textareaValue: document.querySelector('textarea[aria-label="Architectural and engineering specifications text"]')?.value?.length ?? null,
  }));
  const countAfterReparse = ((await q("tradePackages:listByProject", { projectId: proj._id })) || []).length;
  out.reparse = { ...afterReparse, countAfterReparse };
  out.assertions.reparseWroteNothing = countAfterReparse === pkgsBeforeAutoscope && !afterReparse.stillPreview;

  // Generate: second preview, then confirm
  await clickText(page, "Analyze Specifications & Preview");
  await poll(
    () => page.evaluate(() => document.body.innerText.includes("Step 2 of 2")),
    (v) => v === true,
    120000,
    1500
  );
  const previewDivs2 = await page.evaluate(() => {
    const t = document.body.innerText;
    const i = t.indexOf("Step 2 of 2");
    return i === -1 ? null : t.slice(i, i + 500).replace(/\n+/g, " | ");
  });
  const genBtn = await clickText(page, "Generate ");
  out.assertions.generateClicked = genBtn.ok;
  const after = await poll(
    () => q("tradePackages:listByProject", { projectId: proj._id }),
    (x) => (x || []).length > pkgsBeforeAutoscope,
    90000,
    2000
  );
  out.generate = {
    secondPreviewSlice: previewDivs2,
    packageCountBefore: pkgsBeforeAutoscope,
    packageCountAfter: (after || []).length,
    created: (after || []).slice(pkgsBeforeAutoscope).map((p) => ({ csi: p.csiDivision, name: p.tradeName, budget: p.budgetEstimate })),
    successMessage: await page.evaluate(() => {
      const m = document.body.innerText.match(/Generated \d+ GC-confirmed[^\n]*/);
      return m ? m[0] : null;
    }),
  };
  out.assertions.generateWroteAfterConfirm = (after || []).length > pkgsBeforeAutoscope;
  await page.screenshot({ path: path.join(evidenceDir, "a7conv-a-step5-autoscope-generated.png") });
} catch (err) {
  out.error = String(err?.stack ?? err);
  console.error(err);
} finally {
  await browser.close();
}
await writeEvidence("a7conv-a-step5.json", out);
console.log(JSON.stringify({ assertions: out.assertions, toasts: out.toasts, auditDelivery: out.auditDelivery, deliveryStatus: out.deliveryStatus, packageCardText: out.packageCardText, preview: out.preview, reparse: out.reparse, generate: out.generate }, null, 2));