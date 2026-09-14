import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function escapePdfText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function buildPdf(title, subtitle, sections) {
  let streamContent = `BT\n/F1 15 Tf\n50 750 Td\n(${escapePdfText(title)}) Tj\nET\n`;
  streamContent += `BT\n/F2 9.5 Tf\n50 732 Td\n(${escapePdfText(subtitle)}) Tj\nET\n`;
  streamContent += `BT\n/F1 9 Tf\n50 718 Td\n(${escapePdfText(
    "=========================================================================================================="
  )}) Tj\nET\n`;

  let y = 700;
  for (const sec of sections) {
    if (y < 70) break;
    streamContent += `BT\n/F1 11 Tf\n50 ${y} Td\n(${escapePdfText(sec.heading)}) Tj\nET\n`;
    y -= 16;
    for (const line of sec.lines) {
      if (y < 50) break;
      streamContent += `BT\n/F2 9 Tf\n55 ${y} Td\n(${escapePdfText(line)}) Tj\nET\n`;
      y -= 13;
    }
    y -= 8;
  }

  streamContent += `BT\n/F2 8 Tf\n50 35 Td\n(${escapePdfText(
    "TradePulse Pro Certified Construction Document Register | Austin, TX | CSI MasterFormat 2024 Compliance"
  )}) Tj\nET\n`;

  const streamBytes = Buffer.from(streamContent, "utf-8");
  const streamLen = streamBytes.length;

  const header = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const obj1 = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  const obj2 = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
  const obj3 =
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n";
  const obj4 = "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n";
  const obj5 = "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";
  const obj6 = `6 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj\n`;

  const off1 = Buffer.byteLength(header, "utf-8");
  const off2 = off1 + Buffer.byteLength(obj1, "utf-8");
  const off3 = off2 + Buffer.byteLength(obj2, "utf-8");
  const off4 = off3 + Buffer.byteLength(obj3, "utf-8");
  const off5 = off4 + Buffer.byteLength(obj4, "utf-8");
  const off6 = off5 + Buffer.byteLength(obj5, "utf-8");
  const xrefOffset = off6 + Buffer.byteLength(obj6, "utf-8");

  const pad = (n) => String(n).padStart(10, "0");
  const xref = `xref\n0 7\n0000000000 65535 f \n${pad(off1)} 00000 n \n${pad(off2)} 00000 n \n${pad(
    off3
  )} 00000 n \n${pad(off4)} 00000 n \n${pad(off5)} 00000 n \n${pad(off6)} 00000 n \n`;
  const trailer = `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(header + obj1 + obj2 + obj3 + obj4 + obj5 + obj6 + xref + trailer, "utf-8");
}

const docs = [
  {
    subDir: "specs",
    fileName: "01_00_00_General_Requirements.pdf",
    title: "CSI MASTERFORMAT SECTION 01 00 00 - GENERAL REQUIREMENTS",
    subtitle: "Project: The Domain Tower B - Commercial MEP | Location: Austin, TX",
    sections: [
      {
        heading: "PART 1 - GENERAL ADMINISTRATIVE REQUIREMENTS",
        lines: [
          "1.01 SUMMARY: Division 01 governs all trade subcontractor buyout packages for Class-A Commercial construction.",
          "1.02 PROJECT SCOPE: Construction of The Domain Tower B commercial tower, 14 stories, 420,000 GSF core & shell.",
          "1.03 WORK BY OTHERS: General Contractor coordinates tower crane staging, street closures, and perimeter security.",
          "1.04 TRADE MOBILIZATION: Subcontractors must coordinate delivery and staging with GC Superintendent 72 hours prior.",
        ],
      },
      {
        heading: "PART 2 - TEMPORARY UTILITIES & HOISTING RESPONSIBILITIES",
        lines: [
          "2.01 TEMPORARY POWER: Electrical trade (Div 26) shall furnish, install, and maintain 400A temporary power distribution boards.",
          "2.02 HOISTING & RIGGING: Each specialty subcontractor is strictly responsible for crane rigging and hoisting up to penthouse.",
          "2.03 CRANE STAGING: GC does not furnish equipment hoisting. Proposals excluding crane mobilization will be adjusted.",
          "2.04 ROAD CLOSURES: Subcontractors must pull City of Austin right-of-way (ROW) permits for heavy equipment delivery.",
        ],
      },
      {
        heading: "PART 3 - EXECUTION, QUALITY ASSURANCE & FIRE SAFETY",
        lines: [
          "3.01 PENETRATION FIRESTOPPING: All floor and wall sleeve penetrations must comply with UL 1479 (ASTM E814).",
          "3.02 SEISMIC RESTRAINTS: Engineered structural seismic bracing required per IBC 2024 Section 1613 and ASCE 7-22.",
          "3.03 HOUSEKEEPING: Continuous broom-clean site conditions required; debris disposed daily in GC dumpsters.",
          "3.04 DELAY DAMAGES: Unexcused equipment lead times beyond schedule milestone incur liquidated damages at $6,000/week.",
        ],
      },
    ],
  },
  {
    subDir: "specs",
    fileName: "26_00_00_Electrical_Systems_Spec.pdf",
    title: "CSI MASTERFORMAT SECTION 26 00 00 - ELECTRICAL SYSTEMS",
    subtitle: "Lead Electrical Engineer: Austin Energy Systems Consulting PE #89214 | Austin, TX",
    sections: [
      {
        heading: "PART 1 - GENERAL ELECTRICAL PROVISIONS & CODES",
        lines: [
          "1.01 SCOPE: Complete commercial power distribution, 1600A main service switchboard, and lighting control.",
          "1.02 APPLICABLE CODES: NFPA 70 (NEC 2023), City of Austin Electrical Code, IBC 2024 Section 1613.",
          "1.03 SUBMITTALS: Product data, one-line diagrams, seismic calculations, and UL 1479 firestop listings.",
          "1.04 WARRANTY: Subcontractor shall provide 1-year comprehensive parts and labor warranty from Substantial Completion.",
        ],
      },
      {
        heading: "PART 2 - PRODUCTS & SWITCHGEAR SPECIFICATIONS",
        lines: [
          "2.01 MAIN SWITCHBOARD: 1600A, 480/277V, 3-phase, 4-wire, 65kAIC symmetrical fault current rating, UL 891 certified.",
          "2.02 DISTRIBUTION TRANSFORMERS: NEMA TP-1 compliant dry-type step-down transformers (480V to 208Y/120V).",
          "2.03 FEEDER CONDUCTORS: 600V copper THHN/THWN-2 conductors, stranded ASTM B8 in rigid galvanized conduit (RMC).",
          "2.04 VALUE ENGINEERING OPTION: Subcontractor may submit VE alternate for ASTM B800 aluminum alloy MC feeder cable.",
        ],
      },
      {
        heading: "PART 3 - EXECUTION & CROSS-TRADE COORDINATION",
        lines: [
          "3.01 CRANE RIGGING: Electrical contractor must hoist 1600A switchgear and transformers to 14th-floor penthouse.",
          "3.02 SEISMIC BRACING: Provide PE-stamped engineered seismic cable/rigid bracing for all conduits 2.5 in and larger.",
          "3.03 UL 1479 FIRESTOPPING: Furnish rated intumescent firestop sealants and composite sheets at all MEP penetrations.",
          "3.04 VFD COORDINATION: Div 26 provides power feed to Variable Frequency Drives. Div 23 HVAC furnishes AHU VFD hardware.",
        ],
      },
    ],
  },
  {
    subDir: "specs",
    fileName: "23_00_00_HVAC_Systems_Spec.pdf",
    title: "CSI MASTERFORMAT SECTION 23 00 00 - HVAC & MECHANICAL SYSTEMS",
    subtitle: "Lead Mechanical Engineer: Texas MEP Consulting Engineers PE #77412 | Austin, TX",
    sections: [
      {
        heading: "PART 1 - GENERAL MECHANICAL PROVISIONS",
        lines: [
          "1.01 SCOPE: Furnish and install chilled water air handling units, VAV terminal boxes, and ductwork distribution.",
          "1.02 CODES: ASHRAE Standard 90.1-2022, International Mechanical Code (IMC 2024), SMACNA Duct Construction Standards.",
          "1.03 COMMISSIONING: Independent Testing, Adjusting, and Balancing (TAB) certified report per NEBB / AABC standards.",
        ],
      },
      {
        heading: "PART 2 - CENTRAL PLANT & AIR DISTRIBUTION EQUIPMENT",
        lines: [
          "2.01 AIR HANDLING UNITS: 4 Chilled water AHUs (AHU-1 through AHU-4), double-wall insulated, premium efficiency fans.",
          "2.02 VAV TERMINAL BOXES: 110 Pressure-independent VAV boxes with electronic SCR modulated electric reheat coils.",
          "2.03 DUCTWORK: G90 galvanized sheet metal per SMACNA 2-inch static pressure class with low-VOC duct sealant.",
          "2.04 BUILDING AUTOMATION: Furnish native BACnet MS/TP automation integration gateway hardware and protocol points.",
        ],
      },
      {
        heading: "PART 3 - EXECUTION, RIGGING & VIBRATION ISOLATION",
        lines: [
          "3.01 ROOFTOP HOISTING: Mechanical contractor is responsible for crane hoisting AHUs to cooling tower penthouse deck.",
          "3.02 VIBRATION ISOLATION: Mason Industries 2-inch deflection spring vibration isolator hangers on all suspended units.",
          "3.03 VFD COORDINATION: Div 23 furnishes packaged factory VFDs. Division 26 Electrical provides power feed and landing.",
        ],
      },
    ],
  },
  {
    subDir: "specs",
    fileName: "22_00_00_Plumbing_Systems_Spec.pdf",
    title: "CSI MASTERFORMAT SECTION 22 00 00 - PLUMBING & DOMESTIC WATER",
    subtitle: "Lead Plumbing Engineer: Capital Engineering Associates PE #66321 | Austin, TX",
    sections: [
      {
        heading: "PART 1 - GENERAL PLUMBING PROVISIONS",
        lines: [
          "1.01 SCOPE: Complete domestic hot/cold water supply, cast iron sanitary waste/vent, and stormwater drainage systems.",
          "1.02 CODES: International Plumbing Code (IPC 2024), City of Austin Utility Criteria, NSF/ANSI 61 Lead-Free Compliance.",
          "1.03 INSPECTIONS: City of Austin certified backflow preventer inspection and hydrostatic pressure testing required.",
        ],
      },
      {
        heading: "PART 2 - PIPING MATERIALS & BOOSTER PUMP EQUIPMENT",
        lines: [
          "2.01 DOMESTIC WATER: ASTM B88 Type L hard-drawn copper water tube with wrought copper solder fittings.",
          "2.02 SANITARY WASTE: ASTM A74 service weight hubless cast iron soil pipe with heavy-duty stainless steel couplings.",
          "2.03 TRIPLEX BOOSTER PUMP: Skid-mounted variable-speed triplex domestic water booster pump system (750 GPM @ 120 PSI).",
          "2.04 FACTORY STARTUP: Subcontractor must furnish factory-certified startup technician and 3-day owner training.",
        ],
      },
      {
        heading: "PART 3 - EXECUTION & SLEEVE PENETRATIONS",
        lines: [
          "3.01 CORE DRILLING: Plumbing contractor is responsible for floor/wall core drilling, layout x-ray scanning, and sleeves.",
          "3.02 ROOFTOP RIGGING: Contractor must rig and hoist triplex booster skid to penthouse mechanical level.",
          "3.03 DISINFECTION: Complete AWWA C651 chlorination and bacteriological clearance testing for drinking water lines.",
        ],
      },
    ],
  },
  {
    subDir: "drawings",
    fileName: "E-101_Main_Switchgear_Penthouse_Plan.pdf",
    title: "DRAWING E-101: 1600A SWITCHGEAR & PENTHOUSE LAYOUT",
    subtitle: "Architect & BIM Coordinator: Austin Commercial MEP Architecture | Scale: 1/4 in = 1 ft",
    sections: [
      {
        heading: "SHEET INFORMATION & REVISION SCHEDULE",
        lines: [
          "Project: The Domain Tower B - Austin, TX | Drawing: E-101 Rev 2 (Issued for Subcontractor Bidding)",
          "Room 1402: Main Electrical Switchgear Penthouse Vault (Dimensions: 24'-0\" x 36'-0\" clear ceiling height 14'-6\").",
          "Equipment Schedule: MSB-1 (1600A, 480/277V), ATS-1 (Emergency Generator Auto Transfer Switch), Transformer T-1 (75kVA).",
        ],
      },
      {
        heading: "STRUCTURAL RIGGING & HOISTING PATH SPECIFICATION",
        lines: [
          "Hatch Door H-1: Rooftop equipment hoisting hatch opening: 10'-0\" x 12'-0\" with 10,000 lb structural curb load capacity.",
          "Hoisting Clearance: Crane pick radius requires minimum 120-ton hydraulic mobile crane from North staging drive.",
          "Contractor Note: Subcontractor must include full crane mobilization, road closure permit, and rigger certification.",
        ],
      },
      {
        heading: "SEISMIC ANCHORAGE & FIRESTOPPING DETAILS",
        lines: [
          "Detail 4/E-101: Seismic rigid floor anchors (Hilti HSL-4 M16 heavy-duty wedge anchors with 6 in embedment depth).",
          "Detail 7/E-101: UL 1479 System W-L-1054 rated floor sleeve penetrations with STI SpecSeal intumescent sealant.",
          "Clearances: 48-inch working space clearance per NEC 110.26(A)(1) Condition 2 strictly maintained at switchboard fronts.",
        ],
      },
    ],
  },
  {
    subDir: "quotes",
    fileName: "Rosendin_Electric_Proposal_AIA.pdf",
    aliasFileName: "Lone_Star_Electric_Proposal_AIA.pdf",
    title: "ROSENDIN ELECTRIC, INC. - FORMAL COMMERCIAL BID PROPOSAL",
    subtitle: "License: TX-TECL-18042 | Austin, TX | Submitted to: Austin Commercial, LP",
    sections: [
      {
        heading: "COMMERCIAL BID SUMMARY & BASE CONTRACT SUM",
        lines: [
          "Project: The Domain Tower B - Class-A Commercial MEP | CSI Division: 26 00 00 Electrical Systems",
          "Base Bid Lump Sum: $1,225,000.00 (One Million Two Hundred Twenty-Five Thousand Dollars).",
          "Equipment Lead Time: 10 Weeks from approved submittals (Complies with 12-week schedule milestone).",
          "Insurance: Travelers ACORD 25 Certificate attached with $5,000,000 Commercial Umbrella liability.",
        ],
      },
      {
        heading: "SCHEDULE OF VALUES (ITEMIZED LINE ITEMS)",
        lines: [
          "Item 1: 1600A Main Service Switchboard (Square D QED-2, 65kAIC, 480/277V) - $380,000.00",
          "Item 2: Step-Down Distribution Dry Transformers (NEMA Premium Efficient) - $145,000.00",
          "Item 3: Copper Feeder & Branch Conduits (ASTM B8 Class B THHN conductors) - $290,000.00",
          "Item 4: Penthouse Crane Rigging & Mobile Crane Hoisting to 14th Floor - $45,000.00 [INCLUDED]",
          "Item 5: UL 1479 Through-Penetration Firestopping Assemblies - $22,000.00 [INCLUDED]",
          "Item 6: Seismic Engineered Structural Bracing per IBC Section 1613 - $55,000.00 [INCLUDED]",
          "Item 7: Temporary 400A Jobsite Distribution Board Maintenance - $18,000.00 [INCLUDED]",
          "Item 8: Architectural Lighting & Dual-Lite Emergency Battery Inverters - $170,000.00",
          "Item 9: Testing, Megger Reporting, Energization & 1-Yr Warranty - $100,000.00",
        ],
      },
      {
        heading: "VALUE ENGINEERING (VE) ALTERNATES",
        lines: [
          "VE-01: Furnish ASTM B800 8000-Series Aluminum Alloy MC Feeder Cable in lieu of copper: DEDUCT ($35,000.00).",
          "Scope Inclusions: All mandatory scope items fully included with ZERO exclusions. Clean responsible bid.",
        ],
      },
    ],
  },
  {
    subDir: "quotes",
    fileName: "Alterman_Power_Quote_Proposal.pdf",
    aliasFileName: "Austin_Metro_Power_Quote_Proposal.pdf",
    title: "ALTERMAN, INC. - BID QUOTATION",
    subtitle: "License: TX-TECL-19204 | Austin, TX | Submitted to: Austin Commercial, LP",
    sections: [
      {
        heading: "COMMERCIAL BID SUMMARY & APPARENT LOW BASE BID",
        lines: [
          "Project: The Domain Tower B - Division 26 Electrical Systems | Base Bid: $1,100,000.00 (Apparent low base).",
          "Lead Time: Main switchgear equipment lead time is 16 weeks from approved submittals (+4 weeks late).",
          "Insurance: Standard statutory limits ($1,000,000 General Liability). Commercial umbrella NOT provided.",
        ],
      },
      {
        heading: "SCHEDULE OF VALUES BREAKDOWN",
        lines: [
          "Item 1: 1600A Main Service Switchboard (Furnish Only) - $420,000.00",
          "Item 2: Step-down Distribution Transformers - $130,000.00",
          "Item 3: Feeder Conduits and Wire - $280,000.00",
          "Item 4: Commercial Lighting Package - $180,000.00",
          "Item 5: Branch Power Distribution - $90,000.00",
        ],
      },
      {
        heading: "MANDATORY QUALIFICATIONS & SCOPE EXCLUSIONS (READ CAREFULLY)",
        lines: [
          "EXCLUSION 1: Crane hoisting & rigging to penthouse mechanical floor excluded (GC to furnish crane, +$45,000 cost).",
          "EXCLUSION 2: UL 1479 rated firestop penetrations excluded (Drywall/framing trade responsibility, +$22,000 cost).",
          "EXCLUSION 3: Seismic engineered structural bracing excluded (By others, +$55,000 cost).",
          "EXCLUSION 4: Overtime and weekend premium time excluded; straight time only (+$25,000 cost).",
          "FORENSIC ADJUSTMENT: Base Bid $1,100,000 + Exclusions $147,000 + Delay $24,000 + COI $15,000 = $1,286,000 TRUE COST.",
        ],
      },
    ],
  },
  {
    subDir: "insurance",
    fileName: "Rosendin_Electric_ACORD25_COI.pdf",
    aliasFileName: "Lone_Star_Electric_ACORD25_COI.pdf",
    title: "ACORD 25 (2016/03) CERTIFICATE OF LIABILITY INSURANCE",
    subtitle: "Producer: Travelers Commercial Risk Services | Insured: Rosendin Electric, Inc. (TX-TECL-18042)",
    sections: [
      {
        heading: "COVERAGES & POLICY LIMITS (COMPLIANT WITH AGC STANDARDS)",
        lines: [
          "COMMERCIAL GENERAL LIABILITY: Policy #TRV-GL-8910482 | Effective: 01/01/2026 - 01/01/2027",
          "- Each Occurrence Limit: $1,000,000 | Damage to Rented Premises: $500,000 | Medical Exp: $10,000",
          "- Personal & Adv Injury: $1,000,000 | General Aggregate: $2,000,000 | Products/Comp Ops: $2,000,000",
          "AUTOMOBILE LIABILITY: Policy #TRV-AL-4481902 | Any Auto / Hired / Non-Owned: $1,000,000 CSL",
        ],
      },
      {
        heading: "EXCESS / UMBRELLA LIABILITY & WORKERS COMPENSATION",
        lines: [
          "EXCESS / UMBRELLA LIABILITY: Policy #TRV-UMB-991823 | Occurrence Basis",
          "- Each Occurrence Limit: $5,000,000 [FULL COMPLIANCE] | Aggregate Limit: $5,000,000",
          "WORKERS COMPENSATION: Policy #TRV-WC-1182904 | Statutory Limits | E.L. Each Accident: $1,000,000",
        ],
      },
      {
        heading: "CERTIFICATE HOLDER & SPECIAL ENDORSEMENTS",
        lines: [
          "Certificate Holder: Austin Commercial, LP, 100 Congress Ave, Austin, TX 78701.",
          "Additional Insured: Certificate holder is named as Additional Insured on General Liability (CG 20 10 / CG 20 37),",
          "Automobile Liability, and Umbrella Liability on a Primary and Non-Contributory basis with Waiver of Subrogation.",
          "Status: 100% COMPLIANT. Zero insurance deficiency penalty assessed.",
        ],
      },
    ],
  },
];

console.log("Generating genuine %PDF-1.4 standard construction documents...");

for (const doc of docs) {
  // If an authentic large specification / ACORD document already exists in public/specs/, preserve it!
  const existingSubPath = path.join(rootDir, "public", doc.subDir, doc.fileName);
  if (fs.existsSync(existingSubPath)) {
    const stat = fs.statSync(existingSubPath);
    if (stat.size > 50000 && doc.subDir === "specs") {
      console.log(`Preserving authentic web-downloaded specification (${stat.size} bytes): ${doc.fileName}`);
      continue;
    }
  }

  const pdfBuffer = buildPdf(doc.title, doc.subtitle, doc.sections);

  const fileNames = [doc.fileName];
  if (doc.aliasFileName) fileNames.push(doc.aliasFileName);

  for (const fn of fileNames) {
    const targets = [
      path.join(rootDir, "public", doc.subDir, fn),
      path.join(rootDir, "public", fn),
    ];

    if (fs.existsSync(path.join(rootDir, "dist"))) {
      targets.push(path.join(rootDir, "dist", doc.subDir, fn));
      targets.push(path.join(rootDir, "dist", fn));
    }

    for (const t of targets) {
      // Do not overwrite authentic large files
      if (fs.existsSync(t) && fs.statSync(t).size > 50000 && doc.subDir === "specs") {
        continue;
      }
      fs.mkdirSync(path.dirname(t), { recursive: true });
      fs.writeFileSync(t, pdfBuffer);
    }
  }

  console.log(`Generated: ${doc.fileName} (${pdfBuffer.length} bytes) -> public/${doc.subDir}/`);
}

console.log("ALL GENUINE CONSTRUCTION PDF DOCUMENTS GENERATED SUCCESSFULLY!");
