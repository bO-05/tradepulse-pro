import { delay, q, openApp, shot, writeJson, clickTab, selectProject, selectPackageCard, parseCsv } from "./qa5-common.mjs";
import fs from "node:fs";

const FIX = JSON.parse(fs.readFileSync("evidence/fix4-qa5-fixture.json", "utf8"));
const PROJECT_ID = FIX.projectId;
const concretePkg = FIX.state.packages.find((p) => p.csiDivision === "03 30 00");
const c1Name = "QA5 Concrete Partners LLC";
const OUT = { startedAt: new Date().toISOString() };

const run = async () => {
  const { browser, page } = await openApp();
  try {
    await selectProject(page, PROJECT_ID);
    await clickTab(page, "01:");
    await selectPackageCard(page, concretePkg.tradeName);
    await clickTab(page, "04:");
    await delay(1500);

    // ---------- Item 4: A401 draft honesty (backend contract text)
    const executed = (await q("agreements:listAgreements", { projectId: PROJECT_ID })).find(
      (a) => a.tradePackageId === concretePkg._id && a.status === "executed"
    );
    const text = executed.contractText;
    const ldLine = text.split("\n").find((l) => l.includes("Liquidated Damages"));
    OUT.item4 = {
      agreementNumber: executed.agreementNumber,
      documentTitle: executed.documentTitle,
      claimsNotOfficial: /not an official AIA document or a licensed AIA form/.test(text),
      claimsA401StyleDraft: /A401-STYLE STRUCTURE \(GENERATED DRAFT\)/.test(text),
      footerNotLicensed: /not an AIA-licensed form/.test(text),
      gcAddressPlaceholder: /Address & license: \[from the Prime Agreement — verify before execution\]/.test(text),
      ownerPlaceholder: /Owner: \[Owner from the Prime Agreement\]/.test(text),
      primeDatePlaceholder: /Prime Agreement between Contractor and Owner is dated: \[Prime Agreement date\]/.test(text),
      architectPlaceholder: /Architect \/ Owner Representative: \[from the Prime Agreement\]/.test(text),
      noFabricatedGcAddress: !/835-24\b/.test(text) && !/\b\d{2,5} [A-Z][a-z]+ (St|Street|Ave|Avenue|Blvd|Suite)\b/.test(text),
      ldLine: ldLine || null,
      ldUsesBidDeadline: ldLine ? ldLine.includes(concretePkg.bidDeadline) : null,
      ldMilestoneIsSubstantialCompletion: ldLine ? /Substantial Completion/.test(ldLine) : null,
      containsBidDeadlineAnywhere: text.includes(concretePkg.bidDeadline),
      positiveOfficialClaim: /is an official AIA|official, licensed AIA|licensed AIA form\b/.test(text.replace(/not an official AIA/g, "").replace(/not an AIA-licensed/g, "")),
    };

    // UI viewer inspection
    const inspect = await page.evaluate((name) => {
      const h = [...document.querySelectorAll("h3")].find((x) => (x.textContent || "").trim().includes(name));
      if (!h) return null;
      let root = h.closest(".rounded-xl") || h.parentElement;
      for (let i = 0; i < 5 && root; i++) {
        const btn = [...root.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Inspect Draft"));
        if (btn) {
          btn.scrollIntoView({ block: "center" });
          const r = btn.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        root = root.parentElement;
      }
      return null;
    }, c1Name);
    OUT.item4.inspectButton = Boolean(inspect);
    if (inspect) {
      await page.mouse.click(inspect.x, inspect.y);
      let preText = null;
      for (let i = 0; i < 40; i++) {
        await delay(400);
        preText = await page.evaluate(() => {
          const pre = document.querySelector("pre");
          return pre ? pre.innerText : null;
        });
        if (preText && preText.length > 500) break;
      }
      OUT.item4.viewerTextLen = preText?.length || 0;
      OUT.item4.viewerHasDisclaimers =
        Boolean(preText) &&
        preText.includes("not an official AIA document") &&
        preText.includes("not an AIA-licensed form");
      OUT.item4.viewerMentionsRecorded =
        (await page.evaluate(() => document.body.innerText)).includes("Execution recorded in TradePulse");
      await shot(page, "fix4-qa5-item4-agreement-viewer.png");
    } else {
      await shot(page, "fix4-qa5-item4-agreement-viewer-missing.png");
    }

    // close viewer
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Close Viewer");
      b?.click();
    });
    await delay(600);

    // ---------- Item 5: CSV injection export
    await page.evaluate(() => {
      const orig = URL.createObjectURL.bind(URL);
      window.__qa5Blobs = [];
      URL.createObjectURL = (blob) => {
        window.__qa5Blobs.push(blob);
        return orig(blob);
      };
    });
    const exportClick = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Export Leveling CSV"));
      if (!b) return null;
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    OUT.item5 = { exportButton: Boolean(exportClick) };
    if (exportClick) {
      await page.mouse.click(exportClick.x, exportClick.y);
      await delay(1200);
      const csvText = await page.evaluate(async () => {
        const blobs = window.__qa5Blobs || [];
        if (!blobs.length) return null;
        return await blobs[blobs.length - 1].text();
      });
      OUT.item5.bytes = csvText ? csvText.length : 0;
      if (csvText) {
        fs.mkdirSync("evidence", { recursive: true });
        fs.writeFileSync("evidence/fix4-qa5-item5-leveling.csv", csvText, "utf8");
        const rows = parseCsv(csvText);
        OUT.item5.headerCols = rows[0].length;
        const malRow = rows.find((r) => r.some((c) => c.includes("HYPERLINK")));
        const normalRows = rows.filter((r) => r.length > 1 && !r.some((c) => c.includes("HYPERLINK")));
        OUT.item5.maliciousRowCols = malRow ? malRow.length : null;
        OUT.item5.maliciousCell = malRow ? malRow.find((c) => c.includes("HYPERLINK")) : null;
        OUT.item5.maliciousLeadingEqualsNeutralized = Boolean(OUT.item5.maliciousCell?.startsWith("'="));
        OUT.item5.maliciousQuotesDoubledInRaw = csvText.includes('""http://evil.example""') && csvText.includes('""CSV,Name""');
        OUT.item5.normalRowParses = normalRows.length > 0 && normalRows.every((r) => r.length === rows[0].length);
        OUT.item5.allRowsConsistent = rows.every((r) => r.length === rows[0].length);
        OUT.item5.sampleMaliciousLine = csvText.split(/\r?\n/).find((l) => l.includes("HYPERLINK")) || null;
      }
      await shot(page, "fix4-qa5-item5-csv-export.png");
    }
    writeJson("fix4-qa5-item4-item5.json", OUT);
    console.log(JSON.stringify(OUT, null, 2));
  } catch (e) {
    OUT.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-qa5-item4-item5.json", OUT);
    console.error(OUT.error);
  } finally {
    await browser.close();
  }
};
run();