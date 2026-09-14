import fs from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");

async function generateRosendinProposal() {
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // PAGE 1: Proposal & Schedule of Values
  const page1 = pdfDoc.addPage([612, 792]);
  const { width, height } = page1.getSize();

  // Header Banner
  page1.drawRectangle({
    x: 40,
    y: height - 90,
    width: width - 80,
    height: 55,
    color: rgb(0.08, 0.22, 0.42),
  });

  page1.drawText("ROSENDIN ELECTRIC, INC.", {
    x: 55,
    y: height - 60,
    size: 18,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page1.drawText("Commercial Electrical Contractors | Texas License: TX-TECL-18042 (TDLR Active)", {
    x: 55,
    y: height - 78,
    size: 9.5,
    font: fontRegular,
    color: rgb(0.85, 0.9, 0.98),
  });

  // Contractor Contact Info Block
  page1.drawText("Austin Office: 10830 Metric Blvd, Austin, TX 78758 | Phone: (512) 835-2400 | estimating@rosendin.com", {
    x: 40,
    y: height - 105,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.3, 0.3, 0.3),
  });

  // Project Information Box
  page1.drawRectangle({
    x: 40,
    y: height - 190,
    width: width - 80,
    height: 75,
    borderColor: rgb(0.75, 0.8, 0.85),
    borderWidth: 1,
    color: rgb(0.97, 0.98, 0.99),
  });

  page1.drawText("FORMAL SUBCONTRACT BID PROPOSAL", {
    x: 50,
    y: height - 130,
    size: 11,
    font: fontBold,
    color: rgb(0.08, 0.22, 0.42),
  });

  page1.drawText("Project: The Domain Tower B - Class-A Commercial MEP", {
    x: 50,
    y: height - 146,
    size: 9.5,
    font: fontBold,
    color: rgb(0.15, 0.15, 0.15),
  });

  page1.drawText("Location: 11400 Domain Dr, Austin, TX 78758", {
    x: 50,
    y: height - 160,
    size: 9,
    font: fontRegular,
    color: rgb(0.25, 0.25, 0.25),
  });

  page1.drawText("Submitted To: Apex Commercial General Contractors LLC / Austin Commercial, LP", {
    x: 50,
    y: height - 174,
    size: 9,
    font: fontRegular,
    color: rgb(0.25, 0.25, 0.25),
  });

  page1.drawText("Date: September 10, 2026   |   CSI Division: 26 00 00 - Electrical & Lighting Systems", {
    x: 310,
    y: height - 146,
    size: 9,
    font: fontRegular,
    color: rgb(0.3, 0.3, 0.3),
  });

  // Base Bid Announcement
  page1.drawRectangle({
    x: 40,
    y: height - 235,
    width: width - 80,
    height: 36,
    color: rgb(0.92, 0.96, 0.92),
    borderColor: rgb(0.4, 0.7, 0.4),
    borderWidth: 1,
  });

  page1.drawText("TOTAL BASE BID LUMP SUM:   $1,225,000.00", {
    x: 55,
    y: height - 215,
    size: 13,
    font: fontBold,
    color: rgb(0.1, 0.45, 0.15),
  });

  page1.drawText("(One Million Two Hundred Twenty-Five Thousand Dollars and 00/100)", {
    x: 55,
    y: height - 228,
    size: 9,
    font: fontOblique,
    color: rgb(0.2, 0.5, 0.25),
  });

  // Schedule of Values Table
  page1.drawText("SCHEDULE OF VALUES (ITEMIZED LINE ITEMS BREAKDOWN):", {
    x: 40,
    y: height - 255,
    size: 10,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });

  // Table Header
  page1.drawRectangle({
    x: 40,
    y: height - 280,
    width: width - 80,
    height: 20,
    color: rgb(0.15, 0.25, 0.4),
  });

  page1.drawText("ITEM #", { x: 45, y: height - 273, size: 8.5, font: fontBold, color: rgb(1, 1, 1) });
  page1.drawText("DESCRIPTION OF WORK", { x: 90, y: height - 273, size: 8.5, font: fontBold, color: rgb(1, 1, 1) });
  page1.drawText("UNIT", { x: 410, y: height - 273, size: 8.5, font: fontBold, color: rgb(1, 1, 1) });
  page1.drawText("STATUS", { x: 450, y: height - 273, size: 8.5, font: fontBold, color: rgb(1, 1, 1) });
  page1.drawText("TOTAL AMOUNT", { x: 505, y: height - 273, size: 8.5, font: fontBold, color: rgb(1, 1, 1) });

  const sovItems = [
    { num: "01", desc: "1600A Main Service Switchboard (Square D QED-2, 65kAIC, 480/277V)", unit: "LS", status: "INCLUDED", amt: "$380,000.00" },
    { num: "02", desc: "Step-Down Distribution Dry Transformers (NEMA TP-1 Premium)", unit: "LS", status: "INCLUDED", amt: "$145,000.00" },
    { num: "03", desc: "Copper Feeder & Branch Conduits (ASTM B8 Class B THHN conductors)", unit: "LF", status: "INCLUDED", amt: "$290,000.00" },
    { num: "04", desc: "Penthouse Crane Rigging & Mobile Crane Hoisting to 14th Floor", unit: "LS", status: "INCLUDED", amt: "$45,000.00" },
    { num: "05", desc: "UL 1479 Through-Penetration Firestopping Assemblies", unit: "LS", status: "INCLUDED", amt: "$22,000.00" },
    { num: "06", desc: "Seismic Engineered Structural Bracing per IBC Section 1613", unit: "LS", status: "INCLUDED", amt: "$55,000.00" },
    { num: "07", desc: "Temporary 400A Jobsite Distribution Board Maintenance", unit: "LS", status: "INCLUDED", amt: "$18,000.00" },
    { num: "08", desc: "Architectural Lighting & Dual-Lite Emergency Battery Inverters", unit: "LS", status: "INCLUDED", amt: "$170,000.00" },
    { num: "09", desc: "Testing, Megger Reporting, Energization & 1-Yr Warranty", unit: "LS", status: "INCLUDED", amt: "$100,000.00" },
  ];

  let currY = height - 298;
  sovItems.forEach((item, idx) => {
    if (idx % 2 === 1) {
      page1.drawRectangle({
        x: 40,
        y: currY - 4,
        width: width - 80,
        height: 18,
        color: rgb(0.96, 0.97, 0.99),
      });
    }
    page1.drawText(item.num, { x: 48, y: currY, size: 8, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
    page1.drawText(item.desc, { x: 90, y: currY, size: 8, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });
    page1.drawText(item.unit, { x: 415, y: currY, size: 8, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
    page1.drawText(item.status, { x: 450, y: currY, size: 7.5, font: fontBold, color: rgb(0.1, 0.5, 0.2) });
    page1.drawText(item.amt, { x: 505, y: currY, size: 8, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    currY -= 18;
  });

  // Subtotal Divider Line
  page1.drawLine({
    start: { x: 40, y: currY },
    end: { x: width - 40, y: currY },
    thickness: 1,
    color: rgb(0.7, 0.7, 0.7),
  });

  currY -= 16;
  page1.drawText("TOTAL CONTRACT BASE BID SUM:", { x: 300, y: currY, size: 9.5, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page1.drawText("$1,225,000.00", { x: 505, y: currY, size: 10, font: fontBold, color: rgb(0.1, 0.45, 0.15) });

  // Page 1 Footer
  page1.drawText("TradePulse Pro Verified Construction Document | Rosendin Electric, Inc. Page 1 of 2", {
    x: 40,
    y: 30,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.5, 0.5, 0.5),
  });

  // PAGE 2: Qualifications, VE Alternates, Lead Time & Signatures
  const page2 = pdfDoc.addPage([612, 792]);

  page2.drawRectangle({
    x: 40,
    y: height - 60,
    width: width - 80,
    height: 30,
    color: rgb(0.08, 0.22, 0.42),
  });

  page2.drawText("ROSENDIN ELECTRIC, INC.  |  PROPOSAL QUALIFICATIONS & ALTERNATES", {
    x: 50,
    y: height - 47,
    size: 10,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  // Value Engineering Alternates Section
  page2.drawRectangle({
    x: 40,
    y: height - 160,
    width: width - 80,
    height: 85,
    color: rgb(0.96, 0.98, 1),
    borderColor: rgb(0.65, 0.75, 0.9),
    borderWidth: 1,
  });

  page2.drawText("VALUE ENGINEERING (VE) ALTERNATES PROPOSED", {
    x: 50,
    y: height - 90,
    size: 10,
    font: fontBold,
    color: rgb(0.1, 0.25, 0.5),
  });

  page2.drawText("VE-01: Feeder Cable Material Optimization", {
    x: 50,
    y: height - 110,
    size: 9,
    font: fontBold,
    color: rgb(0.15, 0.15, 0.15),
  });

  page2.drawText(
    "Furnish ASTM B800 8000-Series Aluminum Alloy MC Feeder Cable in lieu of specified copper conduit runs.\nFully meets NEC 2023 ampacity requirements and saves significant installation labor.",
    { x: 50, y: height - 125, size: 8.5, font: fontRegular, color: rgb(0.25, 0.25, 0.25), lineHeight: 12 }
  );

  page2.drawText("DEDUCT FROM BASE BID:   -$35,000.00", {
    x: 50,
    y: height - 150,
    size: 9.5,
    font: fontBold,
    color: rgb(0.8, 0.1, 0.1),
  });

  // Scope Inclusions Attestation Box
  page2.drawRectangle({
    x: 40,
    y: height - 265,
    width: width - 80,
    height: 90,
    color: rgb(0.97, 0.99, 0.97),
    borderColor: rgb(0.4, 0.7, 0.4),
    borderWidth: 1,
  });

  page2.drawText("SCOPE INCLUSIONS & ZERO-EXCLUSIONS COMPLIANCE GUARANTEE", {
    x: 50,
    y: height - 190,
    size: 10,
    font: fontBold,
    color: rgb(0.1, 0.45, 0.15),
  });

  const inclusions = [
    "Crane Hoisting: Full crane mobilization, rigging crew, street closure permits to 14th-floor penthouse included.",
    "Firestopping: Complete UL 1479 through-penetration rated sealants and sleeve firestop assemblies included.",
    "Seismic Restraints: PE-stamped engineered seismic bracing for all conduits 2.5 in. and larger per IBC Section 1613.",
    "Temporary Power: Furnishing and servicing 400A jobsite temporary power distribution panels fully included.",
    "Exclusions: ZERO SCOPE EXCLUSIONS. Clean, fully compliant, turnkey commercial trade proposal.",
  ];

  let incY = height - 208;
  inclusions.forEach((inc) => {
    page2.drawText(`*  ${inc}`, { x: 50, y: incY, size: 8, font: fontRegular, color: rgb(0.15, 0.2, 0.15) });
    incY -= 11.5;
  });

  // Schedule & Lead Times Box
  page2.drawRectangle({
    x: 40,
    y: height - 370,
    width: width - 80,
    height: 90,
    color: rgb(0.99, 0.98, 0.96),
    borderColor: rgb(0.85, 0.7, 0.5),
    borderWidth: 1,
  });

  page2.drawText("EQUIPMENT LEAD TIMES & COMMERCIAL TERMS", {
    x: 50,
    y: height - 295,
    size: 10,
    font: fontBold,
    color: rgb(0.4, 0.25, 0.05),
  });

  page2.drawText("Main Switchgear Lead Time: 10 WEEKS from approved submittal drawings.", {
    x: 50,
    y: height - 315,
    size: 9,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.2),
  });

  page2.drawText("Schedule Alignment: Meets and exceeds owner's 12-week equipment delivery milestone (0 weeks penalty).", {
    x: 50,
    y: height - 330,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.3, 0.3, 0.3),
  });

  page2.drawText("Commercial Insurance: Travelers ACORD 25 Certificate attached ($5,000,000 Commercial Umbrella liability).", {
    x: 50,
    y: height - 345,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.3, 0.3, 0.3),
  });

  page2.drawText("Payment Terms: AIA Document G702/G703 Monthly Progress Billings; 10% Retainage; Net 30 days.", {
    x: 50,
    y: height - 360,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.3, 0.3, 0.3),
  });

  // Signatures Section
  page2.drawText("SUBMITTED & CERTIFIED BY:", { x: 40, y: height - 400, size: 9.5, font: fontBold, color: rgb(0.1, 0.1, 0.1) });

  page2.drawLine({ start: { x: 40, y: height - 440 }, end: { x: 280, y: height - 440 }, thickness: 1, color: rgb(0.3, 0.3, 0.3) });
  page2.drawText("David K. Ramirez, CPE", { x: 40, y: height - 455, size: 9.5, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page2.drawText("Vice President - Estimating & Preconstruction", { x: 40, y: height - 468, size: 8.5, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
  page2.drawText("Rosendin Electric, Inc.  |  Texas Electrical Contractor License #18042", { x: 40, y: height - 480, size: 8, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });

  // Acceptance Signature
  page2.drawText("ACCEPTED & AGREED TO BY GENERAL CONTRACTOR:", { x: 330, y: height - 400, size: 9, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page2.drawLine({ start: { x: 330, y: height - 440 }, end: { x: 570, y: height - 440 }, thickness: 1, color: rgb(0.3, 0.3, 0.3) });
  page2.drawText("Authorized Signature / Project Executive", { x: 330, y: height - 455, size: 9, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page2.drawText("Apex Commercial General Contractors LLC", { x: 330, y: height - 468, size: 8.5, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
  page2.drawText("Date: ________________________", { x: 330, y: height - 480, size: 8.5, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });

  // Page 2 Footer
  page2.drawText("TradePulse Pro Verified Construction Document | Rosendin Electric, Inc. Page 2 of 2", {
    x: 40,
    y: 30,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.5, 0.5, 0.5),
  });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

async function generateAltermanProposal() {
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // PAGE 1: Alterman Bid Proposal & Schedule of Values
  const page1 = pdfDoc.addPage([612, 792]);
  const { width, height } = page1.getSize();

  // Header Banner
  page1.drawRectangle({
    x: 40,
    y: height - 90,
    width: width - 80,
    height: 55,
    color: rgb(0.55, 0.15, 0.12),
  });

  page1.drawText("ALTERMAN, INC.", {
    x: 55,
    y: height - 60,
    size: 18,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page1.drawText("Commercial Electrical Contractors | Texas License: TX-TECL-19204 (TDLR Active)", {
    x: 55,
    y: height - 78,
    size: 9.5,
    font: fontRegular,
    color: rgb(0.98, 0.88, 0.88),
  });

  page1.drawText("Austin Office: 9201 Brown Ln #180, Austin, TX 78754 | Phone: (512) 454-0326 | estimating@goalterman.com", {
    x: 40,
    y: height - 105,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.3, 0.3, 0.3),
  });

  // Project Info
  page1.drawRectangle({
    x: 40,
    y: height - 190,
    width: width - 80,
    height: 75,
    borderColor: rgb(0.85, 0.75, 0.75),
    borderWidth: 1,
    color: rgb(0.99, 0.97, 0.97),
  });

  page1.drawText("ELECTRICAL BID QUOTATION & SUBMITTAL", {
    x: 50,
    y: height - 130,
    size: 11,
    font: fontBold,
    color: rgb(0.55, 0.15, 0.12),
  });

  page1.drawText("Project: The Domain Tower B - Commercial MEP", {
    x: 50,
    y: height - 146,
    size: 9.5,
    font: fontBold,
    color: rgb(0.15, 0.15, 0.15),
  });

  page1.drawText("Location: 11400 Domain Dr, Austin, TX 78758", {
    x: 50,
    y: height - 160,
    size: 9,
    font: fontRegular,
    color: rgb(0.25, 0.25, 0.25),
  });

  page1.drawText("Submitted To: Apex Commercial General Contractors LLC", {
    x: 50,
    y: height - 174,
    size: 9,
    font: fontRegular,
    color: rgb(0.25, 0.25, 0.25),
  });

  page1.drawText("Date: September 12, 2026   |   CSI Division: 26 00 00 - Electrical Systems", {
    x: 310,
    y: height - 146,
    size: 9,
    font: fontRegular,
    color: rgb(0.3, 0.3, 0.3),
  });

  // Apparent Low Base Bid Banner
  page1.drawRectangle({
    x: 40,
    y: height - 235,
    width: width - 80,
    height: 36,
    color: rgb(1, 0.96, 0.9),
    borderColor: rgb(0.85, 0.5, 0.2),
    borderWidth: 1,
  });

  page1.drawText("TOTAL BASE BID LUMP SUM:   $1,100,000.00", {
    x: 55,
    y: height - 215,
    size: 13,
    font: fontBold,
    color: rgb(0.7, 0.25, 0.05),
  });

  page1.drawText("(One Million One Hundred Thousand Dollars and 00/100 — Apparent Low Base)", {
    x: 55,
    y: height - 228,
    size: 9,
    font: fontOblique,
    color: rgb(0.6, 0.3, 0.1),
  });

  // Schedule of Values
  page1.drawText("SCHEDULE OF VALUES BREAKDOWN:", {
    x: 40,
    y: height - 255,
    size: 10,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });

  page1.drawRectangle({
    x: 40,
    y: height - 280,
    width: width - 80,
    height: 20,
    color: rgb(0.4, 0.15, 0.15),
  });

  page1.drawText("ITEM #", { x: 45, y: height - 273, size: 8.5, font: fontBold, color: rgb(1, 1, 1) });
  page1.drawText("DESCRIPTION OF WORK", { x: 90, y: height - 273, size: 8.5, font: fontBold, color: rgb(1, 1, 1) });
  page1.drawText("UNIT", { x: 410, y: height - 273, size: 8.5, font: fontBold, color: rgb(1, 1, 1) });
  page1.drawText("STATUS", { x: 450, y: height - 273, size: 8.5, font: fontBold, color: rgb(1, 1, 1) });
  page1.drawText("TOTAL AMOUNT", { x: 505, y: height - 273, size: 8.5, font: fontBold, color: rgb(1, 1, 1) });

  const altermanItems = [
    { num: "01", desc: "1600A Main Service Switchboard (Furnish Only - Offload by Others)", unit: "LS", status: "FURNISH ONLY", amt: "$420,000.00" },
    { num: "02", desc: "Step-Down Distribution Transformers (480V to 208Y/120V)", unit: "LS", status: "INCLUDED", amt: "$130,000.00" },
    { num: "03", desc: "Feeder Conduits and Copper Conductors Run", unit: "LF", status: "INCLUDED", amt: "$280,000.00" },
    { num: "04", desc: "Commercial Lighting Package & Fixtures", unit: "LS", status: "INCLUDED", amt: "$180,000.00" },
    { num: "05", desc: "Branch Power Distribution Panels & Receptacles", unit: "LS", status: "INCLUDED", amt: "$90,000.00" },
  ];

  let aY = height - 298;
  altermanItems.forEach((item, idx) => {
    if (idx % 2 === 1) {
      page1.drawRectangle({
        x: 40,
        y: aY - 4,
        width: width - 80,
        height: 18,
        color: rgb(0.99, 0.96, 0.96),
      });
    }
    page1.drawText(item.num, { x: 48, y: aY, size: 8, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
    page1.drawText(item.desc, { x: 90, y: aY, size: 8, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });
    page1.drawText(item.unit, { x: 415, y: aY, size: 8, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
    page1.drawText(item.status, { x: 450, y: aY, size: 7, font: fontBold, color: rgb(0.6, 0.2, 0.1) });
    page1.drawText(item.amt, { x: 505, y: aY, size: 8, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    aY -= 18;
  });

  page1.drawLine({
    start: { x: 40, y: aY },
    end: { x: width - 40, y: aY },
    thickness: 1,
    color: rgb(0.7, 0.7, 0.7),
  });

  aY -= 16;
  page1.drawText("TOTAL BASE BID QUOTATION:", { x: 330, y: aY, size: 9.5, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page1.drawText("$1,100,000.00", { x: 505, y: aY, size: 10, font: fontBold, color: rgb(0.7, 0.25, 0.05) });

  page1.drawText("TradePulse Pro Verified Construction Document | Alterman, Inc. Page 1 of 2", {
    x: 40,
    y: 30,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.5, 0.5, 0.5),
  });

  // PAGE 2: Mandatory Scope Exclusions (Forensic Trap!)
  const page2 = pdfDoc.addPage([612, 792]);

  page2.drawRectangle({
    x: 40,
    y: height - 60,
    width: width - 80,
    height: 30,
    color: rgb(0.55, 0.15, 0.12),
  });

  page2.drawText("ALTERMAN, INC.  |  MANDATORY QUALIFICATIONS & SCOPE EXCLUSIONS", {
    x: 50,
    y: height - 47,
    size: 10,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  // Critical Warning Box
  page2.drawRectangle({
    x: 40,
    y: height - 260,
    width: width - 80,
    height: 190,
    color: rgb(1, 0.96, 0.96),
    borderColor: rgb(0.8, 0.2, 0.2),
    borderWidth: 1.5,
  });

  page2.drawText("CRITICAL: MANDATORY SCOPE EXCLUSIONS (READ CAREFULLY)", {
    x: 50,
    y: height - 85,
    size: 11,
    font: fontBold,
    color: rgb(0.75, 0.1, 0.1),
  });

  page2.drawText(
    "Alterman's competitive low base bid of $1,100,000 is conditioned upon the following explicit exclusions:\nGeneral Contractor must verify that scope gaps are covered by others or backcharged accordingly.",
    { x: 50, y: height - 102, size: 8.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2), lineHeight: 12 }
  );

  const exclusions = [
    { name: "EXCLUSION 1: Crane Hoisting & Rigging", desc: "Crane hoisting & rigging to penthouse mechanical floor excluded (GC to furnish crane).", impact: "+$45,000.00" },
    { name: "EXCLUSION 2: UL 1479 Firestopping Penetrations", desc: "UL 1479 rated firestop floor and wall penetrations excluded (By drywall/framing trade).", impact: "+$22,000.00" },
    { name: "EXCLUSION 3: Seismic Engineered Bracing", desc: "Seismic engineered structural bracing excluded (By others / Specialty contractor).", impact: "+$55,000.00" },
    { name: "EXCLUSION 4: Overtime / Weekend Acceleration", desc: "Overtime and weekend premium time excluded; straight time labor only.", impact: "+$25,000.00" },
  ];

  let exY = height - 130;
  exclusions.forEach((ex) => {
    page2.drawText(ex.name, { x: 50, y: exY, size: 9, font: fontBold, color: rgb(0.7, 0.1, 0.1) });
    page2.drawText(ex.impact, { x: 490, y: exY, size: 9, font: fontBold, color: rgb(0.75, 0.1, 0.1) });
    page2.drawText(ex.desc, { x: 60, y: exY - 11, size: 8, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
    exY -= 28;
  });

  page2.drawText("TOTAL ESTIMATED SCOPE GAP VALUE:   +$147,000.00", {
    x: 270,
    y: height - 248,
    size: 10,
    font: fontBold,
    color: rgb(0.8, 0.1, 0.1),
  });

  // Lead Times & Insurance Box
  page2.drawRectangle({
    x: 40,
    y: height - 370,
    width: width - 80,
    height: 95,
    color: rgb(1, 0.98, 0.94),
    borderColor: rgb(0.85, 0.65, 0.3),
    borderWidth: 1,
  });

  page2.drawText("EQUIPMENT LEAD TIME & INSURANCE DEFICIENCIES", {
    x: 50,
    y: height - 285,
    size: 10,
    font: fontBold,
    color: rgb(0.5, 0.3, 0.05),
  });

  page2.drawText("Switchgear Lead Time: 16 WEEKS from approved submittal drawings (+4 weeks late vs milestone).", {
    x: 50,
    y: height - 305,
    size: 9,
    font: fontBold,
    color: rgb(0.7, 0.25, 0.05),
  });

  page2.drawText(
    "Liquidated Damages Impact: 4 weeks unexcused schedule delay at $6,000/week contractual penalty = $24,000.00.",
    { x: 50, y: height - 320, size: 8.5, font: fontRegular, color: rgb(0.3, 0.3, 0.3) }
  );

  page2.drawText(
    "Insurance Limits: Standard statutory limits ($1M GL). $5M Commercial Umbrella liability NOT provided in base rate.\n(Requires $15,000 rider premium adjustment for compliant ACORD 25 coverage).",
    { x: 50, y: height - 336, size: 8.5, font: fontRegular, color: rgb(0.3, 0.3, 0.3), lineHeight: 11 }
  );

  // Forensic Normalization Callout Box
  page2.drawRectangle({
    x: 40,
    y: height - 440,
    width: width - 80,
    height: 55,
    color: rgb(0.95, 0.95, 0.98),
    borderColor: rgb(0.4, 0.4, 0.7),
    borderWidth: 1,
  });

  page2.drawText("FORENSIC BID LEVELING TRUTH (ADR-0003 NORMALIZATION FORMULA):", {
    x: 50,
    y: height - 395,
    size: 9.5,
    font: fontBold,
    color: rgb(0.15, 0.15, 0.5),
  });

  page2.drawText(
    "Base Bid ($1,100,000) + Scope Gaps ($147,000) + Delay Penalty ($24,000) + COI Rider ($15,000) = $1,286,000.00 TRUE LEVELED COST.\nAlterman appears $125,000 cheaper on paper, but is actually $61,000 MORE EXPENSIVE than Rosendin Electric!",
    { x: 50, y: height - 412, size: 8.5, font: fontRegular, color: rgb(0.2, 0.2, 0.4), lineHeight: 12 }
  );

  // Signatures
  page2.drawText("SUBMITTED BY: Marcus Vance, Commercial Estimating", { x: 40, y: height - 470, size: 9, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page2.drawText("Alterman, Inc.  |  Texas License #19204", { x: 40, y: height - 485, size: 8.5, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });

  page2.drawText("TradePulse Pro Verified Construction Document | Alterman, Inc. Page 2 of 2", {
    x: 40,
    y: 30,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.5, 0.5, 0.5),
  });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

async function generatePenthousePlanDrawing() {
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // PAGE 1: Architectural & Electrical Blueprint Sheet E-101
  const page = pdfDoc.addPage([792, 612]); // Landscape 11x8.5 standard architectural format
  const { width, height } = page.getSize();

  // Outer Drawing Border
  page.drawRectangle({
    x: 25,
    y: 25,
    width: width - 50,
    height: height - 50,
    borderWidth: 2,
    borderColor: rgb(0.1, 0.1, 0.1),
  });

  // Inner Margin Border
  page.drawRectangle({
    x: 30,
    y: 30,
    width: width - 60,
    height: height - 60,
    borderWidth: 0.5,
    borderColor: rgb(0.4, 0.4, 0.4),
  });

  // Title Block Box (Bottom Right)
  const tbX = width - 260;
  const tbY = 30;
  const tbW = 230;
  const tbH = 140;

  page.drawRectangle({
    x: tbX,
    y: tbY,
    width: tbW,
    height: tbH,
    color: rgb(0.97, 0.98, 1),
    borderWidth: 1.5,
    borderColor: rgb(0.1, 0.1, 0.1),
  });

  page.drawText("THE DOMAIN TOWER B", { x: tbX + 10, y: tbY + 120, size: 12, font: fontBold, color: rgb(0.08, 0.22, 0.42) });
  page.drawText("11400 Domain Dr, Austin, TX 78758", { x: tbX + 10, y: tbY + 107, size: 8, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
  page.drawLine({ start: { x: tbX, y: tbY + 100 }, end: { x: tbX + tbW, y: tbY + 100 }, thickness: 1, color: rgb(0.5, 0.5, 0.5) });

  page.drawText("DRAWING TITLE:", { x: tbX + 10, y: tbY + 86, size: 7.5, font: fontBold, color: rgb(0.4, 0.4, 0.4) });
  page.drawText("1600A SWITCHGEAR & PENTHOUSE PLAN", { x: tbX + 10, y: tbY + 72, size: 9, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawLine({ start: { x: tbX, y: tbY + 65 }, end: { x: tbX + tbW, y: tbY + 65 }, thickness: 1, color: rgb(0.5, 0.5, 0.5) });

  page.drawText("DESIGNED: Austin Commercial MEP Arch.", { x: tbX + 10, y: tbY + 52, size: 7.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
  page.drawText("CHECKED: Lead Electrical PE #89214", { x: tbX + 10, y: tbY + 40, size: 7.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
  page.drawText("DATE: 2026-09-08    SCALE: 1/4\" = 1'-0\"", { x: tbX + 10, y: tbY + 28, size: 7.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
  page.drawLine({ start: { x: tbX, y: tbY + 22 }, end: { x: tbX + tbW, y: tbY + 22 }, thickness: 1, color: rgb(0.5, 0.5, 0.5) });

  page.drawText("SHEET NO:  E-101   REV 2", { x: tbX + 10, y: tbY + 8, size: 11, font: fontBold, color: rgb(0.8, 0.1, 0.1) });

  // PE Stamp Seal Box
  const peX = tbX - 110;
  const peY = 30;
  page.drawRectangle({
    x: peX,
    y: peY,
    width: 100,
    height: tbH,
    color: rgb(1, 1, 1),
    borderWidth: 1,
    borderColor: rgb(0.3, 0.3, 0.3),
  });

  page.drawText("STATE OF TEXAS", { x: peX + 14, y: peY + 120, size: 7.5, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText("PROFESSIONAL", { x: peX + 16, y: peY + 108, size: 7, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText("ENGINEER", { x: peX + 24, y: peY + 98, size: 7, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText("No. 89214", { x: peX + 26, y: peY + 80, size: 8, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText("Austin Energy Sys", { x: peX + 10, y: peY + 50, size: 7, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
  page.drawText("CERTIFIED PE", { x: peX + 18, y: peY + 20, size: 7.5, font: fontBold, color: rgb(0.1, 0.5, 0.2) });

  // Main Drawing Area: Penthouse Plan Layout
  page.drawText("ROOM 1402: MAIN ELECTRICAL SWITCHGEAR PENTHOUSE VAULT", {
    x: 45,
    y: height - 55,
    size: 11,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });

  // Room Outline (24' x 36' clear dimensions in scale)
  const rmX = 60;
  const rmY = 200;
  const rmW = 380;
  const rmH = 320;

  page.drawRectangle({
    x: rmX,
    y: rmY,
    width: rmW,
    height: rmH,
    color: rgb(0.98, 0.98, 0.98),
    borderWidth: 2,
    borderColor: rgb(0.15, 0.15, 0.15),
  });

  page.drawText("ROOM 1402 (CLEAR CEILING HEIGHT 14'-6\")", { x: rmX + 10, y: rmY + rmH - 18, size: 8.5, font: fontBold, color: rgb(0.3, 0.3, 0.3) });

  // Equipment 1: MSB-1 Main Switchboard (1600A, 480/277V, 3PH 4W)
  const msbX = rmX + 40;
  const msbY = rmY + 160;
  const msbW = 160;
  const msbH = 50;

  page.drawRectangle({
    x: msbX,
    y: msbY,
    width: msbW,
    height: msbH,
    color: rgb(0.85, 0.92, 1),
    borderWidth: 1.5,
    borderColor: rgb(0.1, 0.3, 0.7),
  });

  page.drawText("MSB-1: 1600A MAIN SERVICE SWITCHBOARD", { x: msbX + 8, y: msbY + 30, size: 7.5, font: fontBold, color: rgb(0.1, 0.3, 0.7) });
  page.drawText("480/277V, 3-PHASE, 4-WIRE, 65 kAIC (UL 891)", { x: msbX + 8, y: msbY + 16, size: 6.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });

  // 48" NEC Working Clearance Zone
  page.drawRectangle({
    x: msbX,
    y: msbY - 45,
    width: msbW,
    height: 45,
    color: rgb(1, 0.98, 0.9),
    borderWidth: 0.8,
    borderColor: rgb(0.8, 0.6, 0.1),
  });
  page.drawText("48\" NEC 110.26(A)(1) WORKING CLEARANCE (MAINTAIN CLEAR)", { x: msbX + 10, y: msbY - 26, size: 6, font: fontBold, color: rgb(0.7, 0.4, 0) });

  // Equipment 2: Transformer T-1 (75kVA Dry-type)
  const tX = rmX + 240;
  const tY = rmY + 170;
  page.drawRectangle({
    x: tX,
    y: tY,
    width: 60,
    height: 50,
    color: rgb(0.9, 0.95, 0.9),
    borderWidth: 1.2,
    borderColor: rgb(0.2, 0.6, 0.2),
  });
  page.drawText("XFMR T-1", { x: tX + 8, y: tY + 32, size: 7.5, font: fontBold, color: rgb(0.1, 0.5, 0.2) });
  page.drawText("75 kVA 480V-208Y", { x: tX + 4, y: tY + 18, size: 6, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });

  // Equipment 3: ATS-1 (Auto Transfer Switch)
  const atsX = rmX + 40;
  const atsY = rmY + 60;
  page.drawRectangle({
    x: atsX,
    y: atsY,
    width: 70,
    height: 40,
    color: rgb(1, 0.92, 0.92),
    borderWidth: 1.2,
    borderColor: rgb(0.7, 0.2, 0.2),
  });
  page.drawText("ATS-1", { x: atsX + 20, y: atsY + 24, size: 8, font: fontBold, color: rgb(0.7, 0.1, 0.1) });
  page.drawText("800A EMERGENCY", { x: atsX + 6, y: atsY + 12, size: 5.5, font: fontRegular, color: rgb(0.3, 0.1, 0.1) });

  // Rooftop Hoisting Hatch H-1
  const hX = rmX + 230;
  const hY = rmY + 40;
  page.drawRectangle({
    x: hX,
    y: hY,
    width: 90,
    height: 70,
    color: rgb(1, 0.97, 0.88),
    borderWidth: 1.5,
    borderColor: rgb(0.8, 0.4, 0),
  });
  page.drawText("HATCH H-1 (10' x 12')", { x: hX + 8, y: hY + 52, size: 7.5, font: fontBold, color: rgb(0.8, 0.35, 0) });
  page.drawText("ROOF HOISTING PATH", { x: hX + 8, y: hY + 38, size: 6.5, font: fontBold, color: rgb(0.8, 0.35, 0) });
  page.drawText("10,000 LB STRUCTURAL CURB", { x: hX + 6, y: hY + 24, size: 5.5, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
  page.drawText("CRANE RIGGING PATH TO ROOF", { x: hX + 5, y: hY + 12, size: 5.5, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });

  // Notes & Specifications Column (Right side)
  const notesX = 460;
  const notesY = height - 55;

  page.drawText("GENERAL ELECTRICAL NOTES & SPECIFICATIONS:", { x: notesX, y: notesY, size: 9, font: fontBold, color: rgb(0.1, 0.1, 0.1) });

  const drawingNotes = [
    "1. GOVERNING CODES: NFPA 70 (NEC 2023), City of Austin Electrical Code, IBC 2024.",
    "2. CRANE RIGGING SCOPE: Electrical contractor is strictly responsible for crane",
    "   mobilization and hoisting MSB-1 up to 14th-floor penthouse plant room.",
    "3. FIRESTOPPING: All penetrations through floors/walls must be sealed with UL 1479",
    "   compliant intumescent firestop assemblies (Spec Section 01 00 00 Article 3.01).",
    "4. SEISMIC ANCHORAGE: Furnish PE-stamped engineered seismic bracing (IBC 1613).",
    "   Anchors: Hilti HSL-4 M16 heavy-duty wedge anchors with min 6\" embedment.",
    "5. EQUIPMENT WEIGHTS: MSB-1 weighs 7,200 lbs; exceed 3,500 lb freight elevator limit.",
    "6. TEMPORARY POWER: Electrical contractor must furnish temporary 400A power boards.",
    "7. COORDINATION: Subcontractor shall field verify all slab core locations prior to drilling.",
  ];

  let nY = notesY - 18;
  drawingNotes.forEach((line) => {
    page.drawText(line, { x: notesX, y: nY, size: 7.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
    nY -= 13;
  });

  // Equipment Schedule Table (Lower Right)
  nY -= 10;
  page.drawText("EQUIPMENT SCHEDULE:", { x: notesX, y: nY, size: 8.5, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  nY -= 18;

  page.drawRectangle({ x: notesX, y: nY, width: 280, height: 16, color: rgb(0.15, 0.25, 0.4) });
  page.drawText("TAG", { x: notesX + 5, y: nY + 4, size: 7, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("DESCRIPTION", { x: notesX + 45, y: nY + 4, size: 7, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("VOLTAGE", { x: notesX + 175, y: nY + 4, size: 7, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("RATING", { x: notesX + 235, y: nY + 4, size: 7, font: fontBold, color: rgb(1, 1, 1) });

  const sched = [
    { tag: "MSB-1", desc: "Main Service Switchboard", v: "480/277V, 3P, 4W", r: "1600A 65k" },
    { tag: "ATS-1", desc: "Automatic Transfer Switch", v: "480/277V, 3P, 4W", r: "800A 4-Pole" },
    { tag: "T-1", desc: "Step-Down Dry Transformer", v: "480V to 208Y/120V", r: "75 kVA NEMA" },
    { tag: "DP-1", desc: "Distribution Panelboard", v: "480/277V, 3P, 4W", r: "400A MLO" },
  ];

  sched.forEach((row, i) => {
    nY -= 14;
    if (i % 2 === 1) {
      page.drawRectangle({ x: notesX, y: nY, width: 280, height: 14, color: rgb(0.95, 0.96, 0.98) });
    }
    page.drawText(row.tag, { x: notesX + 5, y: nY + 3, size: 6.5, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(row.desc, { x: notesX + 45, y: nY + 3, size: 6.5, font: fontRegular, color: rgb(0.15, 0.15, 0.15) });
    page.drawText(row.v, { x: notesX + 175, y: nY + 3, size: 6.5, font: fontRegular, color: rgb(0.15, 0.15, 0.15) });
    page.drawText(row.r, { x: notesX + 235, y: nY + 3, size: 6.5, font: fontBold, color: rgb(0.1, 0.4, 0.15) });
  });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

async function generateAcord25Coi() {
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const page = pdfDoc.addPage([612, 792]);
  const { width, height } = page.getSize();

  // Outer Border
  page.drawRectangle({
    x: 30,
    y: 30,
    width: width - 60,
    height: height - 60,
    borderWidth: 1,
    borderColor: rgb(0.2, 0.2, 0.2),
  });

  // Top Header
  page.drawText("ACORD", { x: 40, y: height - 50, size: 16, font: fontBold, color: rgb(0.1, 0.2, 0.4) });
  page.drawText("CERTIFICATE OF LIABILITY INSURANCE", { x: 130, y: height - 48, size: 12, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText("DATE (MM/DD/YYYY)\n01/15/2026", { x: 480, y: height - 48, size: 7.5, font: fontBold, color: rgb(0.2, 0.2, 0.2), lineHeight: 9 });

  page.drawLine({ start: { x: 30, y: height - 65 }, end: { x: width - 30, y: height - 65 }, thickness: 0.8, color: rgb(0.3, 0.3, 0.3) });

  // Disclaimer banner
  page.drawRectangle({ x: 30, y: height - 95, width: width - 60, height: 30, color: rgb(0.95, 0.95, 0.95) });
  page.drawText(
    "THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER. THIS\nCERTIFICATE DOES NOT AFFIRMATIVELY OR NEGATIVELY AMEND, EXTEND OR ALTER THE COVERAGE AFFORDED BY THE POLICIES BELOW.",
    { x: 35, y: height - 76, size: 5.5, font: fontRegular, color: rgb(0.3, 0.3, 0.3), lineHeight: 7.5 }
  );

  page.drawLine({ start: { x: 30, y: height - 95 }, end: { x: width - 30, y: height - 95 }, thickness: 0.8, color: rgb(0.3, 0.3, 0.3) });

  // Producer & Insured Columns
  const midX = 300;
  page.drawLine({ start: { x: midX, y: height - 95 }, end: { x: midX, y: height - 215 }, thickness: 0.8, color: rgb(0.3, 0.3, 0.3) });
  page.drawLine({ start: { x: 30, y: height - 215 }, end: { x: width - 30, y: height - 215 }, thickness: 0.8, color: rgb(0.3, 0.3, 0.3) });

  // PRODUCER (Left top)
  page.drawText("PRODUCER", { x: 35, y: height - 105, size: 7, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText("Travelers Commercial Risk Services LLC\n1000 Main Street, Suite 2400\nAustin, TX 78701\nPhone: (512) 478-2100  |  commercial.bids@travelers.com", {
    x: 35,
    y: height - 118,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.1, 0.1, 0.1),
    lineHeight: 10,
  });

  // INSURED (Left bottom)
  page.drawLine({ start: { x: 30, y: height - 155 }, end: { x: midX, y: height - 155 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
  page.drawText("INSURED", { x: 35, y: height - 165, size: 7, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText("Rosendin Electric, Inc.\n10830 Metric Blvd\nAustin, TX 78758\nTexas Electrical Contractor License: TX-TECL-18042", {
    x: 35,
    y: height - 177,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.1, 0.1, 0.1),
    lineHeight: 10,
  });

  // INSURERS AFFORDING COVERAGE (Right side)
  page.drawText("INSURERS AFFORDING COVERAGE", { x: midX + 10, y: height - 105, size: 7, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText("NAIC #", { x: width - 75, y: height - 105, size: 7, font: fontBold, color: rgb(0.2, 0.2, 0.2) });

  const insurers = [
    { letter: "A", name: "The Travelers Indemnity Company", naic: "25658" },
    { letter: "B", name: "Travelers Property Casualty Co of America", naic: "19038" },
    { letter: "C", name: "The Phoenix Insurance Company", naic: "25623" },
    { letter: "D", name: "Travelers Casualty & Surety Company", naic: "19070" },
  ];

  let insY = height - 122;
  insurers.forEach((ins) => {
    page.drawText(`INSURER ${ins.letter}: ${ins.name}`, { x: midX + 10, y: insY, size: 7.5, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(ins.naic, { x: width - 70, y: insY, size: 7.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
    insY -= 14;
  });

  // COVERAGES Table Header
  page.drawRectangle({ x: 30, y: height - 245, width: width - 60, height: 30, color: rgb(0.15, 0.25, 0.4) });
  page.drawText("COVERAGES", { x: 35, y: height - 232, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("CERTIFICATE NUMBER: TR-2026-991204", { x: 200, y: height - 232, size: 7.5, font: fontRegular, color: rgb(0.9, 0.9, 0.9) });
  page.drawText("REVISION NUMBER: 1", { x: 450, y: height - 232, size: 7.5, font: fontRegular, color: rgb(0.9, 0.9, 0.9) });

  page.drawRectangle({ x: 30, y: height - 265, width: width - 60, height: 20, color: rgb(0.9, 0.92, 0.96) });
  page.drawText("TYPE OF INSURANCE", { x: 35, y: height - 258, size: 7, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText("POLICY NUMBER", { x: 210, y: height - 258, size: 7, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText("EFF DATE", { x: 310, y: height - 258, size: 7, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText("EXP DATE", { x: 360, y: height - 258, size: 7, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText("LIMITS", { x: 430, y: height - 258, size: 7, font: fontBold, color: rgb(0.1, 0.1, 0.1) });

  // Policy Rows
  const coverages = [
    {
      type: "COMMERCIAL GENERAL LIABILITY\n  * Claims-Made  [X] Occur",
      num: "TRAV-GL-982144",
      eff: "01/01/2026",
      exp: "01/01/2027",
      limits: "EACH OCCURRENCE: $1,000,000\nGEN'L AGGREGATE: $2,000,000\nPROD - COMP/OP AGG: $2,000,000",
    },
    {
      type: "AUTOMOBILE LIABILITY\n  [X] Any Auto  [X] Owned/Hired",
      num: "TRAV-AL-551203",
      eff: "01/01/2026",
      exp: "01/01/2027",
      limits: "COMBINED SINGLE LIMIT: $1,000,000\n(Each Accident)",
    },
    {
      type: "UMBRELLA LIABILITY\n  [X] Occur  [X] Retention $0",
      num: "TRAV-UMB-771920",
      eff: "01/01/2026",
      exp: "01/01/2027",
      limits: "EACH OCCURRENCE: $5,000,000\nAGGREGATE LIMIT: $5,000,000\n(Full Commercial Umbrella Compliant)",
    },
    {
      type: "WORKERS COMPENSATION\n  AND EMPLOYERS' LIABILITY",
      num: "TRAV-WC-449102",
      eff: "01/01/2026",
      exp: "01/01/2027",
      limits: "[X] STATUTORY LIMITS\nE.L. EACH ACCIDENT: $1,000,000\nE.L. DISEASE - EA EMP: $1,000,000",
    },
  ];

  let covY = height - 275;
  coverages.forEach((cov, i) => {
    const rowH = 42;
    if (i % 2 === 1) {
      page.drawRectangle({ x: 30, y: covY - rowH + 8, width: width - 60, height: rowH, color: rgb(0.98, 0.98, 0.99) });
    }
    page.drawLine({ start: { x: 30, y: covY - rowH + 8 }, end: { x: width - 30, y: covY - rowH + 8 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });

    page.drawText(cov.type, { x: 35, y: covY - 5, size: 7, font: fontBold, color: rgb(0.1, 0.1, 0.1), lineHeight: 9 });
    page.drawText(cov.num, { x: 210, y: covY - 5, size: 7.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(cov.eff, { x: 310, y: covY - 5, size: 7.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(cov.exp, { x: 360, y: covY - 5, size: 7.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(cov.limits, { x: 430, y: covY - 5, size: 6.5, font: fontRegular, color: rgb(0.1, 0.1, 0.1), lineHeight: 8.5 });

    covY -= rowH;
  });

  // Description of Operations Box
  covY -= 5;
  page.drawRectangle({ x: 30, y: covY - 75, width: width - 60, height: 75, color: rgb(1, 1, 1) });
  page.drawText("DESCRIPTION OF OPERATIONS / LOCATIONS / VEHICLES / SPECIAL PROVISIONS:", {
    x: 35,
    y: covY - 10,
    size: 7,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.2),
  });

  page.drawText(
    "PROJECT: The Domain Tower B - Commercial MEP, 11400 Domain Dr, Austin, TX 78758.\n" +
    "Certificate holder is included as Additional Insured on a primary and non-contributory basis with respect to General Liability,\n" +
    "Auto Liability, and Umbrella Liability as required by written contract. Waiver of Subrogation applies in favor of Certificate\n" +
    "Holder and Owner per policy conditions. 30-day Notice of Cancellation provided per policy terms.",
    { x: 35, y: covY - 24, size: 7, font: fontRegular, color: rgb(0.15, 0.15, 0.15), lineHeight: 10 }
  );

  // Certificate Holder & Cancellation
  covY -= 85;
  page.drawRectangle({ x: 30, y: covY - 70, width: width - 60, height: 70, color: rgb(1, 1, 1) });
  page.drawLine({ start: { x: 320, y: covY }, end: { x: 320, y: covY - 70 }, thickness: 0.8, color: rgb(0.3, 0.3, 0.3) });

  page.drawText("CERTIFICATE HOLDER", { x: 35, y: covY - 10, size: 7, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(
    "Apex Commercial General Contractors LLC\n" +
    "Austin Commercial, LP\n" +
    "11400 Domain Dr, Suite 300\n" +
    "Austin, TX 78758",
    { x: 35, y: covY - 23, size: 7.5, font: fontRegular, color: rgb(0.1, 0.1, 0.1), lineHeight: 10 }
  );

  page.drawText("CANCELLATION & AUTHORIZED REPRESENTATIVE", { x: 330, y: covY - 10, size: 7, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(
    "SHOULD ANY OF THE ABOVE DESCRIBED POLICIES BE CANCELLED BEFORE THE\nEXPIRATION DATE THEREOF, NOTICE WILL BE DELIVERED IN ACCORDANCE WITH THE\nPOLICY PROVISIONS.",
    { x: 330, y: covY - 22, size: 5.5, font: fontRegular, color: rgb(0.3, 0.3, 0.3), lineHeight: 7.5 }
  );

  page.drawLine({ start: { x: 330, y: covY - 50 }, end: { x: width - 40, y: covY - 50 }, thickness: 0.8, color: rgb(0.3, 0.3, 0.3) });
  page.drawText("AUTHORIZED REPRESENTATIVE:  Sarah M. Jenkins, CIC", {
    x: 330,
    y: covY - 62,
    size: 7.5,
    font: fontBold,
    color: rgb(0.1, 0.2, 0.4),
  });

  // ACORD Footer
  page.drawText("ACORD 25 (2016/03)                                             The ACORD name and logo are registered marks of ACORD", {
    x: 40,
    y: 36,
    size: 6.5,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4),
  });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

export async function main() {
  console.log("=== Generating Authentic Construction PDFs with pdf-lib ===");

  // 1. Rosendin Electric Proposal
  console.log("1. Generating Rosendin Electric AIA Proposal...");
  const rosendinBytes = await generateRosendinProposal();
  const rosendinDest = path.join(PUBLIC_DIR, "Rosendin_Electric_Proposal_AIA.pdf");
  const rosendinQuotes = path.join(PUBLIC_DIR, "quotes", "Rosendin_Electric_Proposal_AIA.pdf");
  fs.writeFileSync(rosendinDest, rosendinBytes);
  fs.writeFileSync(rosendinQuotes, rosendinBytes);
  console.log(`   Installed Rosendin Proposal (${(rosendinBytes.length / 1024).toFixed(1)} KB)`);

  // 2. Alterman Proposal
  console.log("2. Generating Alterman Bid Proposal with Hidden Exclusions...");
  const altermanBytes = await generateAltermanProposal();
  const altermanDest = path.join(PUBLIC_DIR, "Alterman_Power_Quote_Proposal.pdf");
  const altermanQuotes = path.join(PUBLIC_DIR, "quotes", "Alterman_Power_Quote_Proposal.pdf");
  fs.writeFileSync(altermanDest, altermanBytes);
  fs.writeFileSync(altermanQuotes, altermanBytes);
  console.log(`   Installed Alterman Proposal (${(altermanBytes.length / 1024).toFixed(1)} KB)`);

  // 3. E-101 Switchgear Penthouse Architectural Blueprint
  console.log("3. Generating E-101 Switchgear Penthouse Blueprint Drawing Set...");
  const drawingBytes = await generatePenthousePlanDrawing();
  const drawingDest = path.join(PUBLIC_DIR, "E-101_Main_Switchgear_Penthouse_Plan.pdf");
  const drawingDrawings = path.join(PUBLIC_DIR, "drawings", "E-101_Main_Switchgear_Penthouse_Plan.pdf");
  fs.writeFileSync(drawingDest, drawingBytes);
  fs.writeFileSync(drawingDrawings, drawingBytes);
  console.log(`   Installed E-101 Drawing Set (${(drawingBytes.length / 1024).toFixed(1)} KB)`);

  // 4. Travelers ACORD 25 COI
  console.log("4. Generating Travelers ACORD 25 Certificate of Liability Insurance...");
  const acordBytes = await generateAcord25Coi();
  const acordDest = path.join(PUBLIC_DIR, "Rosendin_Electric_ACORD25_COI.pdf");
  const acordIns = path.join(PUBLIC_DIR, "insurance", "Rosendin_Electric_ACORD25_COI.pdf");
  fs.writeFileSync(acordDest, acordBytes);
  fs.writeFileSync(acordIns, acordBytes);
  console.log(`   Installed Travelers ACORD 25 COI (${(acordBytes.length / 1024).toFixed(1)} KB)`);

  console.log("=== All Authentic Documents Successfully Generated & Installed! ===");
}

if (process.argv[1].endsWith("generate_authentic_project_docs.mjs")) {
  main().catch((err) => {
    console.error("Error generating documents:", err);
    process.exit(1);
  });
}
