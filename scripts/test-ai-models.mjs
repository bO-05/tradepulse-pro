import fs from "fs";
import path from "path";

let anthropicKey = process.env.ANTHROPIC_API_KEY || "";
let geminiKey = process.env.GEMINI_API_KEY || "";
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const [k, v] = line.trim().split("=");
    if (k === "ANTHROPIC_API_KEY" && v && !anthropicKey) anthropicKey = v.trim();
    if (k === "GEMINI_API_KEY" && v && !geminiKey) geminiKey = v.trim();
  }
}

const baseInstruction = `You are TradePulse Pro, an expert forensic commercial construction cost estimator. Output ONLY a valid JSON object with the following schema:
{
  "subcontractorName": string,
  "baseBidAmount": number,
  "lineItems": [{"item": string, "unit": string, "quantity": number, "unitCost": number, "totalCost": number}],
  "identifiedExclusions": [{"description": string, "costImpact": number, "severity": "critical"|"moderate"|"minor"}],
  "valueEngineeringAlternates": [{"description": string, "costDeduct": number, "isAccepted": boolean}],
  "longLeadEquipmentWeeks": number,
  "leadTimePenalty": number,
  "coiComplianceStatus": "compliant"|"deficiency_detected",
  "coiPenalty": number,
  "leveledTotalCost": number
}
Ensure all numbers are pure numeric values (no currency symbols or commas).`;

const testPrompt = `BENCHMARK TEST POWER SYSTEMS PROPOSAL
To: General Contractor Estimating
Project: The Domain Tower B Class-A
We hereby submit lump sum proposal of $1,100,000 for electrical systems.
Lead time on 1600A switchboard: 16 weeks.
Exclusions & Qualifications:
1. Crane hoisting to penthouse excluded ($45,000).
2. UL 1479 firestop penetrations excluded ($22,000).
3. Seismic structural bracing excluded ($55,000).
4. Overtime straight time only ($25,000).
Standard statutory insurance limits only (umbrella endorsement fee $15,000 not included).`;

function tryParseJson(text) {
  if (!text || typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    const cleanJson = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/i, "$1").trim();
    try {
      return JSON.parse(cleanJson);
    } catch {
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          return JSON.parse(text.slice(firstBrace, lastBrace + 1));
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
  }
}

async function testClaudeBidLeveling() {
  console.log("Testing Claude Sonnet 5 bid leveling extraction...");
  const t0 = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system: baseInstruction,
      messages: [{ role: "user", content: testPrompt }],
    }),
  });

  const latency = Date.now() - t0;
  const data = await res.json();
  console.log(`Claude HTTP: ${res.status} in ${latency}ms`);
  const textBlock = Array.isArray(data.content)
    ? (data.content.find((c) => c.type === "text") || data.content[0])
    : null;
  const content = textBlock?.text || "";
  const parsed = tryParseJson(content);
  console.log("Parsed JSON:", parsed ? "SUCCESS" : "FAIL");
  if (parsed) {
    console.log("Subcontractor:", parsed.subcontractorName);
    console.log("Base Bid:", parsed.baseBidAmount);
    console.log("Exclusions Count:", parsed.identifiedExclusions?.length);
    console.log("Leveled Cost:", parsed.leveledTotalCost);
  } else {
    console.log("Raw text:", content);
  }
}

async function testGeminiBidLeveling() {
  console.log("\nTesting Gemini 3.8 Flash bid leveling extraction...");
  const t0 = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${geminiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `${baseInstruction}\n\n${testPrompt}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });

  const latency = Date.now() - t0;
  const data = await res.json();
  console.log(`Gemini HTTP: ${res.status} in ${latency}ms`);
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const parsed = tryParseJson(content);
  console.log("Parsed JSON:", parsed ? "SUCCESS" : "FAIL");
  if (parsed) {
    console.log("Subcontractor:", parsed.subcontractorName);
    console.log("Base Bid:", parsed.baseBidAmount);
    console.log("Exclusions Count:", parsed.identifiedExclusions?.length);
    console.log("Leveled Cost:", parsed.leveledTotalCost);
  } else {
    console.log("Raw text:", content);
  }
}

async function main() {
  await testClaudeBidLeveling();
  await testGeminiBidLeveling();
}

main().catch(console.error);
