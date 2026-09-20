/**
 * CONV-C 08: live Subcontracts register — agreement body claims vs the honest
 * "A401-style, not an AIA-licensed form" wrapper. Opens the viewer read-only.
 */
import fs from "node:fs";
import path from "node:path";
import { openApp, clickTab, selectProject, q, writeEvidence, delay, clickText } from "./lib.mjs";

const out = { startedAt: new Date().toISOString() };
const { browser, page } = await openApp(1440, 900);
try {
  const projects = (await q("projects:listProjects", {})) || [];
  const demo = projects.find((p) => /The Domain Tower B/i.test(p.title));
  await selectProject(page, demo._id);
  await delay(1600);
  await clickTab(page, "06:");
  await delay(1600);

  out.register = await page.evaluate(() => {
    const text = (document.querySelector("main") || document.body).innerText;
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
    return {
      head: lines.slice(0, 40),
      a401Mentions: [...new Set(lines.filter((l) => /A401|AIA|standard form/i.test(l)))],
      inspectButtons: [...document.querySelectorAll("button")]
        .filter((b) => /Inspect Draft/.test(b.textContent || ""))
        .map((b) => ({ text: b.textContent.trim(), title: b.getAttribute("title") })),
    };
  });
  await page.screenshot({ path: path.join(process.cwd(), "evidence", "fix6-conv-c-08-contracts-register.png") });

  const open = await clickText(page, "Inspect Draft");
  out.openClicked = open;
  await delay(1000);
  out.viewer = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.getBoundingClientRect().width > 1);
    if (!d) return null;
    const pre = d.querySelector("pre");
    const body = pre ? pre.textContent : "";
    return {
      modalTitle: (d.querySelector("h3") || {}).textContent?.trim() || null,
      footerDisclaimer: [...d.querySelectorAll("div")]
        .map((x) => (x.children.length === 0 ? x.textContent.trim() : ""))
        .find((t) => /not an AIA-licensed form/i.test(t)) || null,
      contractBodyHead: body.slice(0, 420),
      containsOfficialTitle: /AIA Document A401.+2017 Standard Form/i.test(body),
      containsNotOfficialDisclaimer: /not an official AIA/i.test(body),
    };
  });
  await page.screenshot({ path: path.join(process.cwd(), "evidence", "fix6-conv-c-08-contracts-viewer.png") });
  await page.keyboard.press("Escape");
  await delay(400);

  const agreements = (await q("agreements:listAgreements", { projectId: demo._id })) || [];
  out.backend = agreements.map((a) => ({
    agreementNumber: a.agreementNumber,
    documentTitle: a.documentTitle,
    status: a.status,
    contractTextHead: String(a.contractText || "").slice(0, 220),
    bodyContainsOfficialTitle: /AIA Document A401.+2017 Standard Form/i.test(String(a.contractText || "")),
    bodyContainsNotOfficialDisclaimer: /not an official AIA/i.test(String(a.contractText || "")),
  }));
} catch (err) {
  out.error = String(err?.stack ?? err);
} finally {
  await browser.close();
}
writeEvidence("fix6-conv-c-08-contracts-doc.json", out);
console.log(JSON.stringify({ register: out.register, viewer: out.viewer, backend: out.backend, error: out.error }, null, 1));