function extractTextFromPdfStream(rawText) {
  if (!rawText) return "";
  const trimmedLeading = rawText.replace(/^\uFEFF/, "").trimStart();
  if (!trimmedLeading.startsWith("%PDF") && !rawText.includes("%PDF-") && !/[\x00-\x08\x0E-\x1F]/.test(rawText.slice(0, 200))) {
    return rawText;
  }
  const extractedPieces = [];
  const tjArrays = Array.from(rawText.matchAll(/\[([\s\S]*?)\]\s*TJ/g));
  for (const match of tjArrays) {
    const arrayContent = match[1];
    const textSegments = Array.from(arrayContent.matchAll(/\(([\s\S]*?)\)/g));
    for (const seg of textSegments) {
      if (seg[1] && seg[1].trim()) extractedPieces.push(seg[1].trim());
    }
  }
  const simpleTj = Array.from(rawText.matchAll(/\(([\s\S]*?)\)\s*Tj/g));
  for (const match of simpleTj) {
    if (match[1] && match[1].trim()) extractedPieces.push(match[1].trim());
  }
  return extractedPieces.join("\n");
}

function escapePdfText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function buildSimplePdf(title, subtitle, sections) {
  let streamContent = `BT\n/F1 16 Tf\n50 750 Td\n(${escapePdfText(title)}) Tj\nET\n`;
  streamContent += `BT\n/F2 10 Tf\n50 730 Td\n(${escapePdfText(subtitle)}) Tj\nET\n`;
  streamContent += `BT\n/F1 10 Tf\n50 715 Td\n(${escapePdfText("------------------------------------------------------------------------------------------------")}) Tj\nET\n`;

  let y = 695;
  for (const sec of sections) {
    if (y < 80) break;
    streamContent += `BT\n/F1 12 Tf\n50 ${y} Td\n(${escapePdfText(sec.heading)}) Tj\nET\n`;
    y -= 18;
    for (const line of sec.lines) {
      if (y < 60) break;
      streamContent += `BT\n/F2 9.5 Tf\n55 ${y} Td\n(${escapePdfText(line)}) Tj\nET\n`;
      y -= 14;
    }
    y -= 10;
  }

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
  const xref = `xref\n0 7\n0000000000 65535 f \n${pad(off1)} 00000 n \n${pad(off2)} 00000 n \n${pad(off3)} 00000 n \n${pad(off4)} 00000 n \n${pad(off5)} 00000 n \n${pad(off6)} 00000 n \n`;
  const trailer = `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return header + obj1 + obj2 + obj3 + obj4 + obj5 + obj6 + xref + trailer;
}

const pdf = buildSimplePdf(
  "SECTION 26 00 00 - ELECTRICAL SYSTEMS",
  "The Domain Tower B - Commercial MEP | Austin, TX",
  [
    {
      heading: "PART 1 - GENERAL REQUIREMENTS",
      lines: [
        "1.1 Section includes 1600A main service entrance switchgear and distribution transformers.",
        "1.2 Crane hoisting to 14th floor penthouse plant room must be furnished by Subcontractor.",
        "1.3 All floor and wall penetrations must be firestopped per UL 1479.",
      ],
    },
    {
      heading: "PART 2 - PRODUCTS & EXCLUSIONS",
      lines: [
        "2.1 Switchgear fault rating: 65kAIC symmetrical at 480V.",
        "2.2 Seismic bracing calculations per IBC 2024 Section 1613 required.",
      ],
    },
  ]
);

console.log("PDF length:", pdf.length);
console.log("PDF starts with %PDF-1.4:", pdf.startsWith("%PDF-1.4"));
console.log("PDF ends with %%EOF:", pdf.trim().endsWith("%%EOF"));

const extracted = extractTextFromPdfStream(pdf);
console.log("\nExtracted text from PDF:");
console.log(extracted);
