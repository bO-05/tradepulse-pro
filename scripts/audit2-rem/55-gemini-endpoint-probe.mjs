import fs from "node:fs";

const REPO = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas";
const env = {};
for (const line of fs.readFileSync(`${REPO}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)$/);
  if (m) env[m[1]] = m[2].trim();
}
const key = env.GEMINI_API_KEY;
const body = JSON.stringify({ contents: [{ parts: [{ text: "Reply with the single word OK." }] }] });

const tryEndpoint = async (label, url) => {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const text = await res.text();
    console.log(`\n[${label}] ${res.status}`);
    console.log(text.slice(0, 400));
  } catch (e) {
    console.log(`\n[${label}] fetch error: ${e.message}`);
  }
};

await tryEndpoint(
  "AI Studio gemini-3.6-flash",
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`
);
await tryEndpoint(
  "AI Studio gemini-3.8-flash",
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${key}`
);
await tryEndpoint(
  "Vertex Express gemini-3.6-flash",
  `https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.6-flash:generateContent?key=${key}`
);
await tryEndpoint(
  "AI Studio models list",
  `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
);