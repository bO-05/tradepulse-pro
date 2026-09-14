import fs from "fs";
import path from "path";

let anthropicKey = process.env.ANTHROPIC_API_KEY || "";
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath) && !anthropicKey) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const [k, v] = line.trim().split("=");
    if (k === "ANTHROPIC_API_KEY" && v) anthropicKey = v.trim();
  }
}

const rawQuote = `BENCHMARK TEST POWER SYSTEMS PROPOSAL
To: General Contractor Estimating
Project: The Domain Tower B Class-A
We hereby submit lump sum proposal of $1,100,000 for electrical systems.
Lead time on 1600A switchboard: 16 weeks.
Exclusions & Qualifications:
1. Crane hoisting to penthouse excluded (GC to furnish crane).
2. UL 1479 firestop penetrations excluded.
3. Seismic structural bracing excluded.
4. Overtime straight time only.
Standard statutory insurance limits only (umbrella endorsement fee not included).`;

const baseInstruction = `You are TradePulse Pro, an expert forensic commercial construction cost estimator. Output ONLY a valid JSON object with the following schema:
{
  "subcontractorName": string,
  "baseBidAmount": number,
  "lineItems": [{"item": string, "unit": string, "quantity": number, "unitCost": number, "totalCost": number}],
  "identifiedExclusions": [{"canonicalCode": string (optional), "description": string, "costImpact": number, "severity": "critical"|"moderate"|"minor", "isWaived": boolean (optional)}],
  "valueEngineeringAlternates": [{"description": string, "costDeduct": number, "isAccepted": boolean}],
  "longLeadEquipmentWeeks": number,
  "leadTimePenalty": number,
  "coiComplianceStatus": "compliant"|"deficiency_detected",
  "coiPenalty": number,
  "leveledTotalCost": number
}
Ensure all numbers are pure numeric values (no currency symbols or commas).
If exclusions in the proposal are unpriced, apply certified ASPE / RSMeans commercial benchmark rates:
- Penthouse crane rigging/hoisting: 45000
- UL 1479 floor/wall penetration firestopping: 22000
- Seismic structural bracing (IBC Section 1613): 55000
- Overtime straight time only / shift premium: 25000
- Equipment lead time penalty: 6000 per week exceeding 12-week schedule baseline (e.g., 16 weeks = 4 weeks * 6000 = 24000)
- Statutory insurance deficit / umbrella endorsement fee: 15000
- BACnet automation integration gateway: 18000
- Independent TAB air balancing report: 28000
- Post-tension slab core drilling: 16000
- City backflow inspection / certification: 8500
Leveled total cost = baseBidAmount + sum(unwaived exclusions) + leadTimePenalty + coiPenalty - accepted Alternates.`;

async function test() {
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
      messages: [{ role: "user", content: rawQuote }],
    }),
  });

  const data = await res.json();
  const textBlock = data.content?.find((c) => c.type === "text") || data.content[0];
  console.log("Claude raw output:\n", textBlock?.text);
}

test().catch(console.error);
