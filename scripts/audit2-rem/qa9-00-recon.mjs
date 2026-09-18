/**
 * QA9 recon: project list + per-tab interactive map on the live site.
 * Evidence: evidence/fix4-qa9-00-recon.json
 */
import { launchBrowser, attachDiagnostics, waitForAppReady, selectProjectByTitle, currentProjectLabel, shot, writeEvidence, client, delay, buttonSnapshot } from "./qa9-lib.mjs";

const c = client();
const projects = await c.query("projects:listProjects", {});

const { browser } = await launchBrowser(1440, 950);
const page = await browser.newPage();
const diag = attachDiagnostics(page);
await page.goto("https://brainy-skunk-440.convex.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
await waitForAppReady(page);

const projectOptions = await page.evaluate(() => {
  const sel = document.querySelector('select[aria-label="Select Commercial Construction Project"]');
  return sel ? [...sel.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : [];
});

const TABS = ["packages", "discovery", "qna", "leveling", "coordination", "contracts", "audit", "diagnostics"];
const tabMap = {};
for (const tab of TABS) {
  const clicked = await page.evaluate((t) => {
    const btns = [...document.querySelectorAll("button, [role=tab], a")];
    const m = btns.find((b) => (b.getAttribute("title") || "").toLowerCase().includes(t) || (b.textContent || "").toLowerCase().includes(t === "qna" ? "pre-bid" : t === "contracts" ? "subcontract" : t === "audit" ? "audit" : t));
    if (!m) return false;
    m.scrollIntoView({ block: "center" });
    m.click();
    return true;
  }, tab);
  await delay(1200);
  const snap = await page.evaluate(() => {
    const main = document.querySelector("main");
    const controls = [...main.querySelectorAll("button, input, select, textarea")].map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || "",
      text: (el.textContent || "").trim().slice(0, 70),
      aria: el.getAttribute("aria-label") || "",
      title: el.getAttribute("title") || "",
      placeholder: el.getAttribute("placeholder") || "",
      disabled: !!el.disabled,
      visible: el.getBoundingClientRect().width > 0,
    })).filter((el) => el.visible);
    return { heading: main ? main.innerText.split("\n").slice(0, 6).join(" | ") : null, controls };
  });
  tabMap[tab] = { clicked, ...snap };
  await shot(page, `fix4-qa9-00-tab-${tab}.png`);
}

const out = {
  fetchedAt: new Date().toISOString(),
  currentProject: await currentProjectLabel(page),
  projectOptions,
  backendProjects: projects.map((p) => ({ id: p._id, title: p.title, isDemo: p.isDemoProject })),
  tabMap,
  diagnostics: { pageErrors: diag.pageErrors, consoleErrors: diag.consoleLogs.filter((l) => l.type === "error").slice(0, 10) },
};
writeEvidence("00-recon", out);
console.log("projects on live selector:", projectOptions.length);
await browser.close();