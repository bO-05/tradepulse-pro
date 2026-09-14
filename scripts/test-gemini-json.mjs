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

async function testJsonMode() {
  const gModel = "gemini-3.8-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${apiKey}`;
  const reqBody = {
    contents: [
      {
        parts: [
          {
            text: "Output a JSON with {\"hello\": \"world\"}",
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json" },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });
  console.log("Status:", res.status);
  const data = await res.json();
  console.log("Response:", JSON.stringify(data));
}

testJsonMode();
