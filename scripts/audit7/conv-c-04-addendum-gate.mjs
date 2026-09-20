/**
 * CONV-C 04 (audit-6 check 5): PM gate on "Issue Pre-Bid Addendum" for the demo.
 * Captures state/title only — never clicks the button (it would write).
 */
import fs from "node:fs";
import path from "node:path";
import { openApp, clickTab, selectProject, selectRibbonPackage, q, writeEvidence, delay } from "./lib.mjs";

const out = { startedAt: new Date().toISOString(), clicked: false };
const { browser, page } = await openApp(1440, 900);
try {
  const projects = (await q("projects:listProjects", {})) || [];
  const demo = projects.find((p) => /The Domain Tower B/i.test(p.title));
  await selectProject(page, demo._id);
  await delay(1800);
  await clickTab(page, "03:");
  await delay(1600);
  out.packageSelected = await selectRibbonPackage(page, "Electrical & Lighting Systems");
  await delay(1200);

  out.gate = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Issue Pre-Bid Addendum/.test(x.textContent || ""));
    if (!b) return { rendered: false };
    const scope = b.closest("div");
    const hint = [...(scope?.parentElement?.querySelectorAll("span") || [])]
      .map((s) => (s.textContent || "").trim())
      .filter((t) => /Certify at least one RFI/i.test(t));
    return {
      rendered: true,
      text: b.textContent.trim(),
      disabled: b.disabled,
      title: b.getAttribute("title"),
      hints: hint,
      ariaDisabled: b.getAttribute("aria-disabled"),
    };
  });

  out.rfiState = await page.evaluate(() => {
    const text = (document.querySelector("main") || document.body).innerText;
    const lines = text.split("\n").map((s) => s.trim());
    return {
      clarifyLine: lines.find((l) => /PM Review|Clarification/i.test(l)) || null,
      escalatedBadges: lines.filter((l) => /Awaiting PM|Escalat/i.test(l)).slice(0, 6),
      addendumButtons: [...document.querySelectorAll("button")]
        .filter((b) => /Addendum/i.test(b.textContent || ""))
        .map((b) => ({ text: b.textContent.trim(), disabled: b.disabled, title: b.getAttribute("title") })),
    };
  });
  await page.screenshot({ path: path.join(process.cwd(), "evidence", "fix6-conv-c-04-addendum-gate.png") });

  // Backend: no demo RFI carries pmCertifiedAt
  const pkgs = (await q("tradePackages:listByProject", { projectId: demo._id })) || [];
  const convs = (
    await Promise.all(pkgs.map((p) => q("rfq:listConversations", { tradePackageId: p._id }).catch(() => [])))
  ).flat();
  out.backend = {
    conversations: convs.length,
    clarified: convs.filter((c) => c.status === "clarified").length,
    pmCertified: convs.filter((c) => Boolean(c.pmCertifiedAt)).length,
    statuses: [...new Set(convs.map((c) => c.status))],
  };
} catch (err) {
  out.error = String(err?.stack ?? err);
} finally {
  await browser.close();
}
writeEvidence("fix6-conv-c-04-addendum-gate.json", out);
console.log(JSON.stringify({ gate: out.gate, rfiState: out.rfiState, backend: out.backend, error: out.error }, null, 1));