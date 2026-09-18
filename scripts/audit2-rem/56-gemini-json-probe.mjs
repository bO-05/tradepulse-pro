import fs from "node:fs";

const REPO = "D:/Repo/ALL HACKATHONS/Convex/Convex all gas";
const env = {};
for (const line of fs.readFileSync(`${REPO}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)$/);
  if (m) env[m[1]] = m[2].trim();
}
const key = env.GEMINI_API_KEY;

const tryRequest = async (label, model, withJsonMode) => {
  const reqBody = {
    contents: [{ parts: [{ text: "Return only this JSON: {\"ok\":true}" }] }],
  };
  if (withJsonMode) reqBody.generationConfig = { responseMimeType: "application/json" };
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });
    const text = await res.text();
    const head = (() => { try { const j = JSON.parse(text); return j.candidates?.[0]?.content?.parts?.[0]?.text || j.error?.message || ""; } catch { return text; } })();
    console.log(`[${label}] ${res.status} :: ${String(head).slice(0, 120)}`);
  } catch (e) {
    console.log(`[${label}] fetch error: ${e.message}`);
  }
};

await tryRequest("3.8 plain", "gemini-3.8-flash", false);
await tryRequest("3.8 json-mode", "gemini-3.8-flash", true);
await tryRequest("3.6 plain", "gemini-3.6-flash", false);
await tryRequest("3.6 json-mode", "gemini-3.6-flash", true);