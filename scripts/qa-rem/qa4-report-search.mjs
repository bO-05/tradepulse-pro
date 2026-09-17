import fs from "node:fs";

const files = [
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/TradePulse-Pro-Remediation-Verification-2026-09-16-01.html",
  "D:/Repo/ALL HACKATHONS/Convex/Convex all gas/doc/tradepulse audits/outputs/TradePulse-Pro-Production-Audit-2026-09-16-03-26-AM-UTC.html",
];
const needle = process.argv[2] || "ERR-A";
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const raw = fs.readFileSync(f, "utf8");
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
  console.log(`\n===== ${f.split("/").pop()} =====`);
  let i = -1;
  let count = 0;
  while ((i = text.indexOf(needle, i + 1)) >= 0 && count < 12) {
    count++;
    console.log(`--- occurrence ${count} ---`);
    console.log(text.slice(Math.max(0, i - 800), i + 1100));
  }
}