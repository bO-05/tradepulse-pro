import { cleanNumber, sanitizeBidLevelingOutput } from "../convex/llmRouter.ts";

console.log("--- Testing cleanNumber ---");
console.log("1.250.000,00 ->", cleanNumber("1.250.000,00"));
console.log("1.250.000 ->", cleanNumber("1.250.000"));
console.log("$1,25M ->", cleanNumber("$1,25M"));
console.log("1 250 000,50 ->", cleanNumber("1 250 000,50"));
console.log("$1,250,000.00 ->", cleanNumber("$1,250,000.00"));
console.log("($45,000.00) ->", cleanNumber("($45,000.00)"));

console.log("\n--- Testing sanitizeBidLevelingOutput with alternate LLM keys ---");
const llmWithExclusionsKey = {
  subcontractorName: "Acme Concrete",
  baseBid: "$1,400,000",
  exclusions: [
    { description: "Crane hoisting", cost: 45000, severity: "critical" }
  ],
  alternates: [
    { description: "Alt Mix", savings: 20000, isAccepted: true }
  ]
};

const sanitized = sanitizeBidLevelingOutput(llmWithExclusionsKey);
console.log("sanitized identifiedExclusions length:", sanitized.identifiedExclusions.length);
console.log("sanitized valueEngineeringAlternates length:", sanitized.valueEngineeringAlternates.length);
if (sanitized.identifiedExclusions.length > 0) {
  console.log("exclusion costImpact:", sanitized.identifiedExclusions[0].costImpact);
}
if (sanitized.valueEngineeringAlternates.length > 0) {
  console.log("alternate costDeduct:", sanitized.valueEngineeringAlternates[0].costDeduct);
}
