import fs from "fs";
const content = fs.readFileSync("convex/realDocuments.ts", "utf8");
const lines = content.split("\n");
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes(".pdf\":")) {
    console.log(`Line ${i + 1}: ${lines[i].trim()}`);
  }
}
