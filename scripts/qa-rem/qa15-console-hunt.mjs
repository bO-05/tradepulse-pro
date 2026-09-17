// QA-15: hunt the single pre-sweep console error seen in qa15-regression run.
// Phases: A invalid CSI modal submit, B registered RFI submit, C deep-link discovery, D empty-project CTA.
// Usage: node scripts/qa-rem/qa15-console-hunt.mjs
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { launchBrowser, EVIDENCE_DIR, BASE_URL, waitForAppReady, shot, delay, setInputValue, clickButtonByText } from "./qa1-lib.mjs";

const BACKEND = process.env.QA_BACKEND_URL || "https://brainy-skunk-440.convex.cloud";
const client = new ConvexHttpClient(BACKEND);
const EMPTY_TAG = `QA-REM-QA15-EMPTY2-${Date.now()}`;

const LOG = [];
const OUT = { startedAt: new Date().toISOString(), phases: {}, items: {} };
const ev = (s) => {
  LOG.push(s);
  console.log(s);
};

async function dismissTour(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[title]")].find((x) =>
      /Close Demo Tour|Close Teleprompter/i.test(x.getAttribute("title") || "")
    );
    if (b) b.click();
  });
  await delay(250);
}
async function bodyHas(page, text) {
  return page.evaluate((t) => document.body.innerText.includes(t), text);
}

async function main() {
  ev("=== QA-15 CONSOLE HUNT ===");
  ev(`UTC: ${new Date().toISOString()}`);
  const projects = await client.query("projects:listProjects", {});
  const fixture = projects.find((p) => p.title.startsWith("QA-REM-QA15-O1-"));
  const packages = await client.query("tradePackages:listByProject", { projectId: fixture._id });
  const elecPkg = packages.find((p) => String(p.csiDivision).startsWith("26"));

  const { browser } = await launchBrowser();
  const errors = [];
  const badResponses = [];
  const tag = (phase) => ({ phase, at: new Date().toISOString() });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    page.on("console", (m) => {
      if (m.type() === "error") errors.push({ ...tag(currentPhase), text: m.text() });
    });
    page.on("pageerror", (e) => errors.push({ ...tag(currentPhase), text: `PAGEERROR ${String(e?.message || e)}` }));
    page.on("response", (r) => {
      if (r.status() >= 400) badResponses.push({ ...tag(currentPhase), text: `${r.status()} ${r.request().method()} ${r.url()}` });
    });

    let currentPhase = "boot";
    await page.goto(`${BASE_URL}/?project=${fixture._id}&tab=packages`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(800);
    currentPhase = "A-invalid-csi";
    await clickButtonByText(page, "Create Trade Package");
    await delay(600);
    await setInputValue(page, 'input[placeholder="e.g. 26 00 00"]', "99 99 99");
    await setInputValue(page, 'input[placeholder="e.g. Electrical & Lighting Systems"]', "QA-15 Hunt Probe");
    await setInputValue(page, 'input[type="number"]', "400000");
    await setInputValue(page, 'textarea[placeholder="Scope details..."]', "hunt probe");
    await page.evaluate(() => {
      const el = document.querySelector('input[type="date"]');
      if (!el) return;
      el.removeAttribute("min");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, "2026-10-31");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await clickButtonByText(page, "Create Package");
    await delay(5000);
    const aErrors = errors.filter((e) => e.phase === "A-invalid-csi");
    ev(`[A] invalid CSI errors=${aErrors.length} ${JSON.stringify(aErrors.map((e) => e.text.slice(0, 200)))}`);
    OUT.phases.A = aErrors;
    await clickButtonByText(page, "Cancel");
    await delay(600);

    currentPhase = "B-registered-rfi";
    const cardClick = await page.evaluate(() => {
      const h3 = [...document.querySelectorAll("h3")].find((x) => (x.textContent || "").trim() === "QA-15 Electrical");
      if (!h3) return false;
      (h3.closest("div[class*='cursor-pointer']") || h3.closest("div")).click();
      return true;
    });
    await delay(700);
    await clickButtonByText(page, "Pre-Bid Q&A");
    await delay(1000);
    await setInputValue(page, 'input[placeholder="e.g. Hoisting responsibility for switchgear"]', `QA-15 hunt registered RFI ${Date.now()}`);
    await setInputValue(page, 'textarea[placeholder="Ask a technical or scope coordination question..."]', "Hunt probe registered bidder question.");
    await delay(300);
    await clickButtonByText(page, "Submit RFI for Clarification");
    await delay(8000);
    const bErrors = errors.filter((e) => e.phase === "B-registered-rfi");
    ev(`[B] registered RFI cardClick=${cardClick} errors=${bErrors.length} ${JSON.stringify(bErrors.map((e) => e.text.slice(0, 200)))}`);
    OUT.phases.B = bErrors;

    currentPhase = "C-deeplink";
    await page.goto(`${BASE_URL}/?project=${fixture._id}&tab=discovery`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(1500);
    const cErrors = errors.filter((e) => e.phase === "C-deeplink");
    ev(`[C] deep-link errors=${cErrors.length} ${JSON.stringify(cErrors.map((e) => e.text.slice(0, 200)))}`);
    OUT.phases.C = cErrors;

    currentPhase = "D-empty-cta";
    const emptyId = await client.mutation("projects:createProject", {
      title: EMPTY_TAG,
      location: "Austin, TX",
      projectType: "QA hunt",
      estBudget: 900000,
      targetCompletionWeeks: 20,
      specDocumentText: "hunt empty fixture",
      isDemoProject: false,
    });
    await page.goto(`${BASE_URL}/?project=${emptyId}&tab=discovery`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForAppReady(page, 45000);
    await dismissTour(page);
    await delay(1200);
    const cta = await bodyHas(page, "Go to CSI Scoping");
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Go to CSI Scoping"));
      if (b) b.click();
    });
    await delay(1200);
    const dErrors = errors.filter((e) => e.phase === "D-empty-cta");
    ev(`[D] empty CTA present=${cta} errors=${dErrors.length} ${JSON.stringify(dErrors.map((e) => e.text.slice(0, 200)))}`);
    OUT.phases.D = dErrors;
    await client.mutation("projects:deleteProject", { projectId: emptyId }).catch(() => {});
  } finally {
    await browser.close();
  }

  OUT.allErrors = errors;
  OUT.badResponses = badResponses;
  ev("");
  ev(`TOTAL console errors=${errors.length}; bad responses>=400=${badResponses.length}`);
  ev(`by phase: ${JSON.stringify(Object.fromEntries(Object.entries(OUT.phases).map(([k, v]) => [k, v.length])))}`);
  OUT.items.phase_A_clean = OUT.phases.A.length === 0;
  OUT.items.phase_C_clean = OUT.phases.C.length === 0;
  OUT.items.phase_D_clean = OUT.phases.D.length === 0;

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-console-hunt.txt"), LOG.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-console-hunt.json"), JSON.stringify(OUT, null, 2), "utf8");
  console.log("Wrote console hunt evidence.");
}

main().catch((e) => {
  console.error("FATAL", e);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "remediation-qa15-console-hunt.txt"), LOG.join("\n") + `\nFATAL: ${e?.stack || e?.message}\n`, "utf8");
  process.exit(1);
});