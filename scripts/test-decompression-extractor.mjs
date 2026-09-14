import fs from "fs";
import { inflate } from "pako";

export function extractTextFromPdf(input) {
  if (!input) return "";
  let buf;
  if (typeof input === "string") {
    buf = Buffer.from(input, "binary");
  } else if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
    buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  } else if (input instanceof ArrayBuffer) {
    buf = Buffer.from(input);
  } else {
    return "";
  }

  const rawStr = buf.toString("latin1");
  const trimmed = rawStr.slice(0, 300).trimStart();
  if (!trimmed.startsWith("%PDF") && !rawStr.includes("%PDF-") && !/[\x00-\x08\x0E-\x1F]/.test(rawStr.slice(0, 200))) {
    return input.toString();
  }

  // Detect encrypted / password-protected PDF streams
  if (rawStr.includes("/Encrypt") && (/\/Encrypt\s+\d+\s+\d+\s+R/i.test(rawStr) || /\/Filter\s*\/Standard/i.test(rawStr))) {
    return "[PDF_ENCRYPTED] Password-protected or encrypted PDF proposal detected. Please export an unencrypted copy.";
  }

  const extractedPieces = [];

  const decodePdfLiteral = (str) => {
    return str
      .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\b/g, "\b")
      .replace(/\\f/g, "\f")
      .replace(/\\([()\\])/g, "$1");
  };

  const decodePdfHex = (hex) => {
    const cleanHex = hex.replace(/\s+/g, "");
    let out = "";
    for (let i = 0; i < cleanHex.length; i += 2) {
      const byte = parseInt(cleanHex.slice(i, i + 2), 16);
      if (!isNaN(byte) && byte >= 32 && byte <= 126) {
        out += String.fromCharCode(byte);
      } else if (byte === 10 || byte === 13 || byte === 9) {
        out += " ";
      }
    }
    return out;
  };

  const parseContentStream = (streamText) => {
    // 1. Array TJ: [(part1) 10 (part2)] TJ
    const tjArrays = Array.from(streamText.matchAll(/\[([\s\S]*?)\]\s*TJ/g));
    for (const arr of tjArrays) {
      const innerParts = [];
      const tokens = Array.from(arr[1].matchAll(/\(([^)]+)\)|<([0-9a-fA-F]+)>/g));
      for (const token of tokens) {
        if (token[1] !== undefined) innerParts.push(decodePdfLiteral(token[1]));
        else if (token[2] !== undefined) innerParts.push(decodePdfHex(token[2]));
      }
      if (innerParts.length > 0) extractedPieces.push(innerParts.join(""));
    }

    // 2. Simple literal text strings: (text string) Tj or '
    const simpleTj = Array.from(streamText.matchAll(/\(([^)]{1,})\)\s*(?:Tj|'|")/g));
    for (const m of simpleTj) {
      const dec = decodePdfLiteral(m[1]);
      if (dec.trim().length > 0) extractedPieces.push(dec.trim());
    }

    // 3. Hex strings: <48656c> Tj
    const hexTj = Array.from(streamText.matchAll(/<([0-9a-fA-F]{2,})>\s*(?:Tj|'|")/g));
    for (const m of hexTj) {
      const dec = decodePdfHex(m[1]);
      if (dec.trim().length > 0) extractedPieces.push(dec.trim());
    }
  };

  // Find all streams
  let pos = 0;
  while (pos < buf.length) {
    const streamIdx = buf.indexOf(Buffer.from("stream"), pos);
    if (streamIdx === -1) break;

    let startData = streamIdx + 6;
    if (buf[startData] === 0x0d && buf[startData + 1] === 0x0a) startData += 2;
    else if (buf[startData] === 0x0a) startData += 1;
    else if (buf[startData] === 0x0d) startData += 1;

    const endIdx = buf.indexOf(Buffer.from("endstream"), startData);
    if (endIdx === -1) break;

    const streamBytes = buf.subarray(startData, endIdx);
    const prevSlice = buf.subarray(Math.max(0, streamIdx - 300), streamIdx).toString("latin1");

    if (prevSlice.includes("FlateDecode")) {
      try {
        const decompressed = inflate(streamBytes);
        parseContentStream(Buffer.from(decompressed).toString("latin1"));
      } catch {
        // failed inflate
      }
    } else {
      parseContentStream(streamBytes.toString("latin1"));
    }
    pos = endIdx + 9;
  }

  // Also extract any uncompressed text outside streams if nothing found
  if (extractedPieces.length === 0) {
    parseContentStream(rawStr);
  }

  // Fallback token extraction if still empty
  let result = extractedPieces.join("\n").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ").trim();
  if (result.length <= 15) {
    const textWithoutBinary = rawStr.replace(/stream[\r\n][\s\S]*?endstream/gi, "");
    const segments = textWithoutBinary.match(/[A-Za-z0-9\s.,;:$%/\\()\-–—@&+=#'"_[\]*!?]{4,}/g) || [];
    const cleanTokens = segments
      .filter((s) => {
        const tr = s.trim();
        return !tr.startsWith("/") && !tr.startsWith("obj") && !tr.startsWith("endobj") && !tr.startsWith("<<") && !tr.startsWith(">>");
      })
      .join(" ")
      .trim();
    if (cleanTokens.length > 30) {
      result = cleanTokens;
    }
  }

  return result.slice(0, 32000);
}

if (process.argv[1] && process.argv[1].includes("test-decompression-extractor.mjs")) {
  const files = [
    "public/specs/01_00_00_General_Requirements.pdf",
    "public/specs/26_00_00_Electrical_Systems_Spec.pdf",
    "public/specs/23_00_00_HVAC_Systems_Spec.pdf",
    "public/specs/22_00_00_Plumbing_Systems_Spec.pdf"
  ];

  for (const f of files) {
    const t = extractTextFromPdf(fs.readFileSync(f));
    console.log(`File: ${f} -> Extracted: ${t.length} chars, Lines: ${t.split("\n").length}`);
    console.log(`  Sample: ${t.split("\n").slice(0, 3).join(" | ")}`);
  }
}
