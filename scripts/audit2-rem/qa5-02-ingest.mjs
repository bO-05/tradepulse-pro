import {
  delay,
  q,
  http,
  openApp,
  shot,
  writeJson,
  clickText,
  clickTab,
  selectProject,
  selectPackageCard,
  confirmDialog,
} from "./qa5-common.mjs";
import fs from "node:fs";

const FIX = JSON.parse(fs.readFileSync("evidence/fix4-qa5-fixture.json", "utf8"));
const PROJECT_ID = FIX.projectId;
const concretePkg = FIX.state.packages.find((p) => p.csiDivision === "03 30 00");
const c1 = FIX.state.contractors.find((c) => c.companyName === "QA5 Concrete Partners LLC");
const c2 = FIX.state.contractors.find((c) => c.companyName === "QA5 Solid Structures Inc.");

const OUT = { startedAt: new Date().toISOString() };
const run = async () => {
  const { browser, page } = await openApp();
  try {
    await selectProject(page, PROJECT_ID);
    await clickTab(page, "01:");
    await selectPackageCard(page, concretePkg.tradeName);
    await clickTab(page, "04:");
    await delay(1200);

    const before = {
      bids: await q("bids:listByPackage", { tradePackageId: concretePkg._id }),
      contractors: await q("contractors:listByPackage", { tradePackageId: concretePkg._id }),
    };
    OUT.before = { bidCount: before.bids.length, contractorCount: before.contractors.length };

    // ---------- 2a: select registered contractor, quote names somebody else
    await clickText(page, "Ingest Quote / PDF");
    await delay(800);
    const selOk = await page.select('select[aria-label="Subcontractor or bidder for this proposal"]', c1._id);
    OUT.item2a_selectedValue = selOk;
    const quote1 = `PROPOSAL AND QUOTATION
Subcontractor: Some Other Name Contracting
Project: QA5 Structural Concrete
Base Bid Price: $1,950,000.00
EXCLUSIONS:
- Winter weather heating and curing accelerators excluded (By GC)
Lead time on post-tensioning steel: 14 weeks.
Insurance: Fully compliant ACORD 25 with $5M Umbrella.`;
    const taBox = await page.evaluate(() => {
      const ta = document.querySelector('textarea[aria-label="Proposal OCR text or pasted quote"]');
      ta.scrollIntoView({ block: "center" });
      const r = ta.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(taBox.x, taBox.y);
    await page.keyboard.type(quote1, { delay: 1 });
    await page.evaluate(() => {
      const ta = document.querySelector('textarea[aria-label="Proposal OCR text or pasted quote"]');
      ta.dispatchEvent(new Event("blur", { bubbles: false }));
      ta.blur();
    });
    await delay(700);
    OUT.item2a_selectAfterBlur = await page.evaluate(() => {
      const s = document.querySelector('select[aria-label="Subcontractor or bidder for this proposal"]');
      return { value: s?.value || null, text: s?.selectedOptions?.[0]?.textContent?.trim() || null };
    });
    await shot(page, "fix4-qa5-item2-ingest-selected.png");
    await clickText(page, "Extract & Level Bid");
    let c1Bid = null;
    for (let i = 0; i < 60; i++) {
      await delay(1500);
      const bids = await q("bids:listByPackage", { tradePackageId: concretePkg._id });
      c1Bid = bids.find((b) => b.contractorId === c1._id);
      if (c1Bid) break;
    }
    const contractorsAfter2a = await q("contractors:listByPackage", { tradePackageId: concretePkg._id });
    OUT.item2a = {
      bid: c1Bid
        ? {
            subcontractorName: c1Bid.subcontractorName,
            revisionNumber: c1Bid.revisionNumber,
            baseBidAmount: c1Bid.baseBidAmount,
            contractorIdMatchesSelected: c1Bid.contractorId === c1._id,
          }
        : null,
      contractorCount: contractorsAfter2a.length,
      names: contractorsAfter2a.map((c) => c.companyName),
      noOtherNameCreated: !contractorsAfter2a.some((c) => /Some Other Name/i.test(c.companyName)),
    };
    await shot(page, "fix4-qa5-item2-ingest-result.png");

    // ---------- 2b: no selection, auto-detect must fill a full name (and reject tiny fragments)
    await page.reload({ waitUntil: "domcontentloaded" });
    await delay(2500);
    await selectProject(page, PROJECT_ID);
    await clickTab(page, "01:");
    await selectPackageCard(page, concretePkg.tradeName);
    await clickTab(page, "04:");
    await delay(1200);
    await clickText(page, "Ingest Quote / PDF");
    await delay(800);
    const taBox2 = await page.evaluate(() => {
      const ta = document.querySelector('textarea[aria-label="Proposal OCR text or pasted quote"]');
      ta.scrollIntoView({ block: "center" });
      const r = ta.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(taBox2.x, taBox2.y);
    await page.keyboard.type("Subcontractor: Re\nBase Bid Price: $100", { delay: 1 });
    await page.evaluate(() => {
      const ta = document.querySelector('textarea[aria-label="Proposal OCR text or pasted quote"]');
      ta.blur();
    });
    await delay(600);
    OUT.item2b_tinyFragment = await page.evaluate(() => {
      const s = document.querySelector('select[aria-label="Subcontractor or bidder for this proposal"]');
      const nameInput = document.querySelector('input[aria-label="New subcontractor company name"]');
      return { selectValue: s?.value || "", newName: nameInput?.value || null };
    });
    await page.mouse.click(taBox2.x, taBox2.y);
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    const quote2 = `PROPOSAL AND QUOTATION
Subcontractor: QA5 AutoDetect Concrete LLC
Project: QA5 Structural Concrete
Base Bid Price: $1,880,000.00
Lead time: 9 weeks.
Insurance: Fully compliant ACORD 25 with $5M Umbrella.`;
    await page.keyboard.type(quote2, { delay: 1 });
    await page.evaluate(() => {
      const ta = document.querySelector('textarea[aria-label="Proposal OCR text or pasted quote"]');
      ta.blur();
    });
    await delay(700);
    OUT.item2b_autodetected = await page.evaluate(() => {
      const s = document.querySelector('select[aria-label="Subcontractor or bidder for this proposal"]');
      const nameInput = document.querySelector('input[aria-label="New subcontractor company name"]');
      return { selectValue: s?.value || "", newName: nameInput?.value || null };
    });
    await shot(page, "fix4-qa5-item2-autodetect-filled.png");
    await clickText(page, "Extract & Level Bid");
    let detectedBid = null;
    let detectedContractor = null;
    for (let i = 0; i < 60; i++) {
      await delay(1500);
      const bids = await q("bids:listByPackage", { tradePackageId: concretePkg._id });
      detectedBid = bids.find((b) => /QA5 AutoDetect/i.test(b.subcontractorName));
      if (detectedBid) break;
    }
    if (detectedBid) {
      const list = await q("contractors:listByPackage", { tradePackageId: concretePkg._id });
      detectedContractor = list.find((c) => c._id === detectedBid.contractorId) || null;
    }
    OUT.item2b = {
      bid: detectedBid ? { subcontractorName: detectedBid.subcontractorName, revisionNumber: detectedBid.revisionNumber } : null,
      contractorName: detectedContractor?.companyName || null,
      contractorCount: (await q("contractors:listByPackage", { tradePackageId: concretePkg._id })).length,
    };
    await shot(page, "fix4-qa5-item2-autodetect-result.png");

    // ---------- Revision flow (item 7): re-ingest C1 quote, must update in place
    await clickText(page, "Ingest Quote / PDF");
    await delay(800);
    await page.select('select[aria-label="Subcontractor or bidder for this proposal"]', c1._id);
    const taBox3 = await page.evaluate(() => {
      const ta = document.querySelector('textarea[aria-label="Proposal OCR text or pasted quote"]');
      ta.scrollIntoView({ block: "center" });
      const r = ta.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(taBox3.x, taBox3.y);
    await page.keyboard.type(
      `PROPOSAL AND QUOTATION\nSubcontractor: Ignored Name\nBase Bid Price: $1,930,000.00\nLead time: 11 weeks.\nInsurance: Fully compliant ACORD 25.`,
      { delay: 1 }
    );
    await clickText(page, "Extract & Level Bid");
    let revised = null;
    for (let i = 0; i < 60; i++) {
      await delay(1500);
      const bids = await q("bids:listByPackage", { tradePackageId: concretePkg._id });
      revised = bids.find((b) => b.contractorId === c1._id);
      if (revised && revised.revisionNumber >= 2) break;
    }
    const bidsAfterRevision = await q("bids:listByPackage", { tradePackageId: concretePkg._id });
    OUT.revision = {
      sameBidId: revised?._id === c1Bid?._id,
      revisionNumber: revised?.revisionNumber,
      name: revised?.subcontractorName,
      totalBidsForPackage: bidsAfterRevision.length,
      duplicateForContractor: bidsAfterRevision.filter((b) => b.contractorId === c1._id).length,
    };
    await shot(page, "fix4-qa5-item2-revision-result.png");

    // ---------- Direct-mutation setup for later items: C2 bid + CSV-injection bid
    const c2BidId = await http.mutation("bids:submitDirectBid", {
      tradePackageId: concretePkg._id,
      contractorId: c2._id,
      subcontractorName: "QA5 Solid Structures Inc.",
      baseBidAmount: 1_985_000,
      longLeadEquipmentWeeks: 10,
    });
    const csvContractorId = await http.mutation("contractors:createContractor", {
      tradePackageId: concretePkg._id,
      companyName: "QA5 CSV Injection Co.",
      contactEmail: "bids@qa5csv.example",
      licenseNumber: "QA5-LIC-9001",
      licenseStatus: "Active & Verified",
      sourceUrl: "https://qa5csv.example.com",
      rfqStatus: "discovered",
    });
    const csvBidId = await http.mutation("bids:submitDirectBid", {
      tradePackageId: concretePkg._id,
      contractorId: csvContractorId,
      subcontractorName: '=HYPERLINK("http://evil.example","x") "CSV,Name"',
      baseBidAmount: 2_010_000,
      longLeadEquipmentWeeks: 12,
    });
    OUT.setup = { c2BidId, csvContractorId, csvBidId };

    const after = {
      bids: await q("bids:listByPackage", { tradePackageId: concretePkg._id }),
      contractors: await q("contractors:listByPackage", { tradePackageId: concretePkg._id }),
    };
    OUT.after = {
      bidSummaries: after.bids.map((b) => ({
        id: b._id,
        name: b.subcontractorName,
        amount: b.baseBidAmount,
        rev: b.revisionNumber,
        awarded: b.isAwarded,
      })),
      contractorNames: after.contractors.map((c) => c.companyName),
    };
    writeJson("fix4-qa5-item2-ingest.json", OUT);
    console.log(JSON.stringify(OUT, null, 2).slice(0, 6000));
  } catch (e) {
    OUT.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-qa5-item2-ingest.json", OUT);
    console.error("ERROR", OUT.error);
  } finally {
    await browser.close();
  }
};
run();