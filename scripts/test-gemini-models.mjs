import fs from "fs";
import path from "path";

let apiKey = process.env.GEMINI_API_KEY || "";
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath) && !apiKey) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const [k, v] = line.trim().split("=");
    if (k === "GEMINI_API_KEY" && v) apiKey = v.trim();
  }
}

const models = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

async function checkModels() {
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Hello" }] }],
        }),
      });
      const data = await res.json();
      console.log(`Model: ${model.padEnd(20)} -> status ${res.status}:`, res.ok ? "SUCCESS" : JSON.stringify(data.error?.message || data));
    } catch (e) {
      console.log(`Model: ${model.padEnd(20)} -> EXCEPTION:`, e.message);
    }
  }
}

checkModels();
